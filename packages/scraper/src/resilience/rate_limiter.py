"""Per-domain token bucket rate limiter.

Enforces per-domain request rate limits using a token bucket algorithm.
Each domain gets its own bucket with configurable tokens and refill rate.
Supports adaptive backoff on 429 responses and per-domain policy overrides
loaded from YAML.

Key behaviors:
- acquire() blocks (async sleep) until a token is available
- reduce_rate() halves the refill rate for a configurable duration on 429
- After the backoff period expires, the original rate is restored
- Per-domain overrides loaded via load_policies()
- Rate limiting on one domain does not affect other domains
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from src.config.domain_policies import load_domain_policies

logger = logging.getLogger(__name__)


@dataclass
class TokenBucket:
    """Token bucket state for a single domain."""

    domain: str
    tokens: float
    max_tokens: int
    refill_rate: float  # tokens per second
    last_refill: float  # time.monotonic()
    reduced_until: float | None = None  # Adaptive backoff expiry
    original_refill_rate: float = 0.0  # For restoring after backoff

    def __post_init__(self) -> None:
        if self.original_refill_rate == 0.0:
            self.original_refill_rate = self.refill_rate


class DomainRateLimiter:
    """Per-domain token bucket rate limiter.

    Args:
        default_tokens: Default max tokens per domain bucket.
        default_interval: Default refill interval in seconds.
    """

    def __init__(
        self,
        default_tokens: int = 2,
        default_interval: int = 10,
    ) -> None:
        self._default_tokens = default_tokens
        self._default_interval = default_interval
        self._buckets: dict[str, TokenBucket] = {}
        self._policies: dict[str, dict] = {}
        self._lock = asyncio.Lock()

    def _get_or_create_bucket(self, domain: str) -> TokenBucket:
        """Get existing bucket for a domain or create one with defaults/policy."""
        if domain not in self._buckets:
            tokens = self._default_tokens
            interval = self._default_interval

            # Check for domain-specific policy
            if domain in self._policies:
                policy = self._policies[domain]
                tokens = policy.get("tokens_per_interval", self._default_tokens)
                interval = policy.get("interval_seconds", self._default_interval)

            refill_rate = tokens / interval if interval > 0 else float(tokens)

            self._buckets[domain] = TokenBucket(
                domain=domain,
                tokens=float(tokens),
                max_tokens=tokens,
                refill_rate=refill_rate,
                last_refill=time.monotonic(),
                original_refill_rate=refill_rate,
            )

        return self._buckets[domain]

    def _refill(self, bucket: TokenBucket) -> None:
        """Refill tokens based on elapsed time since last refill."""
        now = time.monotonic()
        elapsed = now - bucket.last_refill

        if elapsed <= 0:
            return

        # Check if adaptive backoff has expired and restore original rate
        if bucket.reduced_until is not None and now >= bucket.reduced_until:
            bucket.refill_rate = bucket.original_refill_rate
            bucket.reduced_until = None
            logger.info(
                "Rate restored for domain %s to %.4f tokens/s",
                bucket.domain,
                bucket.refill_rate,
            )

        new_tokens = elapsed * bucket.refill_rate
        bucket.tokens = min(bucket.tokens + new_tokens, float(bucket.max_tokens))
        bucket.last_refill = now

    async def acquire(self, domain: str) -> None:
        """Block until a token is available for the given domain.

        Refills tokens based on elapsed time, checks for backoff expiry,
        and sleeps if no tokens are available.
        """
        while True:
            async with self._lock:
                bucket = self._get_or_create_bucket(domain)
                self._refill(bucket)

                if bucket.tokens >= 1.0:
                    bucket.tokens -= 1.0
                    return

                # Calculate wait time until next token
                wait_time = (1.0 - bucket.tokens) / bucket.refill_rate if bucket.refill_rate > 0 else 1.0

            # Sleep outside the lock so other domains can proceed
            await asyncio.sleep(wait_time)

    def reduce_rate(
        self,
        domain: str,
        factor: float = 0.5,
        duration_seconds: int = 300,
    ) -> None:
        """Reduce the token refill rate for a domain (adaptive backoff on 429).

        Args:
            domain: The target domain.
            factor: Multiplier for the refill rate (0.5 = 50% reduction).
            duration_seconds: How long the reduction lasts in seconds.
        """
        bucket = self._get_or_create_bucket(domain)

        # Only reduce from the original rate to avoid compounding reductions
        bucket.refill_rate = bucket.original_refill_rate * factor
        bucket.reduced_until = time.monotonic() + duration_seconds

        logger.warning(
            "Rate reduced for domain %s: %.4f → %.4f tokens/s for %ds",
            domain,
            bucket.original_refill_rate,
            bucket.refill_rate,
            duration_seconds,
        )

    def get_stats(self, domain: str) -> dict:
        """Get current rate limiter stats for a domain.

        Returns:
            Dict with current_tokens, max_tokens, refill_rate, is_reduced.
            Returns default stats for unknown domains.
        """
        if domain not in self._buckets:
            return {
                "current_tokens": float(self._default_tokens),
                "max_tokens": self._default_tokens,
                "refill_rate": self._default_tokens / self._default_interval
                if self._default_interval > 0
                else float(self._default_tokens),
                "is_reduced": False,
            }

        bucket = self._buckets[domain]
        self._refill(bucket)

        return {
            "current_tokens": bucket.tokens,
            "max_tokens": bucket.max_tokens,
            "refill_rate": bucket.refill_rate,
            "is_reduced": bucket.reduced_until is not None,
        }

    def load_policies(self, yaml_path: str) -> None:
        """Load per-domain rate limit overrides from a YAML file.

        Uses the existing domain_policies loader and extracts rate limit
        fields (tokens_per_interval, interval_seconds) for each domain.
        Existing buckets for domains with new policies are reset.

        Args:
            yaml_path: Path to the domain_policies.yaml file.
        """
        policies = load_domain_policies(yaml_path)

        self._policies = {}
        for domain, policy in policies.items():
            self._policies[domain] = {
                "tokens_per_interval": policy.tokens_per_interval,
                "interval_seconds": policy.interval_seconds,
            }

        # Reset existing buckets for domains that now have policies
        # so they pick up the new configuration on next access
        for domain in list(self._buckets.keys()):
            if domain in self._policies:
                del self._buckets[domain]

        logger.info(
            "Loaded rate limit policies for %d domains from %s",
            len(self._policies),
            yaml_path,
        )
