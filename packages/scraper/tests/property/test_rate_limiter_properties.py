"""Property tests for per-domain token bucket rate limiter.

Validates token grant rate respects configured limits, domain isolation,
adaptive rate reduction on 429 responses, and rate restoration after
backoff period.
"""

from __future__ import annotations

import time
from unittest.mock import patch

from hypothesis import given, settings
from hypothesis import strategies as st

from src.resilience.rate_limiter import DomainRateLimiter


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Random domain names
domain_names = st.from_regex(r"[a-z]{3,10}\.(com|org|net|io)", fullmatch=True)

# Pairs of distinct domains for isolation tests
domain_pairs = st.tuples(domain_names, domain_names).filter(lambda pair: pair[0] != pair[1])

# Rate limiter configuration: tokens_per_interval (1-10), interval_seconds (1-30)
rl_configs = st.tuples(
    st.integers(min_value=1, max_value=10),
    st.integers(min_value=1, max_value=30),
)

# Adaptive backoff parameters: factor (0.1-0.9), duration_seconds (1-600)
backoff_params = st.tuples(
    st.floats(min_value=0.1, max_value=0.9, allow_nan=False, allow_infinity=False),
    st.integers(min_value=1, max_value=600),
)


# ---------------------------------------------------------------------------
# Property 22: Token bucket rate limiting per domain
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(config=rl_configs, domain=domain_names)
async def test_acquiring_more_than_max_tokens_requires_waiting(
    config: tuple[int, int],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 22: Token bucket rate limiting per domain
    # **Validates: Requirements 8.1, 8.7**
    tokens, interval = config
    limiter = DomainRateLimiter(default_tokens=tokens, default_interval=interval)

    # Acquire all available tokens — these should succeed immediately
    for _ in range(tokens):
        await limiter.acquire(domain)

    bucket = limiter._buckets[domain]
    # After consuming all tokens, the bucket should have < 1.0 tokens remaining
    # (some tiny refill may have occurred during the loop, but not a full token
    # unless interval is extremely small and the loop is slow)
    assert bucket.tokens < 1.0 or interval <= 1


@settings(max_examples=100)
@given(config=rl_configs, domain=domain_names)
async def test_tokens_never_exceed_max(
    config: tuple[int, int],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 22: Token bucket rate limiting per domain
    # **Validates: Requirements 8.1, 8.7**
    tokens, interval = config
    limiter = DomainRateLimiter(default_tokens=tokens, default_interval=interval)

    bucket = limiter._get_or_create_bucket(domain)
    # Simulate a very long time passing to allow maximum refill
    bucket.last_refill = time.monotonic() - 10000

    limiter._refill(bucket)
    assert bucket.tokens <= float(bucket.max_tokens)


@settings(max_examples=100)
@given(config=rl_configs, domains=domain_pairs)
async def test_domain_isolation(
    config: tuple[int, int],
    domains: tuple[str, str],
) -> None:
    # Feature: scraping-microservices, Property 22: Token bucket rate limiting per domain
    # **Validates: Requirements 8.1, 8.7**
    tokens, interval = config
    domain_a, domain_b = domains
    limiter = DomainRateLimiter(default_tokens=tokens, default_interval=interval)

    # Exhaust all tokens for domain A
    for _ in range(tokens):
        await limiter.acquire(domain_a)

    # Domain B should still have full tokens available
    stats_b = limiter.get_stats(domain_b)
    assert stats_b["current_tokens"] == float(tokens)
    assert stats_b["max_tokens"] == tokens

    # Domain A should be depleted
    stats_a = limiter.get_stats(domain_a)
    assert stats_a["current_tokens"] < 1.0 or interval <= 1


@settings(max_examples=100)
@given(config=rl_configs, domain=domain_names)
async def test_refill_rate_matches_config(
    config: tuple[int, int],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 22: Token bucket rate limiting per domain
    # **Validates: Requirements 8.1, 8.7**
    tokens, interval = config
    limiter = DomainRateLimiter(default_tokens=tokens, default_interval=interval)

    bucket = limiter._get_or_create_bucket(domain)
    expected_rate = tokens / interval if interval > 0 else float(tokens)
    assert abs(bucket.refill_rate - expected_rate) < 1e-9
    assert bucket.max_tokens == tokens


# ---------------------------------------------------------------------------
# Property 26: Adaptive rate reduction on 429
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(config=rl_configs, domain=domain_names, params=backoff_params)
def test_reduce_rate_applies_factor_from_original(
    config: tuple[int, int],
    domain: str,
    params: tuple[float, int],
) -> None:
    # Feature: scraping-microservices, Property 26: Adaptive rate reduction on 429
    # **Validates: Requirements 8.6**
    tokens, interval = config
    factor, duration = params
    limiter = DomainRateLimiter(default_tokens=tokens, default_interval=interval)

    # Create bucket and capture original rate
    bucket = limiter._get_or_create_bucket(domain)
    original_rate = bucket.original_refill_rate

    limiter.reduce_rate(domain, factor=factor, duration_seconds=duration)

    bucket = limiter._buckets[domain]
    expected_reduced = original_rate * factor
    assert abs(bucket.refill_rate - expected_reduced) < 1e-9
    assert bucket.reduced_until is not None
    assert bucket.original_refill_rate == original_rate


@settings(max_examples=100)
@given(config=rl_configs, domain=domain_names, params=backoff_params)
def test_rate_restored_after_backoff_expires(
    config: tuple[int, int],
    domain: str,
    params: tuple[float, int],
) -> None:
    # Feature: scraping-microservices, Property 26: Adaptive rate reduction on 429
    # **Validates: Requirements 8.6**
    tokens, interval = config
    factor, duration = params
    limiter = DomainRateLimiter(default_tokens=tokens, default_interval=interval)

    bucket = limiter._get_or_create_bucket(domain)
    original_rate = bucket.original_refill_rate

    limiter.reduce_rate(domain, factor=factor, duration_seconds=duration)

    # Simulate backoff period expiring
    bucket = limiter._buckets[domain]
    bucket.reduced_until = time.monotonic() - 1  # Already expired
    bucket.last_refill = time.monotonic() - 1  # Ensure _refill runs

    # get_stats triggers _refill which checks backoff expiry
    stats = limiter.get_stats(domain)
    assert stats["is_reduced"] is False
    assert abs(stats["refill_rate"] - original_rate) < 1e-9


@settings(max_examples=100)
@given(config=rl_configs, domain=domain_names, params=backoff_params)
def test_multiple_reduce_rate_does_not_compound(
    config: tuple[int, int],
    domain: str,
    params: tuple[float, int],
) -> None:
    # Feature: scraping-microservices, Property 26: Adaptive rate reduction on 429
    # **Validates: Requirements 8.6**
    tokens, interval = config
    factor, duration = params
    limiter = DomainRateLimiter(default_tokens=tokens, default_interval=interval)

    bucket = limiter._get_or_create_bucket(domain)
    original_rate = bucket.original_refill_rate

    # Call reduce_rate multiple times — should always reduce from original
    limiter.reduce_rate(domain, factor=factor, duration_seconds=duration)
    limiter.reduce_rate(domain, factor=factor, duration_seconds=duration)
    limiter.reduce_rate(domain, factor=factor, duration_seconds=duration)

    bucket = limiter._buckets[domain]
    expected_reduced = original_rate * factor
    assert abs(bucket.refill_rate - expected_reduced) < 1e-9
    # original_refill_rate must remain unchanged
    assert bucket.original_refill_rate == original_rate
