"""Property tests for per-domain circuit breaker.

Validates state transitions (closed→open→half-open→closed/open) based on
failure counts within the sliding window, open-state rejection, and
half-open probe behavior.
"""

from __future__ import annotations

import time
from unittest.mock import patch

from hypothesis import given, settings
from hypothesis import strategies as st

from src.resilience.circuit_breaker import CircuitState, DomainCircuitBreaker


# ---------------------------------------------------------------------------
# Strategies
# ---------------------------------------------------------------------------

# Random domain names
domain_names = st.from_regex(r"[a-z]{3,10}\.(com|org|net|io)", fullmatch=True)

# Circuit breaker configuration: window_size 2-20, failure_threshold 1..window_size, cooldown 1-300
cb_configs = st.integers(min_value=2, max_value=20).flatmap(
    lambda ws: st.tuples(
        st.just(ws),
        st.integers(min_value=1, max_value=ws),
        st.integers(min_value=1, max_value=300),
    )
)


# ---------------------------------------------------------------------------
# Property 27: Circuit breaker state transition on failures
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(config=cb_configs, domain=domain_names)
def test_closed_to_open_on_threshold_failures(
    config: tuple[int, int, int],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 27: Circuit breaker state transition on failures
    # **Validates: Requirements 9.1, 9.2**
    window_size, failure_threshold, cooldown = config
    cb = DomainCircuitBreaker(
        window_size=window_size,
        failure_threshold=failure_threshold,
        cooldown_seconds=cooldown,
    )

    # Start in closed state
    assert cb.get_state(domain) == CircuitState.CLOSED

    # Record exactly failure_threshold consecutive failures
    for _ in range(failure_threshold):
        cb.record_failure(domain)

    # Should now be open
    assert cb.get_state(domain) == CircuitState.OPEN


@settings(max_examples=100)
@given(config=cb_configs, domain=domain_names)
def test_failures_outside_window_do_not_count(
    config: tuple[int, int, int],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 27: Circuit breaker state transition on failures
    # **Validates: Requirements 9.1, 9.2**
    window_size, failure_threshold, cooldown = config
    cb = DomainCircuitBreaker(
        window_size=window_size,
        failure_threshold=failure_threshold,
        cooldown_seconds=cooldown,
    )

    # Record (failure_threshold - 1) failures — not enough to trip
    for _ in range(failure_threshold - 1):
        cb.record_failure(domain)

    # Now push enough successes to slide the oldest failures out of the window
    for _ in range(window_size):
        cb.record_success(domain)

    # The old failures have been pushed out of the sliding window.
    # The circuit should still be closed.
    assert cb.get_state(domain) == CircuitState.CLOSED

    # Recording (failure_threshold - 1) failures again should NOT open
    # because the earlier failures are outside the window.
    for _ in range(failure_threshold - 1):
        cb.record_failure(domain)

    assert cb.get_state(domain) == CircuitState.CLOSED


# ---------------------------------------------------------------------------
# Property 28: Open circuit rejects immediately
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(config=cb_configs, domain=domain_names)
def test_open_circuit_rejects_calls(
    config: tuple[int, int, int],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 28: Open circuit rejects immediately
    # **Validates: Requirements 9.3**
    window_size, failure_threshold, cooldown = config
    cb = DomainCircuitBreaker(
        window_size=window_size,
        failure_threshold=failure_threshold,
        cooldown_seconds=cooldown,
    )

    # Force open state by recording enough failures
    for _ in range(failure_threshold):
        cb.record_failure(domain)

    assert cb.get_state(domain) == CircuitState.OPEN

    # can_call() must return False while open (before cooldown elapses)
    assert cb.can_call(domain) is False


# ---------------------------------------------------------------------------
# Property 29: Half-open probe determines next state
# ---------------------------------------------------------------------------


@settings(max_examples=100)
@given(config=cb_configs, domain=domain_names)
def test_half_open_probe_success_transitions_to_closed(
    config: tuple[int, int, int],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 29: Half-open probe determines next state
    # **Validates: Requirements 9.6, 9.7**
    window_size, failure_threshold, cooldown = config
    cb = DomainCircuitBreaker(
        window_size=window_size,
        failure_threshold=failure_threshold,
        cooldown_seconds=cooldown,
    )

    # Trip the breaker
    for _ in range(failure_threshold):
        cb.record_failure(domain)

    assert cb.get_state(domain) == CircuitState.OPEN

    # Simulate cooldown elapsed by patching time.monotonic
    state_obj = cb._states[domain]
    original_change = state_obj.last_state_change

    with patch("src.resilience.circuit_breaker.time.monotonic", return_value=original_change + cooldown + 1):
        # can_call should transition to half-open and return True
        assert cb.can_call(domain) is True

    assert cb.get_state(domain) == CircuitState.HALF_OPEN

    # Probe success → closed
    cb.record_success(domain)
    assert cb.get_state(domain) == CircuitState.CLOSED


@settings(max_examples=100)
@given(config=cb_configs, domain=domain_names)
def test_half_open_probe_failure_transitions_to_open(
    config: tuple[int, int, int],
    domain: str,
) -> None:
    # Feature: scraping-microservices, Property 29: Half-open probe determines next state
    # **Validates: Requirements 9.6, 9.7**
    window_size, failure_threshold, cooldown = config
    cb = DomainCircuitBreaker(
        window_size=window_size,
        failure_threshold=failure_threshold,
        cooldown_seconds=cooldown,
    )

    # Trip the breaker
    for _ in range(failure_threshold):
        cb.record_failure(domain)

    assert cb.get_state(domain) == CircuitState.OPEN

    # Simulate cooldown elapsed
    state_obj = cb._states[domain]
    original_change = state_obj.last_state_change

    with patch("src.resilience.circuit_breaker.time.monotonic", return_value=original_change + cooldown + 1):
        assert cb.can_call(domain) is True

    assert cb.get_state(domain) == CircuitState.HALF_OPEN

    # Probe failure → back to open
    cb.record_failure(domain)
    assert cb.get_state(domain) == CircuitState.OPEN
