"""Unit tests for domain policy helpers — allowed scraping hours."""

import pytest

from src.config.domain_policies import AllowedHours, DomainPolicy
from src.resilience.domain_policy_helpers import is_within_allowed_hours


class TestIsWithinAllowedHours:
    """Tests for is_within_allowed_hours()."""

    def test_no_allowed_hours_always_permitted(self):
        """Policy with no allowed_hours constraint allows any hour."""
        policy = DomainPolicy(allowed_hours=None)
        for hour in range(24):
            assert is_within_allowed_hours(policy, current_hour=hour) is True

    def test_normal_range_inside(self):
        """Hour within [start, end) is permitted."""
        policy = DomainPolicy(allowed_hours=AllowedHours(start=6, end=22))
        assert is_within_allowed_hours(policy, current_hour=6) is True
        assert is_within_allowed_hours(policy, current_hour=12) is True
        assert is_within_allowed_hours(policy, current_hour=21) is True

    def test_normal_range_outside(self):
        """Hour outside [start, end) is not permitted."""
        policy = DomainPolicy(allowed_hours=AllowedHours(start=6, end=22))
        assert is_within_allowed_hours(policy, current_hour=5) is False
        assert is_within_allowed_hours(policy, current_hour=22) is False
        assert is_within_allowed_hours(policy, current_hour=0) is False
        assert is_within_allowed_hours(policy, current_hour=23) is False

    def test_wrapping_range_inside(self):
        """Hour within a wrapping range (start > end) is permitted."""
        policy = DomainPolicy(allowed_hours=AllowedHours(start=22, end=6))
        assert is_within_allowed_hours(policy, current_hour=22) is True
        assert is_within_allowed_hours(policy, current_hour=23) is True
        assert is_within_allowed_hours(policy, current_hour=0) is True
        assert is_within_allowed_hours(policy, current_hour=5) is True

    def test_wrapping_range_outside(self):
        """Hour outside a wrapping range (start > end) is not permitted."""
        policy = DomainPolicy(allowed_hours=AllowedHours(start=22, end=6))
        assert is_within_allowed_hours(policy, current_hour=6) is False
        assert is_within_allowed_hours(policy, current_hour=12) is False
        assert is_within_allowed_hours(policy, current_hour=21) is False

    def test_same_start_end_empty_window(self):
        """When start == end, the window is empty — no hour is permitted."""
        policy = DomainPolicy(allowed_hours=AllowedHours(start=10, end=10))
        for hour in range(24):
            assert is_within_allowed_hours(policy, current_hour=hour) is False

    def test_boundary_start_inclusive(self):
        """Start hour is inclusive."""
        policy = DomainPolicy(allowed_hours=AllowedHours(start=9, end=17))
        assert is_within_allowed_hours(policy, current_hour=9) is True

    def test_boundary_end_exclusive(self):
        """End hour is exclusive."""
        policy = DomainPolicy(allowed_hours=AllowedHours(start=9, end=17))
        assert is_within_allowed_hours(policy, current_hour=17) is False

    def test_defaults_to_current_utc_hour(self):
        """When current_hour is None, uses system clock (just verify no crash)."""
        policy = DomainPolicy(allowed_hours=AllowedHours(start=0, end=23))
        # Should not raise — result depends on actual time
        result = is_within_allowed_hours(policy)
        assert isinstance(result, bool)
