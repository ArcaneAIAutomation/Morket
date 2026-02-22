"""Unit tests for the proxy manager."""

import time

import pytest

from src.middleware.error_handler import NoHealthyProxiesError
from src.proxy.manager import ProxyManager
from src.proxy.types import ProxyEndpoint


class TestProxyEndpoint:
    """Test ProxyEndpoint dataclass defaults."""

    def test_defaults(self):
        ep = ProxyEndpoint(url="http://proxy1:8080", protocol="http")
        assert ep.is_healthy is True
        assert ep.success_count == 0
        assert ep.failure_count == 0
        assert ep.region is None
        assert ep.last_used_domains == {}


class TestInitialize:
    """Test ProxyManager.initialize()."""

    @pytest.mark.asyncio
    async def test_parses_http_proxy(self):
        pm = ProxyManager()
        await pm.initialize(["http://proxy1:8080"])
        stats = pm.get_stats()
        assert stats["total"] == 1
        assert stats["proxies"][0]["protocol"] == "http"

    @pytest.mark.asyncio
    async def test_parses_https_proxy(self):
        pm = ProxyManager()
        await pm.initialize(["https://proxy1:443"])
        assert pm.get_stats()["proxies"][0]["protocol"] == "https"

    @pytest.mark.asyncio
    async def test_parses_socks5_proxy(self):
        pm = ProxyManager()
        await pm.initialize(["socks5://proxy1:1080"])
        assert pm.get_stats()["proxies"][0]["protocol"] == "socks5"

    @pytest.mark.asyncio
    async def test_multiple_proxies(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080", "socks5://p2:1080", "https://p3:443"])
        stats = pm.get_stats()
        assert stats["total"] == 3
        assert stats["healthy"] == 3
        assert stats["unhealthy"] == 0

    @pytest.mark.asyncio
    async def test_empty_list(self):
        pm = ProxyManager()
        await pm.initialize([])
        assert pm.get_stats()["total"] == 0

    @pytest.mark.asyncio
    async def test_reinitialize_resets_state(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080", "http://p2:8080"])
        pm.select("example.com")
        await pm.initialize(["http://p3:8080"])
        stats = pm.get_stats()
        assert stats["total"] == 1
        assert stats["proxies"][0]["url"] == "http://p3:8080"


class TestSelect:
    """Test round-robin selection with health and cooldown filtering."""

    @pytest.mark.asyncio
    async def test_round_robin_order(self):
        pm = ProxyManager(domain_cooldown_seconds=0)
        await pm.initialize(["http://p1:8080", "http://p2:8080", "http://p3:8080"])
        urls = [pm.select("a.com").url for _ in range(6)]
        assert urls == [
            "http://p1:8080",
            "http://p2:8080",
            "http://p3:8080",
            "http://p1:8080",
            "http://p2:8080",
            "http://p3:8080",
        ]

    @pytest.mark.asyncio
    async def test_skips_unhealthy(self):
        pm = ProxyManager(domain_cooldown_seconds=0)
        await pm.initialize(["http://p1:8080", "http://p2:8080", "http://p3:8080"])
        # Mark p1 unhealthy
        proxy1 = pm._proxies[0]
        pm.mark_unhealthy(proxy1)
        selected = [pm.select("a.com").url for _ in range(4)]
        assert "http://p1:8080" not in selected

    @pytest.mark.asyncio
    async def test_raises_when_all_unhealthy(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080", "http://p2:8080"])
        for p in pm._proxies:
            pm.mark_unhealthy(p)
        with pytest.raises(NoHealthyProxiesError):
            pm.select("example.com")

    @pytest.mark.asyncio
    async def test_raises_on_empty_pool(self):
        pm = ProxyManager()
        await pm.initialize([])
        with pytest.raises(NoHealthyProxiesError):
            pm.select("example.com")

    @pytest.mark.asyncio
    async def test_domain_cooldown_skips_recently_used(self):
        pm = ProxyManager(domain_cooldown_seconds=30)
        await pm.initialize(["http://p1:8080", "http://p2:8080"])
        # First select for example.com → p1
        first = pm.select("example.com")
        assert first.url == "http://p1:8080"
        # Second select for same domain → should skip p1 (cooldown), pick p2
        second = pm.select("example.com")
        assert second.url == "http://p2:8080"

    @pytest.mark.asyncio
    async def test_domain_cooldown_does_not_affect_other_domains(self):
        pm = ProxyManager(domain_cooldown_seconds=30)
        await pm.initialize(["http://p1:8080"])
        pm.select("a.com")
        # Different domain should still get p1
        selected = pm.select("b.com")
        assert selected.url == "http://p1:8080"

    @pytest.mark.asyncio
    async def test_raises_when_all_on_cooldown(self):
        pm = ProxyManager(domain_cooldown_seconds=30)
        await pm.initialize(["http://p1:8080", "http://p2:8080"])
        pm.select("example.com")
        pm.select("example.com")
        # Both proxies now on cooldown for example.com
        with pytest.raises(NoHealthyProxiesError):
            pm.select("example.com")

    @pytest.mark.asyncio
    async def test_cooldown_expires(self):
        pm = ProxyManager(domain_cooldown_seconds=1)
        await pm.initialize(["http://p1:8080"])
        pm.select("example.com")
        # Manually expire the cooldown
        pm._proxies[0].last_used_domains["example.com"] = time.monotonic() - 2
        # Should be selectable again
        selected = pm.select("example.com")
        assert selected.url == "http://p1:8080"

    @pytest.mark.asyncio
    async def test_records_domain_timestamp(self):
        pm = ProxyManager(domain_cooldown_seconds=30)
        await pm.initialize(["http://p1:8080"])
        before = time.monotonic()
        pm.select("example.com")
        after = time.monotonic()
        ts = pm._proxies[0].last_used_domains["example.com"]
        assert before <= ts <= after


class TestMarkUnhealthy:
    """Test mark_unhealthy behavior."""

    @pytest.mark.asyncio
    async def test_sets_unhealthy(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080"])
        proxy = pm._proxies[0]
        pm.mark_unhealthy(proxy)
        assert proxy.is_healthy is False

    @pytest.mark.asyncio
    async def test_increments_failure_count(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080"])
        proxy = pm._proxies[0]
        pm.mark_unhealthy(proxy)
        pm.mark_unhealthy(proxy)
        assert proxy.failure_count == 2


class TestMarkSuccess:
    """Test mark_success behavior."""

    @pytest.mark.asyncio
    async def test_increments_success_count(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080"])
        proxy = pm._proxies[0]
        pm.mark_success(proxy)
        pm.mark_success(proxy)
        pm.mark_success(proxy)
        assert proxy.success_count == 3

    @pytest.mark.asyncio
    async def test_does_not_change_health(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080"])
        proxy = pm._proxies[0]
        pm.mark_success(proxy)
        assert proxy.is_healthy is True


class TestGetStats:
    """Test get_stats output."""

    @pytest.mark.asyncio
    async def test_stats_structure(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080", "socks5://p2:1080"])
        stats = pm.get_stats()
        assert "total" in stats
        assert "healthy" in stats
        assert "unhealthy" in stats
        assert "proxies" in stats
        assert len(stats["proxies"]) == 2

    @pytest.mark.asyncio
    async def test_stats_reflect_health(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080", "http://p2:8080", "http://p3:8080"])
        pm.mark_unhealthy(pm._proxies[0])
        stats = pm.get_stats()
        assert stats["total"] == 3
        assert stats["healthy"] == 2
        assert stats["unhealthy"] == 1

    @pytest.mark.asyncio
    async def test_stats_reflect_counters(self):
        pm = ProxyManager()
        await pm.initialize(["http://p1:8080"])
        proxy = pm._proxies[0]
        pm.mark_success(proxy)
        pm.mark_success(proxy)
        pm.mark_unhealthy(proxy)
        stats = pm.get_stats()
        assert stats["proxies"][0]["success_count"] == 2
        assert stats["proxies"][0]["failure_count"] == 1

    @pytest.mark.asyncio
    async def test_empty_pool_stats(self):
        pm = ProxyManager()
        await pm.initialize([])
        stats = pm.get_stats()
        assert stats == {"total": 0, "healthy": 0, "unhealthy": 0, "proxies": []}
