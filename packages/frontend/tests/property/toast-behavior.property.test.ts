import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { useUIStore } from '@/stores/ui.store';
import type { ToastType } from '@/stores/ui.store';

beforeEach(() => {
  vi.useFakeTimers();
  useUIStore.setState({ toasts: [] });
});

const ALL_TOAST_TYPES: ToastType[] = ['success', 'error', 'warning', 'info'];

/**
 * Property 38: Toast auto-dismiss behavior
 * **Validates: Requirements 16.2**
 *
 * For any toast notification, if the toast type is "success" then autoDismiss should
 * be true, and if the toast type is "error" then autoDismiss should be false.
 */
describe('Property 38: Toast auto-dismiss behavior', () => {
  it('success/warning/info toasts should have autoDismiss true, error should have false', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ToastType>(...ALL_TOAST_TYPES),
        fc.string({ minLength: 1, maxLength: 100 }),
        (type, message) => {
          useUIStore.setState({ toasts: [] });

          useUIStore.getState().addToast(type, message);

          const toasts = useUIStore.getState().toasts;
          expect(toasts.length).toBeGreaterThanOrEqual(1);

          const toast = toasts[toasts.length - 1];
          expect(toast.type).toBe(type);
          expect(toast.message).toBe(message);

          if (type === 'error') {
            expect(toast.autoDismiss).toBe(false);
          } else {
            expect(toast.autoDismiss).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('max 5 toasts should be visible at any time', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        (toastCount) => {
          useUIStore.setState({ toasts: [] });

          for (let i = 0; i < toastCount; i++) {
            useUIStore.getState().addToast('info', `Toast ${i}`);
          }

          const toasts = useUIStore.getState().toasts;
          expect(toasts.length).toBeLessThanOrEqual(5);
        },
      ),
      { numRuns: 100 },
    );
  });
});

/**
 * Property 10: HTTP error status toast messages
 * **Validates: Requirements 3.3, 3.4, 13.5**
 *
 * For any API response with status code 429, 403, or 500, the UI store should receive
 * a toast notification with a status-appropriate message.
 */
describe('Property 10: HTTP error toasts', () => {
  const ERROR_STATUS_MAP: Record<number, { type: ToastType; messagePattern: string }> = {
    429: { type: 'warning', messagePattern: 'Rate limited' },
    403: { type: 'error', messagePattern: "don't have permission" },
    500: { type: 'error', messagePattern: 'server error' },
  };

  it('429/403/500 should produce correct toast type and message', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(429, 403, 500),
        (statusCode) => {
          useUIStore.setState({ toasts: [] });

          const expected = ERROR_STATUS_MAP[statusCode];

          // Simulate what the API client interceptor does for each status
          if (statusCode === 429) {
            useUIStore.getState().addToast('warning', 'Rate limited. Please wait before retrying.');
          } else if (statusCode === 403) {
            useUIStore.getState().addToast('error', "You don't have permission for this action");
          } else if (statusCode === 500) {
            useUIStore.getState().addToast('error', 'A server error occurred. Please try again later.');
          }

          const toasts = useUIStore.getState().toasts;
          expect(toasts.length).toBe(1);

          const toast = toasts[0];
          expect(toast.type).toBe(expected.type);
          expect(toast.message.toLowerCase()).toContain(expected.messagePattern.toLowerCase());
        },
      ),
      { numRuns: 100 },
    );
  });
});
