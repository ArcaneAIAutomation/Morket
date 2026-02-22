"""Property tests for domain policies: YAML parsing round trip, allowed hours
enforcement, and robots.txt compliance.

Validates Properties 23, 24, and 25 from the design document.
"""

from __future__ import annotations

import tempfile
import time
from pathlib import Path
from urllib.robotparser import RobotFileParser

import yaml
from hypothesis import given, settings, assume
from hypothesis import strategies as st

from src.config.domain_policies import AllowedHours, DomainPolicy, load_domain_policies
from src.resilience.domain_policy_helpers import is_within_allowed_hours
from src.resilience.robots_checker import RobotsChecker, _CachedRobots


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Random allowed hours (start and end are 0-23)
allowed_hours_st = st.builds(
    AllowedHours,
    start=st.integers(min_value=0, max_value=23),
    end=st.integers(min_value=0, max_value=23),
)

# Random domain policy with optional allowed hours
domain_policy_st = st.builds(
    DomainPolicy,
    tokens_per_interval=st.integers(min_value=1, max_value=20),
    interval_seconds=st.integers(min_value=1, max_value=60),
    min_delay_ms=st.integers(min_value=0, max_value=5000),
    max_delay_ms=st.integers(min_value=0, max_value=10000),
    allowed_hours=st.one_of(st.none(), allowed_hours_st),
    respect_robots_txt=st.booleans(),
)

# Domain names for YAML keys
domain_names_st = st.from_regex(r"[a-z]{3,10}\.(com|org|net|io)", fullmatch=True)

# Current UTC hour
hours_st = st.integers(min_value=0, max_value=23)

# Simple URL paths for robots.txt testing
url_paths_st = st.from_regex(r"/[a-z]{1,10}(/[a-z]{1,10}){0,3}", fullmatch=True)


# ---------------------------------------------------------------------------
# Property 23: Domain policy YAML parsing round trip
# ---------------------------------------------------------------------------


def _policy_to_yaml_dict(policy: DomainPolicy) -> dict:
    """Serialize a DomainPolicy to a plain dict suitable for YAML output."""
    d: dict = {
        "tokens_per_interval": policy.tokens_per_interval,
        "interval_seconds": policy.interval_seconds,
        "min_delay_ms": policy.min_delay_ms,
        "max_delay_ms": policy.max_delay_ms,
        "respect_robots_txt": policy.respect_robots_txt,
    }
    if policy.allowed_hours is not None:
        d["allowed_hours"] = {
            "start": policy.allowed_hours.start,
            "end": policy.allowed_hours.end,
        }
    return d


