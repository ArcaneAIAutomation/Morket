"""Property tests for proxy manager.

Validates round-robin selection skipping unhealthy proxies, unhealthy marking
and exclusion, per-domain cooldown enforcement, and metrics accuracy.
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from src.middleware.error_handler import NoHealthyProxiesError
from src.proxy.manager import ProxyManager
from src.proxy.types import ProxyEndpoint


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Generate 2-10 unique proxy URLs
proxy_url_lists = st.integers(min_value=2, max_value=10).flatmap(
    lambda n: st.lists(
        st.integers(min_value=8001, max_value=9999).map(
            lambda port: f"http://proxy{port}:{port}"
        ),
        min_size=n,
        max_size=n,
        unique=True,
    )
)

# Random domain names for target selection
domain_names = st.from_regex(r"[a-z]{3,10}\.(com|org|net|io)", fullmatch=True)

# Boolean mask for marking proxies healthy/unhealthy (True = healthy)
health_masks = st.lists(st.booleans(), min_size=2, max_size=10)

# Sequences of success/failure events (True = success, False = failure)
event_sequences = st.lists(st.booleans(), min_size=1, max_size=50)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_async(coro):
    """Run an async coroutine synchronously."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _make_manager_with_proxies(
    urls: list[str],
    health_mask: list[bool] | None = None,
    cooldown: int = 30,
) -> ProxyManager:
    """Create and initialize a ProxyManager, optionally marking some unhealthy."""
    mgr = ProxyManager(domain_cooldown_seconds=cooldown, health_check_interval_seconds=60)
    _run_async(mgr.initialize(urls))

    if health_mask is not None:
        for i, healthy in enumerate(health_mask):
            if not healthy:
                mgr._proxies[i].is_healthy = False

    return mgr


