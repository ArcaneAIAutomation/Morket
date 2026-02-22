"""Property tests for fingerprint randomizer.

Validates fingerprint attribute ranges, geo-consistency with proxy region,
rotation across sessions, and action delay bounds.
"""

from __future__ import annotations

from hypothesis import assume, given, settings
from hypothesis import strategies as st

from src.browser.fingerprint import (
    ALL_LANGUAGES,
    ALL_TIMEZONES,
    CURATED_USER_AGENTS,
    REGION_GEOLOCATIONS,
    VALID_LANGUAGES,
    VALID_TIMEZONES,
    FingerprintRandomizer,
)


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Valid proxy regions
valid_regions = st.sampled_from(list(VALID_TIMEZONES.keys()))

# Optional region (None or a valid region string)
optional_regions = st.one_of(st.none(), valid_regions)

# Delay range: min in [100, 5000], max >= min
delay_ranges = st.integers(min_value=100, max_value=5000).flatmap(
    lambda lo: st.integers(min_value=lo, max_value=lo + 5000).map(
        lambda hi: (lo, hi)
    )
)

# Random seeds for reproducibility control
seeds = st.integers(min_value=0, max_value=2**32 - 1)


# ---------------------------------------------------------------------------
# Property 14: Fingerprint attributes within valid ranges
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(seed=seeds, region=optional_regions)
def test_fingerprint_attributes_within_valid_ranges(
    seed: int,
    region: str | None,
) -> None:
    # Feature: scraping-microservices, Property 14: Fingerprint attributes within valid ranges
    # **Validates: Requirements 6.1, 6.2**

    import random

    rng = random.Random(seed)
    randomizer = FingerprintRandomizer(rng=rng)
    profile = randomizer.generate(proxy_region=region)

    # User agent must be from the curated list
    assert profile.user_agent in CURATED_USER_AGENTS, (
        f"User agent not in curated list: {profile.user_agent}"
    )

    # Viewport width must be in [1280, 1920]
    assert 1280 <= profile.viewport_width <= 1920, (
        f"Viewport width out of range: {profile.viewport_width}"
    )

    # Viewport height must be in [720, 1080]
    assert 720 <= profile.viewport_height <= 1080, (
        f"Viewport height out of range: {profile.viewport_height}"
    )


# ---------------------------------------------------------------------------
# Property 15: Fingerprint geo-consistency with proxy region
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(seed=seeds, region=valid_regions)
def test_fingerprint_geo_consistency_with_proxy_region(
    seed: int,
    region: str,
) -> None:
    # Feature: scraping-microservices, Property 15: Fingerprint geo-consistency with proxy region
    # **Validates: Requirements 6.3**

    import random

    rng = random.Random(seed)
    randomizer = FingerprintRandomizer(rng=rng)
    profile = randomizer.generate(proxy_region=region)

    # Timezone must be from the region's valid timezones
    assert profile.timezone in VALID_TIMEZONES[region], (
        f"Timezone {profile.timezone} not valid for region {region}"
    )

    # Language must be from the region's valid languages
    assert profile.language in VALID_LANGUAGES[region], (
        f"Language {profile.language} not valid for region {region}"
    )

    # Geolocation must match the region's geolocation
    expected_geo = REGION_GEOLOCATIONS.get(region)
    assert profile.geolocation == expected_geo, (
        f"Geolocation {profile.geolocation} doesn't match region {region} "
        f"(expected {expected_geo})"
    )


# ---------------------------------------------------------------------------
# Property 16: Fingerprint rotation across sessions
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(seed=seeds, region=optional_regions)
def test_fingerprint_rotation_across_sessions(
    seed: int,
    region: str | None,
) -> None:
    # Feature: scraping-microservices, Property 16: Fingerprint rotation across sessions
    # **Validates: Requirements 6.6**

    import random

    rng = random.Random(seed)
    randomizer = FingerprintRandomizer(rng=rng)

    profile_a = randomizer.generate(proxy_region=region)
    profile_b = randomizer.generate(proxy_region=region)

    # At least one attribute must differ between consecutive profiles
    differs = (
        profile_a.user_agent != profile_b.user_agent
        or profile_a.viewport_width != profile_b.viewport_width
        or profile_a.viewport_height != profile_b.viewport_height
        or profile_a.timezone != profile_b.timezone
        or profile_a.language != profile_b.language
    )

    assert differs, (
        "Two consecutive fingerprint profiles are identical — "
        "rotation requirement violated"
    )


# ---------------------------------------------------------------------------
# Property 17: Action delays within configured range
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(seed=seeds, delay_range=delay_ranges)
def test_action_delays_within_configured_range(
    seed: int,
    delay_range: tuple[int, int],
) -> None:
    # Feature: scraping-microservices, Property 17: Action delays within configured range
    # **Validates: Requirements 6.5**

    import random

    min_delay_ms, max_delay_ms = delay_range

    rng = random.Random(seed)
    randomizer = FingerprintRandomizer(rng=rng)

    # Generate several delays and verify all are within range
    for _ in range(10):
        delay = randomizer.get_action_delay(
            min_delay_ms=min_delay_ms,
            max_delay_ms=max_delay_ms,
        )
        assert min_delay_ms <= delay <= max_delay_ms, (
            f"Delay {delay} outside range [{min_delay_ms}, {max_delay_ms}]"
        )
