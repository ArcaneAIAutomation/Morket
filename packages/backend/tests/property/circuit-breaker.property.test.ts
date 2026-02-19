import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CircuitBreaker } from '../../src/modules/enrichment/circuit-breaker';
import type { CircuitBreakerConfig } from '../../src/modules/enrichment/circuit-breaker';

const NUM_RUNS = 100;

// ── Generators ──

/** Arbitrary boolean representing success (true) or failure (false). */
const callResultArb = fc.boolean();

/** Arbitrary non-empty sequence of call results. */
const callSequenceArb = fc.array(callResultArb, { minLength: 1, maxLength: 50 });

/** Small config for fast, deterministic tests. */
const testConfig: CircuitBreakerConfig = {
  windowSize: 5,
  failureThreshold: 3,
  cooldownMs: 1000,
};

const PROVIDER = 'test-provider';

describe('Circuit Breaker — Property Tests', () => {
  /**
   * **Property 1: State transitions are deterministic**
   *
   * Given the same sequence of success/failure calls, two independent
   * CircuitBreaker instances with identical config and time function
   * always reach the same state.
   *
   * **Validates: Requirements 7.1, 7.2, 7.6, 7.7**
   */
  describe('Property 1: State transitions are deterministic', () => {
    it('two breakers with the same call sequence reach the same state', () => {
      fc.assert(
        fc.property(callSequenceArb, (calls) => {
          let tick = 0;
          const now = () => tick;

          const cb1 = new CircuitBreaker(testConfig, now);
          const cb2 = new CircuitBreaker(testConfig, now);

          for (const success of calls) {
            // Both breakers see the same canCall result before recording
            const can1 = cb1.canCall(PROVIDER);
            const can2 = cb2.canCall(PROVIDER);
            expect(can1).toBe(can2);

            if (can1) {
              if (success) {
                cb1.recordSuccess(PROVIDER);
                cb2.recordSuccess(PROVIDER);
              } else {
                cb1.recordFailure(PROVIDER);
                cb2.recordFailure(PROVIDER);
              }
            }

            tick += 10; // advance time uniformly
          }

          const state1 = cb1.getState(PROVIDER);
          const state2 = cb2.getState(PROVIDER);

          expect(state1.state).toBe(state2.state);
          expect(state1.failureCount).toBe(state2.failureCount);
          expect(state1.lastFailureTime).toBe(state2.lastFailureTime);
          expect(state1.recentCalls).toEqual(state2.recentCalls);
        }),
        { numRuns: NUM_RUNS },
      );
    });
  });

  /**
   * **Property 2: Open state blocks all calls**
   *
   * After exceeding the failure threshold, `canCall` always returns false
   * until the cooldown period expires, at which point it returns true
   * (half-open probe).
   *
   * **Validates: Requirements 7.2, 7.3**
   */
  describe('Property 2: Open state blocks all calls', () => {
    it('canCall returns false while open, true after cooldown', () => {
      fc.assert(
        fc.property(
          // Extra failures beyond threshold to ensure we're solidly open
          fc.integer({ min: 0, max: 10 }),
          // Fraction of cooldown elapsed (0..0.99) — should still be blocked
          fc.double({ min: 0, max: 0.99, noNaN: true }),
          (extraFailures, cooldownFraction) => {
            let tick = 0;
            const now = () => tick;
            const cb = new CircuitBreaker(testConfig, now);

            // Push enough failures to trip the breaker open
            const totalFailures = testConfig.failureThreshold + extraFailures;
            for (let i = 0; i < totalFailures; i++) {
              if (cb.canCall(PROVIDER)) {
                cb.recordFailure(PROVIDER);
              }
              tick += 1;
            }

            const stateAfterFailures = cb.getState(PROVIDER);
            expect(stateAfterFailures.state).toBe('open');

            // Record the last failure time so we can compute offsets from it
            const lastFailure = stateAfterFailures.lastFailureTime!;

            // While within cooldown, canCall must return false
            tick = lastFailure + Math.floor(cooldownFraction * testConfig.cooldownMs);
            expect(cb.canCall(PROVIDER)).toBe(false);

            // After cooldown expires, canCall must return true (half-open)
            tick = lastFailure + testConfig.cooldownMs;
            expect(cb.canCall(PROVIDER)).toBe(true);
            expect(cb.getState(PROVIDER).state).toBe('half-open');
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });

  /**
   * **Property 3: Sliding window bounds**
   *
   * The recentCalls array never exceeds windowSize entries, regardless
   * of how many calls are recorded.
   *
   * **Validates: Requirement 7.1**
   */
  describe('Property 3: Sliding window bounds', () => {
    it('recentCalls.length never exceeds windowSize', () => {
      fc.assert(
        fc.property(
          // Use a variable window size to strengthen the property
          fc.integer({ min: 1, max: 20 }),
          fc.array(callResultArb, { minLength: 1, maxLength: 100 }),
          (windowSize, calls) => {
            let tick = 0;
            const now = () => tick;
            const config: CircuitBreakerConfig = {
              windowSize,
              failureThreshold: Math.max(1, Math.ceil(windowSize / 2)),
              cooldownMs: 100,
            };
            const cb = new CircuitBreaker(config, now);

            for (const success of calls) {
              // If breaker is open, advance past cooldown so we can keep recording
              if (!cb.canCall(PROVIDER)) {
                tick += config.cooldownMs + 1;
                cb.canCall(PROVIDER); // triggers half-open transition
              }

              if (success) {
                cb.recordSuccess(PROVIDER);
              } else {
                cb.recordFailure(PROVIDER);
              }

              tick += 1;

              // Invariant: window never exceeds configured size
              const state = cb.getState(PROVIDER);
              expect(state.recentCalls.length).toBeLessThanOrEqual(windowSize);
            }
          },
        ),
        { numRuns: NUM_RUNS },
      );
    });
  });
});
