import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

// --- Mock setup (must be before service import) ---

vi.mock('./webhook.repository', () => ({
  createSubscription: vi.fn(),
  listSubscriptions: vi.fn(),
  deleteSubscription: vi.fn(),
  getSubscriptionsByEventType: vi.fn(),
}));

vi.mock('../../shared/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import * as webhookRepo from './webhook.repository';
import {
  createSubscription,
  deleteSubscription,
  deliverEvent,
  listSubscriptions,
} from './webhook.service';
import { NotFoundError } from '../../shared/errors';
import type { WebhookSubscription } from './webhook.repository';
import type { WebhookPayload } from './webhook.service';

// --- Shared fixtures ---

const now = new Date('2024-06-01T00:00:00Z');

function makeSubscription(overrides: Partial<WebhookSubscription> = {}): WebhookSubscription {
  return {
    id: 'wh-1',
    workspaceId: 'ws-1',
    callbackUrl: 'https://example.com/hook',
    eventTypes: ['job.completed'],
    secretKey: 'a'.repeat(64),
    isActive: true,
    createdBy: 'user-1',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePayload(overrides: Partial<WebhookPayload> = {}): WebhookPayload {
  return {
    event: 'job.completed',
    jobId: 'job-1',
    workspaceId: 'ws-1',
    status: 'completed',
    summary: {
      totalRecords: 10,
      completedRecords: 10,
      failedRecords: 0,
      creditsConsumed: 20,
    },
    timestamp: '2024-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('webhook.service', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------
  // createSubscription
  // ---------------------------------------------------------------
  describe('createSubscription', () => {
    it('generates a 64-char hex secret key and calls repo', async () => {
      const sub = makeSubscription();
      vi.mocked(webhookRepo.createSubscription).mockResolvedValue(sub);

      await createSubscription('ws-1', 'user-1', 'https://example.com/hook', ['job.completed']);

      expect(webhookRepo.createSubscription).toHaveBeenCalledTimes(1);
      const callArg = vi.mocked(webhookRepo.createSubscription).mock.calls[0][0];
      expect(callArg.workspaceId).toBe('ws-1');
      expect(callArg.createdBy).toBe('user-1');
      expect(callArg.callbackUrl).toBe('https://example.com/hook');
      expect(callArg.eventTypes).toEqual(['job.completed']);
      // Secret key: 32 random bytes → 64 hex chars
      expect(callArg.secretKey).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ---------------------------------------------------------------
  // deleteSubscription
  // ---------------------------------------------------------------
  describe('deleteSubscription', () => {
    it('throws NotFoundError when repo returns false', async () => {
      vi.mocked(webhookRepo.deleteSubscription).mockResolvedValue(false);

      await expect(deleteSubscription('ws-1', 'wh-missing')).rejects.toThrow(NotFoundError);
    });

    it('succeeds when repo returns true', async () => {
      vi.mocked(webhookRepo.deleteSubscription).mockResolvedValue(true);

      await expect(deleteSubscription('ws-1', 'wh-1')).resolves.toBeUndefined();
      expect(webhookRepo.deleteSubscription).toHaveBeenCalledWith('wh-1', 'ws-1');
    });
  });

  // ---------------------------------------------------------------
  // deliverEvent
  // ---------------------------------------------------------------
  describe('deliverEvent', () => {
    it('computes correct HMAC-SHA256 signature and sends POST with X-Webhook-Signature header', async () => {
      const sub = makeSubscription();
      const payload = makePayload();
      vi.mocked(webhookRepo.getSubscriptionsByEventType).mockResolvedValue([sub]);

      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      globalThis.fetch = fetchMock;

      await deliverEvent('ws-1', payload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('https://example.com/hook');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');

      // Verify HMAC signature
      const body = JSON.stringify(payload);
      const expectedSignature = crypto
        .createHmac('sha256', sub.secretKey)
        .update(body)
        .digest('hex');
      expect(opts.headers['X-Webhook-Signature']).toBe(`sha256=${expectedSignature}`);
      expect(opts.body).toBe(body);
    });

    it('retries up to 3 times on failure with correct delays', async () => {
      vi.useFakeTimers();

      const sub = makeSubscription();
      const payload = makePayload();
      vi.mocked(webhookRepo.getSubscriptionsByEventType).mockResolvedValue([sub]);

      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockRejectedValueOnce(new Error('fail 3'))
        .mockResolvedValue({ ok: true });
      globalThis.fetch = fetchMock;

      const deliveryPromise = deliverEvent('ws-1', payload);

      // Initial attempt fails → sleep(5000)
      await vi.advanceTimersByTimeAsync(5_000);
      // Retry 1 fails → sleep(10000)
      await vi.advanceTimersByTimeAsync(10_000);
      // Retry 2 fails → sleep(20000)
      await vi.advanceTimersByTimeAsync(20_000);

      await deliveryPromise;

      // 1 initial + 3 retries = 4 total calls
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('does not throw on delivery failure (best-effort)', async () => {
      vi.useFakeTimers();

      const sub = makeSubscription();
      const payload = makePayload();
      vi.mocked(webhookRepo.getSubscriptionsByEventType).mockResolvedValue([sub]);

      // All attempts fail
      const fetchMock = vi.fn().mockRejectedValue(new Error('network error'));
      globalThis.fetch = fetchMock;

      const deliveryPromise = deliverEvent('ws-1', payload);

      // Advance through all retry delays
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.advanceTimersByTimeAsync(20_000);

      // Should resolve without throwing
      await expect(deliveryPromise).resolves.toBeUndefined();
    });

    it('skips delivery when no matching subscriptions', async () => {
      vi.mocked(webhookRepo.getSubscriptionsByEventType).mockResolvedValue([]);

      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      await deliverEvent('ws-1', makePayload());

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
