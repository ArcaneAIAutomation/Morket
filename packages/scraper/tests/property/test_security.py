"""Property tests for scraper URL validation — SSRF prevention.

Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
Non-http/https schemes rejected; private/loopback/link-local IPs rejected.

**Validates: Requirements 3.8**
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from src.validators.url_validator import is_private_ip, validate_url


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

octets = st.integers(min_value=0, max_value=255)


def _ip_str(a: int, b: int, c: int, d: int) -> str:
    return f"{a}.{b}.{c}.{d}"


# Public IPs: exclude all private/reserved ranges
def _is_public(a: int, b: int, c: int, d: int) -> bool:
    """Return True if the IP is genuinely public (not private/reserved)."""
    if a == 10:
        return False
    if a == 172 and 16 <= b <= 31:
        return False
    if a == 192 and b == 168:
        return False
    if a == 127:
        return False
    if a == 169 and b == 254:
        return False
    if a == 0:
        return False
    return True


# ---------------------------------------------------------------------------
# is_private_ip — RFC 1918 10.0.0.0/8
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(b=octets, c=octets, d=octets)
def test_rfc1918_10_range_is_private(b: int, c: int, d: int) -> None:
    """10.x.x.x addresses are private."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    assert is_private_ip(f"10.{b}.{c}.{d}") is True


# ---------------------------------------------------------------------------
# is_private_ip — RFC 1918 172.16.0.0/12
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(b=st.integers(min_value=16, max_value=31), c=octets, d=octets)
def test_rfc1918_172_range_is_private(b: int, c: int, d: int) -> None:
    """172.16-31.x.x addresses are private."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    assert is_private_ip(f"172.{b}.{c}.{d}") is True


# ---------------------------------------------------------------------------
# is_private_ip — RFC 1918 192.168.0.0/16
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(c=octets, d=octets)
def test_rfc1918_192_168_range_is_private(c: int, d: int) -> None:
    """192.168.x.x addresses are private."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    assert is_private_ip(f"192.168.{c}.{d}") is True


# ---------------------------------------------------------------------------
# is_private_ip — Loopback 127.0.0.0/8
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(b=octets, c=octets, d=octets)
def test_loopback_is_private(b: int, c: int, d: int) -> None:
    """127.x.x.x addresses are loopback and should be private."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    assert is_private_ip(f"127.{b}.{c}.{d}") is True


# ---------------------------------------------------------------------------
# is_private_ip — Link-local 169.254.0.0/16
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(c=octets, d=octets)
def test_link_local_is_private(c: int, d: int) -> None:
    """169.254.x.x addresses are link-local and should be private."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    assert is_private_ip(f"169.254.{c}.{d}") is True


# ---------------------------------------------------------------------------
# is_private_ip — Public IPs return False
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(a=octets, b=octets, c=octets, d=octets)
def test_public_ips_are_not_private(a: int, b: int, c: int, d: int) -> None:
    """IPs outside all private/reserved ranges should return False."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    assume(_is_public(a, b, c, d))
    assert is_private_ip(_ip_str(a, b, c, d)) is False


# ---------------------------------------------------------------------------
# validate_url — Non-http/https schemes rejected
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    scheme=st.sampled_from(["ftp", "file", "gopher", "ssh", "telnet", "data", "javascript"]),
)
@pytest.mark.asyncio
async def test_non_http_schemes_rejected(scheme: str) -> None:
    """URLs with non-http/https schemes must be rejected."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    result = await validate_url(f"{scheme}://example.com/path")
    assert result is False


# ---------------------------------------------------------------------------
# validate_url — Private IPs rejected (mock DNS)
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(b=octets, c=octets, d=octets)
@pytest.mark.asyncio
async def test_validate_url_rejects_private_ip_resolution(
    b: int, c: int, d: int
) -> None:
    """URLs resolving to private IPs must be rejected."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    private_ip = f"10.{b}.{c}.{d}"
    mock_result = [(2, 1, 6, "", (private_ip, 0))]
    with patch("src.validators.url_validator.socket.getaddrinfo", return_value=mock_result):
        result = await validate_url("https://example.com/page")
        assert result is False


# ---------------------------------------------------------------------------
# validate_url — Public IPs accepted (mock DNS)
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(a=octets, b=octets, c=octets, d=octets)
@pytest.mark.asyncio
async def test_validate_url_accepts_public_ip_resolution(
    a: int, b: int, c: int, d: int
) -> None:
    """URLs resolving to public IPs must be accepted."""
    # Feature: security-audit, Property 9 (scraper): URL scheme and IP range validation
    assume(_is_public(a, b, c, d))
    public_ip = _ip_str(a, b, c, d)
    mock_result = [(2, 1, 6, "", (public_ip, 0))]
    with patch("src.validators.url_validator.socket.getaddrinfo", return_value=mock_result):
        result = await validate_url("https://example.com/page")
        assert result is True
