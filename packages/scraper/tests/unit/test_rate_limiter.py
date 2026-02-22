"""Unit tests for the DomainRateLimiter token bucket implementation."""

from __future__ import annotations

import asyncio
import time
from unittest.mock import patch

import pytest

from src.resilience.rate_limiter import DomainRateLimiter, TokenBucket


class TestTokenBucket:
    """Tests for the TokenBucket dataclass."""

    def test_post_init_sets_original_refill_rate(self) -> None:
        bucket = TokenBucket(
            domain="example.com",
            tokens=2.0,
            max_tokens=2,
            refill_rate=0.2,
            last_refill=time.monotonic(),
        )
        assert bucket.original_refill_rate == 0.2

    def test_post_init_preserves_explicit_original_rate(self) -> None:
        bucket = TokenBucket(
            domain="example.com",
            tokens=2.0,
            max_tokens=2,
            refill_rate=0.1,
            last_refill=time.monotonic(),
            original_refill_rate=0.2,
        )
        assert bucket.original_refill_rate == 0.2

    def test_defaults(self) -> None:
        bucket = TokenBucket(
            domain="test.com",
            tokens=5.0,
            max_tokens=5,
            refill_rate=0.5,
            last_refill=0.0,
        )
        assert bucket.reduced_until is None
        assert bucket.original_refill_rate == 0.5


