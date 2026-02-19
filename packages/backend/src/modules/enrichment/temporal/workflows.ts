/**
 * Temporal enrichment workflow definition.
 *
 * Runs inside the Temporal workflow sandbox — CANNOT import regular Node.js
 * modules. All side effects (DB writes, HTTP calls, credential decryption)
 * are performed via proxied activities.
 *
 * Workflow responsibilities:
 * 1. Update job status to "running"
 * 2. Process batches sequentially, records sequentially within each batch
 * 3. For each record + field: resolve provider list, iterate (waterfall)
 * 4. Waterfall: try providers in order, stop on first complete success
 * 5. Idempotency key format: {jobId}:{recordIndex}:{fieldName}:{providerSlug}
 * 6. Handle cancellation signal gracefully
 * 7. Compute final status from counters
 * 8. Update job with final status and counters
 * 9. Trigger webhook delivery for terminal state
 *
 * @dependency @temporalio/workflow — installed via task 12
 */

import { proxyActivities, isCancellation } from '@temporalio/workflow';
import type { EnrichRecordInput, EnrichRecordOutput } from './activities';

// === Activity interfaces for job status updates and webhook delivery ===

export interface UpdateJobStatusInput {
  jobId: string;
  status: string;
  completedRecords?: number;
  failedRecords?: number;
}

export interface DeliverWebhookInput {
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
}

// === Proxy activities with retry policies ===

const { enrichRecord } = proxyActivities<{
  enrichRecord: (input: EnrichRecordInput) => Promise<EnrichRecordOutput>;
}>({
  startToCloseTimeout: '30s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2.0,
  },
});

const { updateJobStatusActivity } = proxyActivities<{
  updateJobStatusActivity: (input: UpdateJobStatusInput) => Promise<void>;
}>({
  startToCloseTimeout: '10s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '1s',
    backoffCoefficient: 2.0,
  },
});

const { deliverWebhookActivity } = proxyActivities<{
  deliverWebhookActivity: (input: DeliverWebhookInput) => Promise<void>;
}>({
  startToCloseTimeout: '60s',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2s',
    backoffCoefficient: 2.0,
  },
});

// === Workflow input interface ===

export interface WorkflowInput {
  jobId: string;
  workspaceId: string;
  batches: Record<string, unknown>[][];
  requestedFields: string[];
  waterfallConfig: Record<string, { providers: string[] }> | null;
  /**
   * Pre-computed mapping of field name → ordered provider slugs.
   * For waterfall fields this is the waterfall provider list.
   * For non-waterfall fields this is all providers supporting the field
   * (resolved by the enrichment service from the provider registry).
   */
  fieldProviders: Record<string, string[]>;
}

// === Main workflow ===

/**
 * Durable enrichment workflow executed by the Temporal worker.
 *
 * Processes batches sequentially, records sequentially within each batch,
 * and fields sequentially within each record. For each field the workflow
 * iterates through the provider list (waterfall or single) and stops on
 * the first complete success.
 *
 * Handles Temporal cancellation signals: when cancelled the workflow stops
 * scheduling new activities, lets any in-progress activity finish, then
 * updates the job to its final status.
 */
export async function enrichmentWorkflow(input: WorkflowInput): Promise<void> {
  const {
    jobId,
    workspaceId,
    batches,
    requestedFields,
    fieldProviders,
  } = input;

  let completedRecords = 0;
  let failedRecords = 0;
  let totalCreditsConsumed = 0;
  let cancelled = false;

  // 1. Update job status to "running"
  await updateJobStatusActivity({ jobId, status: 'running' });

  // Track a global batch-level record index so idempotency keys are unique
  // across batches. The index is the absolute position of the record across
  // all batches (batch 0 records 0-999, batch 1 records 1000-1999, etc.).
  let globalRecordIndex = 0;

  try {
    // 2. Process batches sequentially
    for (const batch of batches) {
      if (cancelled) break;

      // Process records sequentially within each batch
      for (let localIndex = 0; localIndex < batch.length; localIndex++) {
        if (cancelled) break;

        const record = batch[localIndex];
        const recordIndex = globalRecordIndex + localIndex;
        let recordAllFieldsSuccess = true;

        // 3. For each requested field
        for (const field of requestedFields) {
          if (cancelled) break;

          // Resolve provider list from pre-computed map
          const providers = fieldProviders[field] ?? [];
          if (providers.length === 0) {
            // No providers for this field — mark as failed
            recordAllFieldsSuccess = false;
            continue;
          }

          let fieldEnriched = false;

          // 4. Waterfall: iterate providers in order
          for (const providerSlug of providers) {
            if (cancelled) break;

            // 5. Idempotency key format: {jobId}:{recordIndex}:{fieldName}:{providerSlug}
            const idempotencyKey = `${jobId}:${recordIndex}:${field}:${providerSlug}`;

            try {
              const result = await enrichRecord({
                jobId,
                workspaceId,
                recordIndex,
                inputData: record,
                fieldName: field,
                providerSlug,
                idempotencyKey,
              });

              if (result.success && result.isComplete) {
                // Waterfall stops on first complete success
                fieldEnriched = true;
                totalCreditsConsumed += result.creditsConsumed;
                break;
              }

              // Not complete — credits were already refunded by the activity
              // for incomplete results. Try next provider in waterfall.
            } catch (err) {
              // 6. Handle cancellation signal
              if (isCancellation(err)) {
                cancelled = true;
                break;
              }
              // Activity failed after retries — try next provider in waterfall
            }
          }

          if (!fieldEnriched && !cancelled) {
            recordAllFieldsSuccess = false;
          }
        }

        if (!cancelled) {
          if (recordAllFieldsSuccess) {
            completedRecords++;
          } else {
            failedRecords++;
          }
        }
      }

      globalRecordIndex += batch.length;
    }
  } catch (err) {
    // Top-level catch for cancellation that may propagate from inner loops
    if (isCancellation(err)) {
      cancelled = true;
    } else {
      throw err;
    }
  }

  // 7. Compute final status
  const totalRecords = batches.reduce((sum, batch) => sum + batch.length, 0);
  let finalStatus: string;

  if (cancelled) {
    finalStatus = 'cancelled';
  } else if (failedRecords === 0 && completedRecords === totalRecords) {
    finalStatus = 'completed';
  } else if (completedRecords === 0) {
    finalStatus = 'failed';
  } else {
    finalStatus = 'partially_completed';
  }

  // 8. Update job with final status and counters
  await updateJobStatusActivity({
    jobId,
    status: finalStatus,
    completedRecords,
    failedRecords,
  });

  // 9. Trigger webhook delivery for terminal state
  const eventName = `job.${finalStatus}`;
  await deliverWebhookActivity({
    workspaceId,
    payload: {
      event: eventName,
      jobId,
      workspaceId,
      status: finalStatus,
      summary: {
        totalRecords,
        completedRecords,
        failedRecords,
        creditsConsumed: totalCreditsConsumed,
      },
      timestamp: new Date().toISOString(),
    },
  });
}
