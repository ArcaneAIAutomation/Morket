/**
 * Per-provider circuit breaker for external API resilience.
 *
 * Tracks failures in a sliding window per provider and temporarily
 * disables calls to providers that exceed the failure threshold.
 *
 * State machine:
 *   Closed → Open:     failures exceed threshold within sliding window
 *   Open → Half-Open:  cooldown period expires
 *   Half-Open → Closed: probe call succeeds
 *   Half-Open → Open:   probe call fails
 *
 * @module circuit-breaker
 */

/** Possible states of the circuit breaker for a provider. */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** Injectable configuration for tuning circuit breaker behaviour. */
export interface CircuitBreakerConfig {
  /** Number of most recent calls to track per provider. */
  windowSize: number;
  /** Number of failures within the window that triggers the open state. */
  failureThreshold: number;
  /** Milliseconds to wait in open state before transitioning to half-open. */
  cooldownMs: number;
}

/** Snapshot of a single provider's circuit breaker state. */
export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
  recentCalls: Array<{ timestamp: number; success: boolean }>;
}

/** Public contract for the circuit breaker. */
export interface ICircuitBreaker {
  canCall(providerSlug: string): boolean;
  recordSuccess(providerSlug: string): void;
  recordFailure(providerSlug: string): void;
  getState(providerSlug: string): CircuitBreakerState;
  reset(providerSlug: string): void;
}

/** Default configuration values. */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  windowSize: 10,
  failureThreshold: 5,
  cooldownMs: 60_000,
};

/** Internal mutable state tracked per provider. */
interface InternalProviderState {
  state: CircuitState;
  lastFailureTime: number | null;
  recentCalls: Array<{ timestamp: number; success: boolean }>;
}

/**
 * In-memory circuit breaker that maintains independent state per provider.
 *
 * Accepts an optional config for tuning and an optional `now` function
 * (defaults to `Date.now`) so tests can control time deterministically.
 */
export class CircuitBreaker implements ICircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private readonly now: () => number;
  private readonly providers: Map<string, InternalProviderState> = new Map();

  constructor(config?: Partial<CircuitBreakerConfig>, now?: () => number) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.now = now ?? Date.now;
  }

  // ── helpers ──────────────────────────────────────────────────────────

  /** Return existing state or create a fresh closed state for the provider. */
  private getOrCreate(providerSlug: string): InternalProviderState {
    let s = this.providers.get(providerSlug);
    if (!s) {
      s = { state: 'closed', lastFailureTime: null, recentCalls: [] };
      this.providers.set(providerSlug, s);
    }
    return s;
  }

  /** Count failures in the current sliding window. */
  private failureCount(s: InternalProviderState): number {
    return s.recentCalls.filter((c) => !c.success).length;
  }

  /** Trim the sliding window to the configured size (keep most recent). */
  private trimWindow(s: InternalProviderState): void {
    if (s.recentCalls.length > this.config.windowSize) {
      s.recentCalls = s.recentCalls.slice(
        s.recentCalls.length - this.config.windowSize,
      );
    }
  }

  /** Check whether the cooldown period has elapsed for an open provider. */
  private cooldownExpired(s: InternalProviderState): boolean {
    if (s.lastFailureTime === null) return false;
    return this.now() - s.lastFailureTime >= this.config.cooldownMs;
  }

  // ── public API ───────────────────────────────────────────────────────

  /**
   * Returns `true` when the provider is available for a call.
   *
   * - Closed / half-open → true
   * - Open with expired cooldown → transitions to half-open, returns true
   * - Open with active cooldown → false
   */
  canCall(providerSlug: string): boolean {
    const s = this.getOrCreate(providerSlug);

    if (s.state === 'closed' || s.state === 'half-open') {
      return true;
    }

    // state === 'open'
    if (this.cooldownExpired(s)) {
      s.state = 'half-open';
      return true;
    }

    return false;
  }

  /**
   * Record a successful call to the provider.
   *
   * - Half-open → transitions to closed and resets the window.
   * - Closed → appends success to the sliding window.
   */
  recordSuccess(providerSlug: string): void {
    const s = this.getOrCreate(providerSlug);

    if (s.state === 'half-open') {
      // Probe succeeded — close the circuit and reset.
      s.state = 'closed';
      s.recentCalls = [];
      s.lastFailureTime = null;
      return;
    }

    s.recentCalls.push({ timestamp: this.now(), success: true });
    this.trimWindow(s);
  }

  /**
   * Record a failed call to the provider.
   *
   * - Appends failure to the sliding window.
   * - If half-open → immediately re-opens with a fresh cooldown.
   * - If closed and failures exceed threshold → opens the circuit.
   */
  recordFailure(providerSlug: string): void {
    const s = this.getOrCreate(providerSlug);
    const now = this.now();

    if (s.state === 'half-open') {
      // Probe failed — back to open with a new cooldown.
      s.state = 'open';
      s.lastFailureTime = now;
      s.recentCalls.push({ timestamp: now, success: false });
      this.trimWindow(s);
      return;
    }

    s.recentCalls.push({ timestamp: now, success: false });
    this.trimWindow(s);
    s.lastFailureTime = now;

    if (this.failureCount(s) >= this.config.failureThreshold) {
      s.state = 'open';
    }
  }

  /**
   * Return a snapshot of the provider's current circuit breaker state.
   * If the provider has never been seen, returns a fresh closed state.
   */
  getState(providerSlug: string): CircuitBreakerState {
    const s = this.getOrCreate(providerSlug);
    return {
      state: s.state,
      failureCount: this.failureCount(s),
      lastFailureTime: s.lastFailureTime,
      recentCalls: [...s.recentCalls],
    };
  }

  /**
   * Reset a provider back to the initial closed state, clearing all history.
   */
  reset(providerSlug: string): void {
    this.providers.set(providerSlug, {
      state: 'closed',
      lastFailureTime: null,
      recentCalls: [],
    });
  }
}
