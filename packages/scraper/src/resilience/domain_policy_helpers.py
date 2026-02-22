"""Domain policy enforcement helpers.

Provides utility functions for checking domain policy constraints
such as allowed scraping hours.
"""

from __future__ import annotations

from datetime import datetime, timezone

from src.config.domain_policies import DomainPolicy


def is_within_allowed_hours(
    policy: DomainPolicy,
    current_hour: int | None = None,
) -> bool:
    """Check if scraping is permitted based on the policy's allowed hours.

    If the policy has no allowed_hours constraint, scraping is always permitted.
    The allowed window is interpreted as [start, end) in UTC hours (0-23).

    Args:
        policy: The domain policy to check.
        current_hour: UTC hour (0-23) to check against. If None, uses the
            current UTC hour from the system clock.

    Returns:
        True if scraping is permitted at the given hour, False otherwise.
    """
    if policy.allowed_hours is None:
        return True

    if current_hour is None:
        current_hour = datetime.now(timezone.utc).hour

    start = policy.allowed_hours.start
    end = policy.allowed_hours.end

    if start <= end:
        # Normal range: e.g. start=6, end=22 → [6, 22)
        return start <= current_hour < end
    else:
        # Wrapping range: e.g. start=22, end=6 → [22, 24) ∪ [0, 6)
        return current_hour >= start or current_hour < end