class TestDomainRateLimiter:
    """Tests for the DomainRateLimiter class."""

    def test_default_constructor(self) -> None:
        limiter = DomainRateLimiter()
        assert limiter._default_tokens == 2
        assert limiter._default_interval == 10

    def test_custom_constructor(self) -> None:
        limiter = DomainRateLimiter(default_tokens=5, default_interval=20)
        assert limiter._default_tokens == 5
        assert limiter._default_interval == 20

    @pytest.mark.asyncio
    async def test_acquire_creates_bucket_on_first_call(self) -> None:
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)
        await limiter.acquire("example.com")
        assert "example.com" in limiter._buckets
        bucket = limiter._buckets["example.com"]
        assert bucket.max_tokens == 2
        # One token consumed
        assert bucket.tokens < 2.0

    @pytest.mark.asyncio
    async def test_acquire_consumes_token(self) -> None:
        limiter = DomainRateLimiter(default_tokens=3, default_interval=10)
        await limiter.acquire("test.com")
        bucket = limiter._buckets["test.com"]
        # Started with 3, consumed 1
        assert bucket.tokens == pytest.approx(2.0, abs=0.1)

    @pytest.mark.asyncio
    async def test_acquire_multiple_tokens(self) -> None:
        limiter = DomainRateLimiter(default_tokens=3, default_interval=10)
        await limiter.acquire("test.com")
        await limiter.acquire("test.com")
        await limiter.acquire("test.com")
        bucket = limiter._buckets["test.com"]
        # Started with 3, consumed 3 (some refill may have happened)
        assert bucket.tokens < 1.0

    @pytest.mark.asyncio
    async def test_acquire_blocks_when_no_tokens(self) -> None:
        """Verify acquire blocks when tokens are exhausted and resumes after refill."""
        limiter = DomainRateLimiter(default_tokens=1, default_interval=1)

        # Consume the only token
        await limiter.acquire("slow.com")

        # Next acquire should block briefly until refill
        start = time.monotonic()
        await limiter.acquire("slow.com")
        elapsed = time.monotonic() - start

        # Should have waited roughly 1 second (1 token / 1 token per second)
        assert elapsed >= 0.5

    @pytest.mark.asyncio
    async def test_domain_isolation(self) -> None:
        """Rate limiting on one domain does not affect another."""
        limiter = DomainRateLimiter(default_tokens=1, default_interval=10)

        # Exhaust tokens for domain A
        await limiter.acquire("a.com")

        # Domain B should still have tokens available immediately
        start = time.monotonic()
        await limiter.acquire("b.com")
        elapsed = time.monotonic() - start

        assert elapsed < 0.5

    def test_get_stats_unknown_domain(self) -> None:
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)
        stats = limiter.get_stats("unknown.com")
        assert stats["current_tokens"] == 2.0
        assert stats["max_tokens"] == 2
        assert stats["refill_rate"] == pytest.approx(0.2)
        assert stats["is_reduced"] is False

    @pytest.mark.asyncio
    async def test_get_stats_known_domain(self) -> None:
        limiter = DomainRateLimiter(default_tokens=3, default_interval=10)
        await limiter.acquire("known.com")
        stats = limiter.get_stats("known.com")
        assert stats["max_tokens"] == 3
        assert stats["refill_rate"] == pytest.approx(0.3)
        assert stats["is_reduced"] is False
        assert stats["current_tokens"] < 3.0

    def test_reduce_rate(self) -> None:
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)
        # Create bucket by accessing it
        limiter._get_or_create_bucket("target.com")

        limiter.reduce_rate("target.com", factor=0.5, duration_seconds=300)

        bucket = limiter._buckets["target.com"]
        assert bucket.refill_rate == pytest.approx(0.1)  # 0.2 * 0.5
        assert bucket.original_refill_rate == pytest.approx(0.2)
        assert bucket.reduced_until is not None

    def test_reduce_rate_creates_bucket_if_missing(self) -> None:
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)
        limiter.reduce_rate("new.com")
        assert "new.com" in limiter._buckets
        stats = limiter.get_stats("new.com")
        assert stats["is_reduced"] is True

    def test_reduce_rate_does_not_compound(self) -> None:
        """Multiple reduce_rate calls should reduce from original, not current."""
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)
        limiter._get_or_create_bucket("target.com")

        limiter.reduce_rate("target.com", factor=0.5)
        limiter.reduce_rate("target.com", factor=0.5)

        bucket = limiter._buckets["target.com"]
        # Should be 0.2 * 0.5 = 0.1, not 0.1 * 0.5 = 0.05
        assert bucket.refill_rate == pytest.approx(0.1)

    @pytest.mark.asyncio
    async def test_rate_restores_after_backoff_expires(self) -> None:
        """After the backoff period, the original rate should be restored."""
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)
        limiter._get_or_create_bucket("restore.com")

        limiter.reduce_rate("restore.com", factor=0.5, duration_seconds=300)

        bucket = limiter._buckets["restore.com"]
        assert bucket.reduced_until is not None
        assert bucket.refill_rate == pytest.approx(0.1)

        # Simulate the backoff period having expired
        bucket.reduced_until = time.monotonic() - 1  # Already expired
        # Move last_refill back so _refill actually runs
        bucket.last_refill = time.monotonic() - 1

        stats = limiter.get_stats("restore.com")
        assert stats["is_reduced"] is False
        assert stats["refill_rate"] == pytest.approx(0.2)

    def test_load_policies(self) -> None:
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)
        limiter.load_policies("src/config/domain_policies.yaml")

        assert "linkedin.com" in limiter._policies
        assert limiter._policies["linkedin.com"]["tokens_per_interval"] == 1
        assert limiter._policies["linkedin.com"]["interval_seconds"] == 15

    @pytest.mark.asyncio
    async def test_load_policies_applies_to_new_buckets(self) -> None:
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)
        limiter.load_policies("src/config/domain_policies.yaml")

        await limiter.acquire("linkedin.com")
        bucket = limiter._buckets["linkedin.com"]
        assert bucket.max_tokens == 1
        # refill_rate = 1/15
        assert bucket.refill_rate == pytest.approx(1.0 / 15.0)

    @pytest.mark.asyncio
    async def test_load_policies_resets_existing_buckets(self) -> None:
        limiter = DomainRateLimiter(default_tokens=2, default_interval=10)

        # Create a bucket with defaults
        await limiter.acquire("linkedin.com")
        assert limiter._buckets["linkedin.com"].max_tokens == 2

        # Load policies — should reset the linkedin bucket
        limiter.load_policies("src/config/domain_policies.yaml")
        assert "linkedin.com" not in limiter._buckets

        # Next acquire should use policy values
        await limiter.acquire("linkedin.com")
        assert limiter._buckets["linkedin.com"].max_tokens == 1

    def test_load_policies_missing_file(self) -> None:
        limiter = DomainRateLimiter()
        # Should not raise, falls back to defaults
        limiter.load_policies("nonexistent.yaml")
        assert "default" in limiter._policies

    @pytest.mark.asyncio
    async def test_tokens_do_not_exceed_max(self) -> None:
        """Tokens should never refill beyond max_tokens."""
        limiter = DomainRateLimiter(default_tokens=2, default_interval=1)
        bucket = limiter._get_or_create_bucket("cap.com")

        # Simulate a long time passing
        bucket.last_refill = time.monotonic() - 100

        limiter._refill(bucket)
        assert bucket.tokens <= float(bucket.max_tokens)
