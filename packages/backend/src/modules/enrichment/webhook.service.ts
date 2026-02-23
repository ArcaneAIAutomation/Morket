/**
 * Webhook service — manages webhook subscriptions and delivers event
 * notifications with HMAC-SHA256 signatures and retry logic.
 *
 * Delivery is best-effort: failures are logged but never thrown so that
 * webhook issues do not block enrichment workflow completion.
 */

import crypto from 'crypto';
import { NotFoundError, ValidationError } from '../../shared/errors';
import { validateUrlSafety } from '../../shared/sanitize';
import { logger } from '../../shared/logger';
import * as webhookRepo from './webhook.repository';

// === Types ===

export interface WebhookPayload {
  event: string;
  jobId: string;
  workspaceId: string;
  status: string;
  summary: {
    totalRecords: number;
    completedRecords: number;
    failedRecords: number;
    creditsConsumed: number;
  };
  timestamp: string;
}

// === Constants ===

const RETRY_DELAYS_MS = [5_000, 10_000, 20_000];
const DELIVERY_TIMEOUT_MS = 10_000;
export const MAX_WEBHOOK_AGE_SECONDS = 300; // 5 minutes

// === Helpers ===

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverToSubscription(
  callbackUrl: string,
  body: string,
  signature: string,
  timestamp: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const response = await fetch(callbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Timestamp': timestamp,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// === Service functions ===

/**
 * Create a webhook subscription for a workspace.
 * Generates a 64-char hex secret key for HMAC signature verification.
 * Validates that the callback URL uses HTTPS and does not resolve to private IPs.
 */
export async function createSubscription(
  workspaceId: string,
  userId: string,
  callbackUrl: string,
  eventTypes: string[],
) {
  // Validate HTTPS-only
  if (!callbackUrl.startsWith('https://')) {
    throw new ValidationError('Webhook callback URL must use HTTPS');
  }

  // Validate URL does not resolve to private/internal IP ranges (SSRF protection)
  const isSafe = await validateUrlSafety(callbackUrl);
  if (!isSafe) {
    throw new ValidationError('Webhook callback URL resolves to a private or reserved IP range');
  }

  const secretKey = crypto.randomBytes(32).toString('hex');

  return webhookRepo.createSubscription({
    workspaceId,
    callbackUrl,
    eventTypes,
    secretKey,
    createdBy: userId,
  });
}

/**
 * List all active webhook subscriptions for a workspace.
 */
export async function listSubscriptions(workspaceId: string) {
  return webhookRepo.listSubscriptions(workspaceId);
}

/**
 * Delete a webhook subscription by ID.
 * Throws NotFoundError if the subscription does not exist.
 */
export async function deleteSubscription(workspaceId: string, webhookId: string): Promise<void> {
  const deleted = await webhookRepo.deleteSubscription(webhookId, workspaceId);
  if (!deleted) {
    throw new NotFoundError(`Webhook subscription ${webhookId} not found`);
  }
}

/**
 * Deliver a webhook event to all matching subscriptions for a workspace.
 *
 * For each matching subscription:
 * 1. Serialize the payload as JSON
 * 2. Compute HMAC-SHA256 using the subscription's secret key
 * 3. POST to the callback URL with signature header
 * 4. Retry up to 3 times with exponential backoff (5s, 10s, 20s)
 *
 * Delivery is best-effort — failures are logged but never thrown.
 */
export async function deliverEvent(workspaceId: string, payload: WebhookPayload): Promise<void> {
  let subscriptions;
  try {
    subscriptions = await webhookRepo.getSubscriptionsByEventType(workspaceId, payload.event);
  } catch (err) {
    logger.error('Failed to query webhook subscriptions', {
      workspaceId,
      event: payload.event,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  const deliveries = subscriptions.map(async (subscription) => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signaturePayload = `${timestamp}.${body}`;
    const signature = crypto
      .createHmac('sha256', subscription.secretKey)
      .update(signaturePayload)
      .digest('hex');

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        await deliverToSubscription(subscription.callbackUrl, body, signature, timestamp);
        return; // success — stop retrying
      } catch (err) {
        const isLastAttempt = attempt === RETRY_DELAYS_MS.length;
        if (isLastAttempt) {
          logger.error('Webhook delivery failed after all retries', {
            webhookId: subscription.id,
            callbackUrl: subscription.callbackUrl,
            event: payload.event,
            attempt: attempt + 1,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        logger.warn('Webhook delivery attempt failed, retrying', {
          webhookId: subscription.id,
          callbackUrl: subscription.callbackUrl,
          event: payload.event,
          attempt: attempt + 1,
          delayMs: RETRY_DELAYS_MS[attempt],
          error: err instanceof Error ? err.message : String(err),
        });

        await sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  });

  await Promise.all(deliveries);
}


/**
 * Verify a webhook signature with replay prevention.
 *
 * - Rejects if the timestamp is older than MAX_WEBHOOK_AGE_SECONDS (5 minutes)
 * - Computes HMAC over `${timestamp}.${body}` and compares using timing-safe equality
 *
 * @returns `{ valid: true }` on success, `{ valid: false, reason: string }` on failure
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  timestamp: string,
  secretKey: string,
): { valid: boolean; reason?: string } {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);

  if (isNaN(ts)) {
    return { valid: false, reason: 'Invalid timestamp' };
  }

  if (now - ts > MAX_WEBHOOK_AGE_SECONDS) {
    return { valid: false, reason: 'Webhook timestamp too old' };
  }

  const signaturePayload = `${timestamp}.${body}`;
  const expected = crypto
    .createHmac('sha256', secretKey)
    .update(signaturePayload)
    .digest('hex');

  const sigBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (sigBuffer.length !== expectedBuffer.length) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}
