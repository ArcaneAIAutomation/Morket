/**
 * Temporal enrichment activities.
 *
 * Defines the `enrichRecord` activity — the core enrichment step that:
 * 1. Checks idempotency (returns existing record if already processed)
 * 2. Checks circuit breaker state for the provider
 * 3. Debits credits via Credit Service (SELECT FOR UPDATE transaction)
 * 4. Decrypts credentials via Credential module
 * 5. Calls the provider adapter with 30s timeout
 * 6. Validates response against provider output schema
 * 7. On success: records circuit breaker success, inserts enrichment_record
 * 8. On failure: records circuit breaker failure, refunds credits, inserts enrichment_record
 * 9. On missing credentials: fails immediately without retry
 *
 * Activity retry policy (configured in workflow): max 3 attempts, 1s initial
 * interval, backoff coefficient 2.0.
 *
 * @dependency @temporalio/activity — installed via task 12
 */

import { ApplicationFailure } from '@temporalio/activity';

import { InsufficientCreditsError } from '../../../shared/errors';
import { decrypt, deriveWorkspaceKey } from '../../../shared/encryption';
import { logger } from '../../../shared/logger';
import * as creditService from '../../credit/credit.service';
import * as credentialRepo from '../../credential/credential.repository';
import * as recordRepo from '../record.repository';
import { createProviderRegistry } from '../provider-registry';
import { CircuitBreaker } from '../circuit-breaker';

// === Input / Output interfaces ===

export interface EnrichRecordInput {
  jobId: string;
  workspaceId: string;
  recordIndex: number;
  inputData: Record<string, unknown>;
  fieldName: string;
  providerSlug: string;
  idempotencyKey: string;
}

export interface EnrichRecordOutput {
  success: boolean;
  data: Record<string, unknown> | null;
  isComplete: boolean;
  providerSlug: string;
  creditsConsumed: number;
  error?: string;
}

// === Module-level singletons ===

const registry = createProviderRegistry();
const circuitBreaker = new CircuitBreaker();

/**
 * Resolve the encryption master key from the environment.
 * Throws if ENCRYPTION_MASTER_KEY is not set.
 */