# ---------------------------------------------------------------------------
# Property 18: Proxy round-robin skips unhealthy
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(urls=proxy_url_lists, health_mask=health_masks, domain=domain_names)
def test_select_only_returns_healthy_proxies(
    urls: list[str],
    health_mask: list[bool],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 18: Proxy round-robin skips unhealthy
    # **Validates: Requirements 7.2**

    # Align mask length with proxy count
    mask = health_mask[: len(urls)]
    while len(mask) < len(urls):
        mask.append(True)

    healthy_count = sum(mask)
    assume(healthy_count > 0)

    mgr = _make_manager_with_proxies(urls, mask, cooldown=0)

    # Select proxies — each must be healthy
    for _ in range(healthy_count):
        proxy = mgr.select(domain)
        assert proxy.is_healthy is True


@settings(max_examples=100)
@given(urls=proxy_url_lists, health_mask=health_masks, domain=domain_names)
def test_round_robin_order_among_healthy(
    urls: list[str],
    health_mask: list[bool],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 18: Proxy round-robin skips unhealthy
    # **Validates: Requirements 7.2**

    mask = health_mask[: len(urls)]
    while len(mask) < len(urls):
        mask.append(True)

    healthy_count = sum(mask)
    assume(healthy_count >= 2)

    mgr = _make_manager_with_proxies(urls, mask, cooldown=0)

    # Collect the expected healthy proxy URLs in order
    expected_healthy_urls = [urls[i] for i, h in enumerate(mask) if h]

    # Select healthy_count proxies — they should follow round-robin among healthy ones
    selected_urls = []
    for _ in range(healthy_count):
        proxy = mgr.select(domain)
        selected_urls.append(proxy.url)

    # All selected must be from the healthy set
    assert set(selected_urls) == set(expected_healthy_urls)


@settings(max_examples=100)
@given(urls=proxy_url_lists, domain=domain_names)
def test_all_unhealthy_raises_error(
    urls: list[str],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 18: Proxy round-robin skips unhealthy
    # **Validates: Requirements 7.2**

    # Mark all proxies unhealthy
    mask = [False] * len(urls)
    mgr = _make_manager_with_proxies(urls, mask, cooldown=0)

    with pytest.raises(NoHealthyProxiesError):
        mgr.select(domain)


# ---------------------------------------------------------------------------
# Property 19: Failed proxy marked unhealthy
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(urls=proxy_url_lists, domain=domain_names)
def test_mark_unhealthy_excludes_from_selection(
    urls: list[str],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 19: Failed proxy marked unhealthy
    # **Validates: Requirements 7.3**

    mgr = _make_manager_with_proxies(urls, cooldown=0)

    # Select first proxy and mark it unhealthy
    first_proxy = mgr.select(domain)
    mgr.mark_unhealthy(first_proxy)

    assert first_proxy.is_healthy is False

    # Subsequent selections should never return the unhealthy proxy
    remaining_healthy = len(urls) - 1
    if remaining_healthy == 0:
        with pytest.raises(NoHealthyProxiesError):
            mgr.select(domain)
    else:
        for _ in range(remaining_healthy):
            proxy = mgr.select(domain)
            assert proxy.url != first_proxy.url
            assert proxy.is_healthy is True


@settings(max_examples=100)
@given(urls=proxy_url_lists, domain=domain_names)
def test_mark_unhealthy_increments_failure_count(
    urls: list[str],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 19: Failed proxy marked unhealthy
    # **Validates: Requirements 7.3**

    mgr = _make_manager_with_proxies(urls, cooldown=0)

    proxy = mgr.select(domain)
    initial_failures = proxy.failure_count

    mgr.mark_unhealthy(proxy)

    assert proxy.failure_count == initial_failures + 1
    assert proxy.is_healthy is False


# ---------------------------------------------------------------------------
# Property 20: Proxy per-domain cooldown
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    urls=proxy_url_lists,
    domain=domain_names,
    other_domain=domain_names,
)
def test_per_domain_cooldown_prevents_reuse(
    urls: list[str],
    domain: str,
    other_domain: str,
) -> None:
    # Feature: scraping-microservices, Property 20: Proxy per-domain cooldown
    # **Validates: Requirements 7.7**

    assume(domain != other_domain)
    assume(len(urls) >= 2)

    cooldown = 30
    mgr = _make_manager_with_proxies(urls, cooldown=cooldown)

    # Select a proxy for the domain
    first_proxy = mgr.select(domain)

    # Immediately selecting again for the SAME domain should skip the first proxy
    # (within cooldown window)
    second_proxy = mgr.select(domain)
    assert second_proxy.url != first_proxy.url

    # But selecting for a DIFFERENT domain should still be able to return the first proxy
    # Reset the index to start from the beginning to make this deterministic
    mgr._index = 0
    for i, p in enumerate(mgr._proxies):
        if p.url == first_proxy.url:
            mgr._index = i
            break

    other_proxy = mgr.select(other_domain)
    # The first proxy should be selectable for a different domain
    assert other_proxy.url == first_proxy.url


@settings(max_examples=100)
@given(urls=proxy_url_lists, domain=domain_names)
def test_cooldown_expires_allows_reuse(
    urls: list[str],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 20: Proxy per-domain cooldown
    # **Validates: Requirements 7.7**

    cooldown = 30
    mgr = _make_manager_with_proxies(urls, cooldown=cooldown)

    # Select a proxy for the domain
    first_proxy = mgr.select(domain)

    # Simulate cooldown expiry by backdating the last_used_domains timestamp
    first_proxy.last_used_domains[domain] = time.monotonic() - cooldown - 1

    # Reset index to point at the first proxy
    for i, p in enumerate(mgr._proxies):
        if p.url == first_proxy.url:
            mgr._index = i
            break

    # Now the same proxy should be selectable again for the same domain
    reselected = mgr.select(domain)
    assert reselected.url == first_proxy.url


# ---------------------------------------------------------------------------
# Property 21: Proxy metrics accuracy
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(urls=proxy_url_lists, events=event_sequences)
def test_metrics_match_recorded_events(
    urls: list[str],
    events: list[bool],
) -> None:
    # Feature: scraping-microservices, Property 21: Proxy metrics accuracy
    # **Validates: Requirements 7.6**

    mgr = _make_manager_with_proxies(urls, cooldown=0)

    # Track expected counts per proxy URL
    expected_successes: dict[str, int] = {u: 0 for u in urls}
    expected_failures: dict[str, int] = {u: 0 for u in urls}

    # Apply events round-robin across proxies
    for i, is_success in enumerate(events):
        proxy = mgr._proxies[i % len(urls)]
        if is_success:
            mgr.mark_success(proxy)
            expected_successes[proxy.url] += 1
        else:
            mgr.mark_unhealthy(proxy)
            expected_failures[proxy.url] += 1

    # Verify counts match
    for proxy in mgr._proxies:
        assert proxy.success_count == expected_successes[proxy.url]
        assert proxy.failure_count == expected_failures[proxy.url]


@settings(max_examples=100)
@given(urls=proxy_url_lists, events=event_sequences)
def test_stats_reflect_health_counts(
    urls: list[str],
    events: list[bool],
) -> None:
    # Feature: scraping-microservices, Property 21: Proxy metrics accuracy
    # **Validates: Requirements 7.6**

    mgr = _make_manager_with_proxies(urls, cooldown=0)

    # Apply events — mark_unhealthy makes proxy unhealthy
    for i, is_success in enumerate(events):
        proxy = mgr._proxies[i % len(urls)]
        if is_success:
            mgr.mark_success(proxy)
        else:
            mgr.mark_unhealthy(proxy)

    stats = mgr.get_stats()

    # Verify total count
    assert stats["total"] == len(urls)

    # Verify healthy/unhealthy counts match actual proxy states
    actual_healthy = sum(1 for p in mgr._proxies if p.is_healthy)
    actual_unhealthy = sum(1 for p in mgr._proxies if not p.is_healthy)
    assert stats["healthy"] == actual_healthy
    assert stats["unhealthy"] == actual_unhealthy

    # Verify per-proxy stats in the stats output
    for proxy_stat in stats["proxies"]:
        matching = [p for p in mgr._proxies if p.url == proxy_stat["url"]]
        assert len(matching) == 1
        p = matching[0]
        assert proxy_stat["success_count"] == p.success_count
        assert proxy_stat["failure_count"] == p.failure_count
        assert proxy_stat["is_healthy"] == p.is_healthy