@settings(max_examples=100)
@given(
    policies=st.dictionaries(
        keys=domain_names_st,
        values=domain_policy_st,
        min_size=1,
        max_size=5,
    ),
)
def test_yaml_parsing_round_trip(policies: dict[str, DomainPolicy]) -> None:
    # Feature: scraping-microservices, Property 23: Domain policy YAML parsing round trip
    # **Validates: Requirements 8.3**

    # Build YAML structure
    yaml_dict = {"domains": {domain: _policy_to_yaml_dict(p) for domain, p in policies.items()}}

    # Write to temp file and load back
    with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
        yaml.safe_dump(yaml_dict, f)
        tmp_path = f.name

    loaded = load_domain_policies(tmp_path)

    # Every original domain should be present and equivalent
    for domain, original in policies.items():
        assert domain in loaded, f"Domain '{domain}' missing after round trip"
        loaded_policy = loaded[domain]
        assert loaded_policy.tokens_per_interval == original.tokens_per_interval
        assert loaded_policy.interval_seconds == original.interval_seconds
        assert loaded_policy.min_delay_ms == original.min_delay_ms
        assert loaded_policy.max_delay_ms == original.max_delay_ms
        assert loaded_policy.respect_robots_txt == original.respect_robots_txt
        if original.allowed_hours is None:
            assert loaded_policy.allowed_hours is None
        else:
            assert loaded_policy.allowed_hours is not None
            assert loaded_policy.allowed_hours.start == original.allowed_hours.start
            assert loaded_policy.allowed_hours.end == original.allowed_hours.end

    # Clean up
    Path(tmp_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Property 24: Allowed scraping hours enforcement
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(
    start=st.integers(min_value=0, max_value=23),
    end=st.integers(min_value=0, max_value=23),
    current_hour=hours_st,
)
def test_allowed_hours_normal_and_wrapping(start: int, end: int, current_hour: int) -> None:
    # Feature: scraping-microservices, Property 24: Allowed scraping hours enforcement
    # **Validates: Requirements 8.4**
    policy = DomainPolicy(allowed_hours=AllowedHours(start=start, end=end))
    result = is_within_allowed_hours(policy, current_hour)

    if start <= end:
        # Normal range: [start, end)
        expected = start <= current_hour < end
    else:
        # Wrapping range: [start, 24) ∪ [0, end)
        expected = current_hour >= start or current_hour < end

    assert result == expected, (
        f"start={start}, end={end}, hour={current_hour}: "
        f"got {result}, expected {expected}"
    )


@settings(max_examples=100)
@given(current_hour=hours_st)
def test_no_allowed_hours_always_permits(current_hour: int) -> None:
    # Feature: scraping-microservices, Property 24: Allowed scraping hours enforcement
    # **Validates: Requirements 8.4**
    policy = DomainPolicy(allowed_hours=None)
    assert is_within_allowed_hours(policy, current_hour) is True


# ---------------------------------------------------------------------------
# Property 25: Robots.txt compliance
# ---------------------------------------------------------------------------


def _build_robots_txt(disallowed_paths: list[str]) -> str:
    """Build a simple robots.txt that disallows the given paths for all agents."""
    lines = ["User-agent: *"]
    for path in disallowed_paths:
        lines.append(f"Disallow: {path}")
    return "\n".join(lines)


def _populate_cache(checker: RobotsChecker, domain: str, content: str) -> None:
    """Directly populate the robots checker cache without HTTP fetching."""
    parser = RobotFileParser()
    parser.parse(content.splitlines())
    checker._cache[domain] = _CachedRobots(
        content=content,
        parser=parser,
        fetched_at=time.monotonic(),
    )


@settings(max_examples=100)
@given(
    disallowed=st.lists(url_paths_st, min_size=1, max_size=5, unique=True),
    check_path=url_paths_st,
)
def test_robots_txt_disallow_compliance(
    disallowed: list[str],
    check_path: str,
) -> None:
    # Feature: scraping-microservices, Property 25: Robots.txt compliance
    # **Validates: Requirements 8.5**
    domain = "example.com"
    content = _build_robots_txt(disallowed)
    checker = RobotsChecker()
    _populate_cache(checker, domain, content)

    allowed = checker.is_url_allowed(domain, check_path)

    # A path is disallowed if it starts with any disallowed prefix
    should_be_disallowed = any(check_path.startswith(d) for d in disallowed)

    if should_be_disallowed:
        assert allowed is False, (
            f"Path '{check_path}' should be disallowed by rules {disallowed}"
        )
    else:
        assert allowed is True, (
            f"Path '{check_path}' should be allowed (not matching {disallowed})"
        )


@settings(max_examples=100)
@given(check_path=url_paths_st)
def test_robots_txt_no_cache_permits_all(check_path: str) -> None:
    # Feature: scraping-microservices, Property 25: Robots.txt compliance
    # **Validates: Requirements 8.5**
    checker = RobotsChecker()
    # No cache populated — permissive default
    assert checker.is_url_allowed("uncached-domain.com", check_path) is True


@settings(max_examples=100)
@given(check_path=url_paths_st)
def test_robots_txt_empty_disallow_permits_all(check_path: str) -> None:
    # Feature: scraping-microservices, Property 25: Robots.txt compliance
    # **Validates: Requirements 8.5**
    domain = "open-domain.com"
    content = "User-agent: *\nDisallow:"
    checker = RobotsChecker()
    _populate_cache(checker, domain, content)
    assert checker.is_url_allowed(domain, check_path) is True
