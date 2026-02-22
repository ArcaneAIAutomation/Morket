"""Unit tests for RobotsChecker — robots.txt fetching, caching, and URL checking."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.resilience.robots_checker import RobotsChecker


SAMPLE_ROBOTS_TXT = """\
User-agent: *
Disallow: /private/
Disallow: /admin/
Allow: /public/

User-agent: BadBot
Disallow: /
"""


@pytest.fixture
def checker():
    return RobotsChecker(cache_ttl_seconds=3600, fetch_timeout_seconds=5.0)


def _mock_response(text: str = "", status_code: int = 200):
    """Create a mock httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.text = text
    return resp


class TestFetchRobotsTxt:
    """Tests for fetch_robots_txt()."""

    async def test_successful_fetch(self, checker):
        """Fetches and caches robots.txt on 200 response."""
        mock_client = AsyncMock()
        mock_client.get.return_value = _mock_response(text=SAMPLE_ROBOTS_TXT, status_code=200)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.resilience.robots_checker.httpx.AsyncClient", return_value=mock_client):
            content = await checker.fetch_robots_txt("example.com")

        assert content == SAMPLE_ROBOTS_TXT
        mock_client.get.assert_called_once_with("https://example.com/robots.txt")

    async def test_404_returns_none(self, checker):
        """Returns None on 404 (permissive default)."""
        mock_client = AsyncMock()
        mock_client.get.return_value = _mock_response(status_code=404)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.resilience.robots_checker.httpx.AsyncClient", return_value=mock_client):
            content = await checker.fetch_robots_txt("example.com")

        assert content is None

    async def test_timeout_returns_none(self, checker):
        """Returns None on timeout (permissive default)."""
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.ReadTimeout("timed out")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.resilience.robots_checker.httpx.AsyncClient", return_value=mock_client):
            content = await checker.fetch_robots_txt("example.com")

        assert content is None

    async def test_cache_hit_no_refetch(self, checker):
        """Second call within TTL returns cached content without refetching."""
        mock_client = AsyncMock()
        mock_client.get.return_value = _mock_response(text=SAMPLE_ROBOTS_TXT, status_code=200)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.resilience.robots_checker.httpx.AsyncClient", return_value=mock_client):
            await checker.fetch_robots_txt("example.com")
            content = await checker.fetch_robots_txt("example.com")

        assert content == SAMPLE_ROBOTS_TXT
        # Only one HTTP call — second was served from cache
        mock_client.get.assert_called_once()

    async def test_cache_expiry_refetches(self):
        """After TTL expires, fetches fresh content."""
        checker = RobotsChecker(cache_ttl_seconds=0)  # Immediate expiry

        mock_client = AsyncMock()
        mock_client.get.side_effect = [
            _mock_response(text=SAMPLE_ROBOTS_TXT, status_code=200),
            _mock_response(text="User-agent: *\nAllow: /", status_code=200),
        ]
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.resilience.robots_checker.httpx.AsyncClient", return_value=mock_client):
            await checker.fetch_robots_txt("example.com")
            time.sleep(0.01)  # Ensure monotonic time advances past TTL=0
            content = await checker.fetch_robots_txt("example.com")

        assert content == "User-agent: *\nAllow: /"
        assert mock_client.get.call_count == 2


class TestIsUrlAllowed:
    """Tests for is_url_allowed()."""

    async def _fetch_sample(self, checker):
        """Helper to populate cache with sample robots.txt."""
        mock_client = AsyncMock()
        mock_client.get.return_value = _mock_response(text=SAMPLE_ROBOTS_TXT, status_code=200)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.resilience.robots_checker.httpx.AsyncClient", return_value=mock_client):
            await checker.fetch_robots_txt("example.com")

    async def test_allowed_path(self, checker):
        """Path not in Disallow list is allowed."""
        await self._fetch_sample(checker)
        assert checker.is_url_allowed("example.com", "/public/page") is True

    async def test_disallowed_path(self, checker):
        """Path in Disallow list is not allowed."""
        await self._fetch_sample(checker)
        assert checker.is_url_allowed("example.com", "/private/secret") is False
        assert checker.is_url_allowed("example.com", "/admin/dashboard") is False

    async def test_specific_user_agent_disallowed(self, checker):
        """BadBot user agent is disallowed from everything."""
        await self._fetch_sample(checker)
        assert checker.is_url_allowed("example.com", "/public/page", user_agent="BadBot") is False

    async def test_no_cache_entry_allows_all(self, checker):
        """If no robots.txt was fetched, all URLs are allowed."""
        assert checker.is_url_allowed("unknown.com", "/anything") is True

    async def test_failed_fetch_allows_all(self, checker):
        """If robots.txt fetch failed, all URLs are allowed."""
        mock_client = AsyncMock()
        mock_client.get.side_effect = httpx.ConnectError("connection refused")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.resilience.robots_checker.httpx.AsyncClient", return_value=mock_client):
            await checker.fetch_robots_txt("example.com")

        assert checker.is_url_allowed("example.com", "/private/secret") is True

    async def test_root_path_allowed(self, checker):
        """Root path is allowed when not explicitly disallowed."""
        await self._fetch_sample(checker)
        assert checker.is_url_allowed("example.com", "/") is True


class TestClearCache:
    """Tests for clear_cache()."""

    async def test_clear_removes_all_entries(self, checker):
        """clear_cache() removes all cached entries."""
        mock_client = AsyncMock()
        mock_client.get.return_value = _mock_response(text=SAMPLE_ROBOTS_TXT, status_code=200)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.resilience.robots_checker.httpx.AsyncClient", return_value=mock_client):
            await checker.fetch_robots_txt("example.com")

        checker.clear_cache()
        # After clearing, no cache entry — permissive default
        assert checker.is_url_allowed("example.com", "/private/secret") is True
