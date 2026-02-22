"""Unit tests for the per-domain circuit breaker."""

import time
from unittest.mock import patch

import pytest

from src.resilience.circuit_breaker import CircuitState, DomainCircuitBreaker


class TestCircuitBreakerDefaults:
    """Test default/initial behavior."""

    def test_unknown_domain_returns_closed(self):
        cb = DomainCircuitBreaker()
        assert cb.get_state("example.com") == CircuitState.CLOSED

    def test_unknown_domain_allows_call(self):
        cb = DomainCircuitBreaker()
        assert cb.can_call("example.com") is True

    def test_get_all_states_empty_initially(self):
        cb = DomainCircuitBreaker()
        assert cb.get_all_states() == {}

    def test_get_all_states_tracks_domains(self):
        cb = DomainCircuitBreaker()
        cb.record_success("a.com")
        cb.record_failure("b.com")
        states = cb.get_all_states()
        assert "a.com" in states
        assert "b.com" in states


class TestClosedState:
    """Test behavior in the closed state."""

    def test_stays_closed_on_successes(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5)
        for _ in range(20):
            cb.record_success("example.com")
        assert cb.get_state("example.com") == CircuitState.CLOSED

    def test_stays_closed_below_threshold(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5)
        for _ in range(4):
            cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.CLOSED
        assert cb.can_call("example.com") is True

    def test_transitions_to_open_at_threshold(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5)
        for _ in range(5):
            cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.OPEN

    def test_sliding_window_evicts_old_entries(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5)
        # Record 4 failures then 6 successes — fills window, pushes failures out
        for _ in range(4):
            cb.record_failure("example.com")
        for _ in range(6):
            cb.record_success("example.com")
        assert cb.get_state("example.com") == CircuitState.CLOSED

        # Now 4 more failures — only 4 in window (old 4 were evicted)
        for _ in range(4):
            cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.CLOSED

    def test_mixed_calls_trigger_open_when_threshold_met(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5)
        # 5 successes + 5 failures = 5 failures in window → open
        for _ in range(5):
            cb.record_success("example.com")
        for _ in range(5):
            cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.OPEN


class TestOpenState:
    """Test behavior in the open state."""

    def test_open_rejects_calls(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5, cooldown_seconds=120)
        for _ in range(5):
            cb.record_failure("example.com")
        assert cb.can_call("example.com") is False

    def test_open_transitions_to_half_open_after_cooldown(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5, cooldown_seconds=10)
        for _ in range(5):
            cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.OPEN

        # Simulate time passing beyond cooldown
        cb._states["example.com"].last_state_change = time.monotonic() - 11
        assert cb.can_call("example.com") is True
        assert cb.get_state("example.com") == CircuitState.HALF_OPEN

    def test_open_stays_open_before_cooldown(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5, cooldown_seconds=120)
        for _ in range(5):
            cb.record_failure("example.com")
        # Cooldown hasn't elapsed
        assert cb.can_call("example.com") is False
        assert cb.get_state("example.com") == CircuitState.OPEN


class TestHalfOpenState:
    """Test behavior in the half-open state."""

    def _make_half_open(self, cb: DomainCircuitBreaker, domain: str) -> None:
        """Helper to get a domain into half-open state."""
        for _ in range(cb._failure_threshold):
            cb.record_failure(domain)
        # Simulate cooldown elapsed
        cb._states[domain].last_state_change = time.monotonic() - cb._cooldown_seconds - 1
        cb.can_call(domain)  # triggers transition to half-open

    def test_half_open_allows_probe(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5, cooldown_seconds=10)
        self._make_half_open(cb, "example.com")
        assert cb.get_state("example.com") == CircuitState.HALF_OPEN
        assert cb.can_call("example.com") is True

    def test_probe_success_closes_circuit(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5, cooldown_seconds=10)
        self._make_half_open(cb, "example.com")
        cb.record_success("example.com")
        assert cb.get_state("example.com") == CircuitState.CLOSED

    def test_probe_failure_reopens_circuit(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5, cooldown_seconds=10)
        self._make_half_open(cb, "example.com")
        cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.OPEN

    def test_probe_success_resets_window(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5, cooldown_seconds=10)
        self._make_half_open(cb, "example.com")
        cb.record_success("example.com")
        # Window should be cleared — need threshold failures again to open
        for _ in range(4):
            cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.CLOSED


class TestDomainIsolation:
    """Test that domains are tracked independently."""

    def test_different_domains_independent(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5)
        for _ in range(5):
            cb.record_failure("bad.com")
        assert cb.get_state("bad.com") == CircuitState.OPEN
        assert cb.get_state("good.com") == CircuitState.CLOSED
        assert cb.can_call("good.com") is True

    def test_multiple_domains_tracked(self):
        cb = DomainCircuitBreaker(window_size=10, failure_threshold=5)
        cb.record_success("a.com")
        cb.record_failure("b.com")
        states = cb.get_all_states()
        assert states["a.com"] == CircuitState.CLOSED
        assert states["b.com"] == CircuitState.CLOSED


class TestCustomConfiguration:
    """Test with non-default configuration values."""

    def test_custom_threshold(self):
        cb = DomainCircuitBreaker(window_size=5, failure_threshold=2)
        cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.CLOSED
        cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.OPEN

    def test_window_size_one(self):
        cb = DomainCircuitBreaker(window_size=1, failure_threshold=1)
        cb.record_failure("example.com")
        assert cb.get_state("example.com") == CircuitState.OPEN
