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

vi.mock('../../shared/sanitize', () => ({
  validateUrlSafety: vi.fn(),
}));

import * as webhookRepo from './webhook.repository';
import { validateUrlSafety } from '../../shared/sanitize';
import {
  createSubscription,
  deleteSubscription,
  deliverEvent,
  listSubscriptions,
  verifyWebhookSignature,
  MAX_WEBHOOK_AGE_SECONDS,
} from './webhook.service';
import { NotFoundError, ValidationError } from '../../shared/errors';
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
      vi.mocked(validateUrlSafety).mockResolvedValue(true);

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

    it('rejects non-HTTPS callback URLs', async () => {
      await expect(
        createSubscription('ws-1', 'user-1', 'http://example.com/hook', ['job.completed']),
      ).rejects.toThrow(ValidationError);
    });

    it('rejects callback URLs that resolve to private IPs', async () => {
      vi.mocked(validateUrlSafety).mockResolvedValue(false);

      await expect(
        createSubscription('ws-1', 'user-1', 'https://internal.local/hook', ['job.completed']),
      ).rejects.toThrow(ValidationError);
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
    it('computes correct HMAC-SHA256 signature with timestamp and sends POST with signature and timestamp headers', async () => {
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

      // Verify timestamp header is present and numeric
      const timestamp = opts.headers['X-Webhook-Timestamp'];
      expect(timestamp).toBeDefined();
      expect(Number(timestamp)).toBeGreaterThan(0);

      // Verify HMAC signature includes timestamp
      const body = JSON.stringify(payload);
      const signaturePayload = `${timestamp}.${body}`;
      const expectedSignature = crypto
        .createHmac('sha256', sub.secretKey)
        .update(signaturePayload)
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

  // ---------------------------------------------------------------
  // verifyWebhookSignature
  // ---------------------------------------------------------------
  describe('verifyWebhookSignature', () => {
    const secretKey = 'a'.repeat(64);

    it('returns valid for a correctly signed recent webhook', () => {
      const body = JSON.stringify({ event: 'test' });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(`${timestamp}.${body}`)
        .digest('hex');

      const result = verifyWebhookSignature(body, signature, timestamp, secretKey);
      expect(result).toEqual({ valid: true });
    });

    it('rejects webhooks older than 5 minutes', () => {
      const body = JSON.stringify({ event: 'test' });
      const oldTimestamp = (Math.floor(Date.now() / 1000) - MAX_WEBHOOK_AGE_SECONDS - 1).toString();
      const signature = crypto
        .createHmac('sha256', secretKey)
        .update(`${oldTimestamp}.${body}`)
        .digest('hex');

      const result = verifyWebhookSignature(body, signature, oldTimestamp, secretKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Webhook timestamp too old');
    });

    it('rejects invalid signatures', () => {
      const body = JSON.stringify({ event: 'test' });
      const timestamp = Math.floor(Date.now() / 1000).toString();

      const result = verifyWebhookSignature(body, 'invalidsignature'.repeat(4), timestamp, secretKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Signature mismatch');
    });

    it('rejects non-numeric timestamps', () => {
      const body = JSON.stringify({ event: 'test' });
      const result = verifyWebhookSignature(body, 'sig', 'not-a-number', secretKey);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Invalid timestamp');
    });
  });
});
