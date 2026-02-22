"""Unit tests for the fingerprint randomizer."""

from __future__ import annotations

import random

import pytest

from src.browser.fingerprint import (
    ALL_LANGUAGES,
    ALL_TIMEZONES,
    CURATED_USER_AGENTS,
    REGION_GEOLOCATIONS,
    VALID_LANGUAGES,
    VALID_TIMEZONES,
    FingerprintProfile,
    FingerprintRandomizer,
)


class TestFingerprintProfile:
    """Tests for the FingerprintProfile dataclass."""

    def test_create_profile(self) -> None:
        profile = FingerprintProfile(
            user_agent="Mozilla/5.0 Test",
            viewport_width=1920,
            viewport_height=1080,
            timezone="America/New_York",
            language="en-US",
            geolocation={"latitude": 40.7128, "longitude": -74.0060},
        )
        assert profile.user_agent == "Mozilla/5.0 Test"
        assert profile.viewport_width == 1920
        assert profile.viewport_height == 1080
        assert profile.timezone == "America/New_York"
        assert profile.language == "en-US"
        assert profile.geolocation == {"latitude": 40.7128, "longitude": -74.0060}

    def test_create_profile_without_geolocation(self) -> None:
        profile = FingerprintProfile(
            user_agent="Mozilla/5.0 Test",
            viewport_width=1280,
            viewport_height=720,
            timezone="Europe/London",
            language="en-GB",
            geolocation=None,
        )
        assert profile.geolocation is None


class TestCuratedLists:
    """Tests for the curated data lists."""

    def test_user_agents_has_at_least_10(self) -> None:
        assert len(CURATED_USER_AGENTS) >= 10

    def test_all_user_agents_are_chrome(self) -> None:
        for ua in CURATED_USER_AGENTS:
            assert "Chrome/" in ua
            assert "Mozilla/5.0" in ua

    def test_valid_timezones_covers_key_regions(self) -> None:
        for region in ("US", "EU", "UK", "JP", "AU"):
            assert region in VALID_TIMEZONES
            assert len(VALID_TIMEZONES[region]) >= 1

    def test_valid_languages_covers_key_regions(self) -> None:
        for region in ("US", "EU", "UK", "JP", "AU"):
            assert region in VALID_LANGUAGES
            assert len(VALID_LANGUAGES[region]) >= 1

    def test_region_geolocations_covers_key_regions(self) -> None:
        for region in ("US", "EU", "UK", "JP", "AU"):
            assert region in REGION_GEOLOCATIONS
            geo = REGION_GEOLOCATIONS[region]
            assert "latitude" in geo
            assert "longitude" in geo

    def test_all_timezones_is_flat_list(self) -> None:
        assert len(ALL_TIMEZONES) > 0
        for tz in ALL_TIMEZONES:
            assert "/" in tz  # e.g. America/New_York

    def test_all_languages_is_flat_list(self) -> None:
        assert len(ALL_LANGUAGES) > 0
        for lang in ALL_LANGUAGES:
            assert "-" in lang  # e.g. en-US


class TestFingerprintRandomizer:
    """Tests for the FingerprintRandomizer class."""

    def test_generate_returns_profile(self) -> None:
        randomizer = FingerprintRandomizer()
        profile = randomizer.generate()
        assert isinstance(profile, FingerprintProfile)

    def test_generate_user_agent_from_curated_list(self) -> None:
        randomizer = FingerprintRandomizer()
        profile = randomizer.generate()
        assert profile.user_agent in CURATED_USER_AGENTS

    def test_generate_viewport_within_range(self) -> None:
        randomizer = FingerprintRandomizer()
        profile = randomizer.generate()
        assert 1280 <= profile.viewport_width <= 1920
        assert 720 <= profile.viewport_height <= 1080

    def test_generate_with_region_us(self) -> None:
        randomizer = FingerprintRandomizer()
        profile = randomizer.generate(proxy_region="US")
        assert profile.timezone in VALID_TIMEZONES["US"]
        assert profile.language in VALID_LANGUAGES["US"]
        assert profile.geolocation == REGION_GEOLOCATIONS["US"]

    def test_generate_with_region_eu(self) -> None:
        randomizer = FingerprintRandomizer()
        profile = randomizer.generate(proxy_region="EU")
        assert profile.timezone in VALID_TIMEZONES["EU"]
        assert profile.language in VALID_LANGUAGES["EU"]
        assert profile.geolocation == REGION_GEOLOCATIONS["EU"]

    def test_generate_with_region_case_insensitive(self) -> None:
        randomizer = FingerprintRandomizer()
        profile = randomizer.generate(proxy_region="us")
        assert profile.timezone in VALID_TIMEZONES["US"]
        assert profile.language in VALID_LANGUAGES["US"]

    def test_generate_with_unknown_region_uses_general_pool(self) -> None:
        randomizer = FingerprintRandomizer()
        profile = randomizer.generate(proxy_region="ZZ")
        assert profile.timezone in ALL_TIMEZONES
        assert profile.language in ALL_LANGUAGES
        assert profile.geolocation is None

    def test_generate_without_region_uses_general_pool(self) -> None:
        randomizer = FingerprintRandomizer()
        profile = randomizer.generate()
        assert profile.timezone in ALL_TIMEZONES
        assert profile.language in ALL_LANGUAGES
        assert profile.geolocation is None

    def test_generate_deterministic_with_seed(self) -> None:
        rng1 = random.Random(42)
        rng2 = random.Random(42)
        r1 = FingerprintRandomizer(rng=rng1)
        r2 = FingerprintRandomizer(rng=rng2)
        p1 = r1.generate(proxy_region="US")
        p2 = r2.generate(proxy_region="US")
        assert p1 == p2

    def test_consecutive_profiles_differ(self) -> None:
        """Two consecutive profiles should differ in at least one attribute."""
        randomizer = FingerprintRandomizer()
        p1 = randomizer.generate()
        # Generate many to ensure at least one differs (probabilistic but near-certain)
        found_different = False
        for _ in range(20):
            p2 = randomizer.generate()
            if (
                p1.user_agent != p2.user_agent
                or p1.viewport_width != p2.viewport_width
                or p1.viewport_height != p2.viewport_height
                or p1.timezone != p2.timezone
                or p1.language != p2.language
            ):
                found_different = True
                break
        assert found_different, "20 consecutive profiles were all identical"


class TestGetActionDelay:
    """Tests for the get_action_delay method."""

    def test_default_range(self) -> None:
        randomizer = FingerprintRandomizer()
        delay = randomizer.get_action_delay()
        assert 500.0 <= delay <= 2000.0

    def test_custom_range(self) -> None:
        randomizer = FingerprintRandomizer()
        delay = randomizer.get_action_delay(min_delay_ms=100, max_delay_ms=200)
        assert 100.0 <= delay <= 200.0

    def test_equal_min_max(self) -> None:
        randomizer = FingerprintRandomizer()
        delay = randomizer.get_action_delay(min_delay_ms=1000, max_delay_ms=1000)
        assert delay == 1000.0

    def test_returns_float(self) -> None:
        randomizer = FingerprintRandomizer()
        delay = randomizer.get_action_delay()
        assert isinstance(delay, float)