function getMasterKey(): Buffer {
  const hex = process.env.ENCRYPTION_MASTER_KEY;
  if (!hex) {
    throw new Error('ENCRYPTION_MASTER_KEY environment variable is not set');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Core enrichment activity — called by the Temporal workflow for each
 * record + field + provider combination.
 *
 * Steps:
 * 1. Idempotency check — return existing record if already processed
 * 2. Provider lookup — throw if provider slug is unknown
 * 3. Circuit breaker check — return failure if circuit is open
 * 4. Credit debit — debit before calling provider; return failure on insufficient credits
 * 5. Credential lookup + decryption — throw non-retryable error if missing
 * 6. Provider call — invoke adapter with 30s timeout
 * 7. Response validation — validate against provider output schema
 * 8. Success path: record CB success, insert enrichment_record (success)
 * 9. Failure path: record CB failure, refund credits, insert enrichment_record (failed)
 */
export async function enrichRecord(input: EnrichRecordInput): Promise<EnrichRecordOutput> {
  const {
    jobId,
    workspaceId,
    inputData,
    fieldName,
    providerSlug,
    idempotencyKey,
  } = input;

  // 1. Idempotency check
  const existing = await recordRepo.getRecordByIdempotencyKey(idempotencyKey);
  if (existing) {
    logger.info('Idempotent replay detected, returning existing record', {
      idempotencyKey,
      recordId: existing.id,
    });
    return {
      success: existing.status === 'success',
      data: existing.outputData,
      isComplete: existing.status === 'success' && existing.outputData !== null,
      providerSlug: existing.providerSlug,
      creditsConsumed: existing.creditsConsumed,
      error: existing.errorReason ?? undefined,
    };
  }

  // 2. Provider lookup
  const provider = registry.getProvider(providerSlug);
  if (!provider) {
    throw ApplicationFailure.nonRetryable(
      `Unknown provider slug: ${providerSlug}`,
    );
  }

  // 3. Circuit breaker check
  if (!circuitBreaker.canCall(providerSlug)) {
    logger.warn('Circuit breaker open for provider', { providerSlug });

    await recordRepo.createRecord({
      jobId,
      workspaceId,
      inputData,
      outputData: null,
      providerSlug,
      creditsConsumed: 0,
      status: 'failed',
      errorReason: 'Circuit breaker open',
      idempotencyKey,
    });

    return {
      success: false,
      data: null,
      isComplete: false,
      providerSlug,
      creditsConsumed: 0,
      error: 'Circuit breaker open',
    };
  }

  // 4. Debit credits
  let creditTransactionId: string | null = null;
  try {
    const txn = await creditService.debit(
      workspaceId,
      provider.creditCostPerCall,
      `Enrichment: ${providerSlug} for field ${fieldName}`,
    );
    creditTransactionId = txn.id;
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      logger.warn('Insufficient credits for enrichment', {
        workspaceId,
        providerSlug,
        cost: provider.creditCostPerCall,
      });

      await recordRepo.createRecord({
        jobId,
        workspaceId,
        inputData,
        outputData: null,
        providerSlug,
        creditsConsumed: 0,
        status: 'failed',
        errorReason: 'Insufficient credits',
        idempotencyKey,
      });

      return {
        success: false,
        data: null,
        isComplete: false,
        providerSlug,
        creditsConsumed: 0,
        error: 'Insufficient credits',
      };
    }
    throw err;
  }

  // 5. Credential lookup + decryption
  const credentials = await credentialRepo.findAllByWorkspace(workspaceId);
  const credential = credentials.find(
    (c) => c.providerName === provider.requiredCredentialType,
  );

  if (!credential) {
    // Refund the debited credits since we can't proceed
    await creditService.addCredits(
      workspaceId,
      provider.creditCostPerCall,
      `Refund: missing credentials for ${providerSlug}`,
    );

    // Non-retryable — credentials won't appear between retries
    throw ApplicationFailure.nonRetryable(
      `Missing credentials for provider "${providerSlug}" (requires ${provider.requiredCredentialType})`,
    );
  }

  const masterKey = getMasterKey();
  const workspaceKey = deriveWorkspaceKey(masterKey, workspaceId);
  const decryptedKey = decrypt(
    credential.encryptedKey,
    credential.iv,
    credential.authTag,
    workspaceKey,
  );
  const decryptedSecret = decrypt(
    credential.encryptedSecret,
    credential.iv,
    credential.authTag,
    workspaceKey,
  );

  // 6. Call provider adapter (30s timeout enforced by adapter)
  let adapterResult;
  try {
    adapterResult = await provider.adapter.enrich(
      { key: decryptedKey, secret: decryptedSecret },
      inputData,
    );
  } catch (err) {
    // Provider call threw — treat as failure
    const errorMessage = err instanceof Error ? err.message : 'Provider call failed';

    circuitBreaker.recordFailure(providerSlug);

    // Refund credits
    await creditService.addCredits(
      workspaceId,
      provider.creditCostPerCall,
      `Refund: provider error for ${providerSlug}`,
    );

    const record = await recordRepo.createRecord({
      jobId,
      workspaceId,
      inputData,
      outputData: null,
      providerSlug,
      creditsConsumed: 0,
      status: 'failed',
      errorReason: errorMessage,
      idempotencyKey,
      creditTransactionId,
    });

    logger.error('Provider adapter threw an error', {
      providerSlug,
      error: errorMessage,
      recordId: record.id,
    });

    return {
      success: false,
      data: null,
      isComplete: false,
      providerSlug,
      creditsConsumed: 0,
      error: errorMessage,
    };
  }

  // 7. Validate response against provider output schema
  if (adapterResult.success && adapterResult.data) {
    const validation = provider.outputSchema.safeParse(adapterResult.data);
    if (!validation.success) {
      // Schema validation failed — treat as provider error
      const errorMessage = `Output schema validation failed: ${validation.error.message}`;

      circuitBreaker.recordFailure(providerSlug);

      await creditService.addCredits(
        workspaceId,
        provider.creditCostPerCall,
        `Refund: schema validation failed for ${providerSlug}`,
      );

      const record = await recordRepo.createRecord({
        jobId,
        workspaceId,
        inputData,
        outputData: null,
        providerSlug,
        creditsConsumed: 0,
        status: 'failed',
        errorReason: errorMessage,
        idempotencyKey,
        creditTransactionId,
      });

      logger.warn('Provider response failed output schema validation', {
        providerSlug,
        recordId: record.id,
      });

      return {
        success: false,
        data: null,
        isComplete: false,
        providerSlug,
        creditsConsumed: 0,
        error: errorMessage,
      };
    }
  }

  // 8. Success path
  if (adapterResult.success) {
    circuitBreaker.recordSuccess(providerSlug);

    const record = await recordRepo.createRecord({
      jobId,
      workspaceId,
      inputData,
      outputData: adapterResult.data,
      providerSlug,
      creditsConsumed: provider.creditCostPerCall,
      status: 'success',
      idempotencyKey,
      creditTransactionId,
    });

    logger.info('Enrichment activity succeeded', {
      providerSlug,
      recordId: record.id,
      creditsConsumed: provider.creditCostPerCall,
    });

    return {
      success: true,
      data: adapterResult.data,
      isComplete: adapterResult.isComplete,
      providerSlug,
      creditsConsumed: provider.creditCostPerCall,
    };
  }

  // 9. Failure path (adapter returned success: false)
  circuitBreaker.recordFailure(providerSlug);

  await creditService.addCredits(
    workspaceId,
    provider.creditCostPerCall,
    `Refund: enrichment failed for ${providerSlug}`,
  );

  const record = await recordRepo.createRecord({
    jobId,
    workspaceId,
    inputData,
    outputData: null,
    providerSlug,
    creditsConsumed: 0,
    status: 'failed',
    errorReason: adapterResult.error ?? 'Provider returned unsuccessful result',
    idempotencyKey,
    creditTransactionId,
  });

  logger.warn('Enrichment activity failed', {
    providerSlug,
    recordId: record.id,
    error: adapterResult.error,
  });

  return {
    success: false,
    data: null,
    isComplete: false,
    providerSlug,
    creditsConsumed: 0,
    error: adapterResult.error ?? 'Provider returned unsuccessful result',
  };
}

// === Additional activities used by the enrichment workflow ===
// These are needed because workflows cannot import regular Node.js modules
// directly — all side effects must go through activities.

import * as jobRepo from '../job.repository';
import * as webhookService from '../webhook.service';

/**
 * Activity to update an enrichment job's status and counters.
 * Called by the workflow at start (→ running) and at completion (→ final status).
 */
export async function updateJobStatusActivity(input: {
  jobId: string;
  status: string;
  completedRecords?: number;
  failedRecords?: number;
}): Promise<void> {
  const updates: {
    status: string;
    completedRecords?: number;
    failedRecords?: number;
    completedAt?: Date | null;
  } = {
    status: input.status,
  };

  if (input.completedRecords !== undefined) {
    updates.completedRecords = input.completedRecords;
  }
  if (input.failedRecords !== undefined) {
    updates.failedRecords = input.failedRecords;
  }

  // Set completedAt for terminal statuses
  const terminalStatuses = ['completed', 'failed', 'partially_completed', 'cancelled'];
  if (terminalStatuses.includes(input.status)) {
    updates.completedAt = new Date();
  }

  await jobRepo.updateJobStatus(input.jobId, updates);

  logger.info('Job status updated via activity', {
    jobId: input.jobId,
    status: input.status,
    completedRecords: input.completedRecords,
    failedRecords: input.failedRecords,
  });
}

/**
 * Activity to deliver webhook notifications for enrichment job events.
 * Delegates to the webhook service which handles HMAC signing, retries,
 * and timeout enforcement.
 */
export async function deliverWebhookActivity(input: {
  workspaceId: string;
  payload: {
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
  };
}): Promise<void> {
  await webhookService.deliverEvent(input.workspaceId, input.payload);

  logger.info('Webhook delivery activity completed', {
    workspaceId: input.workspaceId,
    event: input.payload.event,
    jobId: input.payload.jobId,
  });
}
