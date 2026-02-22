"""Per-domain circuit breaker for scraping resilience.

Tracks failures per target domain using a sliding window and transitions
through closed → open → half-open states to isolate failing domains.

State machine:
- Closed → Open: failure count in sliding window exceeds threshold
- Open → Half-Open: cooldown period elapses
- Half-Open → Closed: probe request succeeds
- Half-Open → Open: probe request fails
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum


class CircuitState(str, Enum):
    """Circuit breaker states."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class CircuitBreakerState:
    """Internal state tracked per domain."""

    domain: str
    state: CircuitState = CircuitState.CLOSED
    recent_calls: deque[tuple[float, bool]] = field(default_factory=deque)
    last_state_change: float = field(default_factory=time.monotonic)


class DomainCircuitBreaker:
    """Per-domain sliding window circuit breaker.

    Args:
        window_size: Maximum number of recent calls to track per domain.
        failure_threshold: Number of failures in the window that triggers open state.
        cooldown_seconds: Seconds to wait in open state before transitioning to half-open.
    """

    def __init__(
        self,
        window_size: int = 10,
        failure_threshold: int = 5,
        cooldown_seconds: int = 120,
    ) -> None:
        self._window_size = window_size
        self._failure_threshold = failure_threshold
        self._cooldown_seconds = cooldown_seconds
        self._states: dict[str, CircuitBreakerState] = {}

    def _get_or_create(self, domain: str) -> CircuitBreakerState:
        """Get existing state for a domain or create a new closed-state entry."""
        if domain not in self._states:
            self._states[domain] = CircuitBreakerState(domain=domain)
        return self._states[domain]

    def can_call(self, domain: str) -> bool:
        """Check whether a request to the given domain is allowed.

        - Unknown/closed domains: always allowed.
        - Open domains: allowed only if cooldown has elapsed (transitions to half-open).
        - Half-open domains: allowed (probe request).
        """
        if domain not in self._states:
            return True

        state = self._states[domain]

        if state.state == CircuitState.CLOSED:
            return True

        if state.state == CircuitState.OPEN:
            elapsed = time.monotonic() - state.last_state_change
            if elapsed >= self._cooldown_seconds:
                state.state = CircuitState.HALF_OPEN
                state.last_state_change = time.monotonic()
                return True
            return False

        # Half-open: allow the probe
        return True

    def record_success(self, domain: str) -> None:
        """Record a successful request to the domain.

        In half-open state, transitions back to closed and resets the window.
        """
        state = self._get_or_create(domain)
        now = time.monotonic()

        if state.state == CircuitState.HALF_OPEN:
            state.state = CircuitState.CLOSED
            state.last_state_change = now
            state.recent_calls.clear()
            return

        self._append_call(state, now, success=True)

    def record_failure(self, domain: str) -> None:
        """Record a failed request to the domain.

        In half-open state, transitions back to open.
        In closed state, checks if failures exceed threshold to transition to open.
        """
        state = self._get_or_create(domain)
        now = time.monotonic()

        if state.state == CircuitState.HALF_OPEN:
            state.state = CircuitState.OPEN
            state.last_state_change = now
            state.recent_calls.clear()
            return

        self._append_call(state, now, success=False)

        if state.state == CircuitState.CLOSED:
            failure_count = sum(1 for _, success in state.recent_calls if not success)
            if failure_count >= self._failure_threshold:
                state.state = CircuitState.OPEN
                state.last_state_change = now

    def get_state(self, domain: str) -> CircuitState:
        """Get the current circuit state for a domain.

        Returns CLOSED for unknown domains.
        """
        if domain not in self._states:
            return CircuitState.CLOSED
        return self._states[domain].state

    def get_all_states(self) -> dict[str, CircuitState]:
        """Get the circuit state for all tracked domains."""
        return {domain: state.state for domain, state in self._states.items()}

    def _append_call(
        self, state: CircuitBreakerState, timestamp: float, *, success: bool
    ) -> None:
        """Append a call result to the sliding window, trimming to window_size."""
        state.recent_calls.append((timestamp, success))
        while len(state.recent_calls) > self._window_size:
            state.recent_calls.popleft()
