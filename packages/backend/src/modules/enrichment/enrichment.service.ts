/**
 * Enrichment service — orchestrates enrichment job lifecycle.
 *
 * Handles job creation (with input validation, credit estimation, balance
 * checking, batch splitting), job retrieval, listing, cancellation, and
 * record access. Delegates persistence to job/record repositories and
 * credit checks to the Credit Service. Workflow execution is started via
 * a thin Temporal client abstraction that can be swapped for testing.
 */

import { NotFoundError, ValidationError, InsufficientCreditsError } from '../../shared/errors';
import * as creditService from '../credit/credit.service';
import { createProviderRegistry, type IProviderRegistry } from './provider-registry';
import * as jobRepo from './job.repository';
import * as recordRepo from './record.repository';
import type { CreateJobBody } from './enrichment.schemas';
import type { EnrichmentJob } from './job.repository';
import type { EnrichmentRecord } from './record.repository';

// === Temporal client abstraction ===

export interface TemporalClient {
  startEnrichmentWorkflow(jobId: string, input: unknown): Promise<void>;
  cancelEnrichmentWorkflow(jobId: string): Promise<void>;
}

let temporalClient: TemporalClient | null = null;

export function setTemporalClient(client: TemporalClient): void {
  temporalClient = client;
}

export function getTemporalClient(): TemporalClient {
  if (!temporalClient) {
    throw new Error('Temporal client not initialized. Call setTemporalClient() first.');
  }
  return temporalClient;
}

// === Singleton provider registry ===

let registryInstance: IProviderRegistry | null = null;

function getRegistry(): IProviderRegistry {
  if (!registryInstance) {
    registryInstance = createProviderRegistry();
  }
  return registryInstance;
}

/** Exposed for testing — allows replacing the singleton registry. */
export function setRegistry(registry: IProviderRegistry): void {
  registryInstance = registry;
}

// === Constants ===

const MAX_BATCH_SIZE = 1000;

// === Service functions ===

/**
 * Create an enrichment job.
 *
 * 1. Validate that at least one provider supports each requested field
 * 2. Validate waterfall config provider slugs if provided
 * 3. Validate input records against provider input schemas for requested fields
 * 4. Estimate total credit cost
 * 5. Check workspace balance — reject if insufficient
 * 6. Split records into batches of 1000 max
 * 7. Insert job via repository
 * 8. Pre-compute field → provider slugs map for the workflow
 * 9. Start Temporal workflow
 * 10. Return the created job
 */
export async function createJob(
  workspaceId: string,
  userId: string,
  input: CreateJobBody,
): Promise<EnrichmentJob> {
  const registry = getRegistry();

  // 1. Validate each requested field has at least one supporting provider
  for (const field of input.fields) {
    const providers = registry.getProvidersForField(field);
    if (providers.length === 0) {
      throw new ValidationError(`No provider supports the field "${field}"`);
    }
  }

  // 2. Validate waterfall config provider slugs
  if (input.waterfallConfig) {
    const allSlugs = new Set<string>();
    for (const fieldConfig of Object.values(input.waterfallConfig)) {
      for (const slug of fieldConfig.providers) {
        allSlugs.add(slug);
      }
    }
    registry.validateProviders(Array.from(allSlugs));
  }

  // 3. Validate input records against provider input schemas for requested fields
  for (const field of input.fields) {
    let providers;
    if (input.waterfallConfig?.[field]) {
      // Use the waterfall providers for this field
      providers = input.waterfallConfig[field].providers
        .map((slug) => registry.getProvider(slug))
        .filter((p) => p !== undefined);
    } else {
      providers = registry.getProvidersForField(field);
    }

    if (providers.length === 0) continue;

    // Validate each record against the first provider's input schema
    const provider = providers[0];
    for (let i = 0; i < input.records.length; i++) {
      const result = provider.inputSchema.safeParse(input.records[i]);
      if (!result.success) {
        const issues = result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        throw new ValidationError(
          `Record ${i} fails validation for provider "${provider.slug}": ${issues}`,
        );
      }
    }
  }

  // 4. Estimate credits
  const estimatedCredits = registry.estimateCredits(
    input.records.length,
    input.fields,
    input.waterfallConfig,
  );

  // 5. Check workspace balance
  const billing = await creditService.getBilling(workspaceId);
  if (billing.creditBalance < estimatedCredits) {
    throw new InsufficientCreditsError(
      `Insufficient credits: balance is ${billing.creditBalance}, estimated cost is ${estimatedCredits}`,
    );
  }

  // 6. Split records into batches of MAX_BATCH_SIZE
  const batches: Record<string, unknown>[][] = [];
  for (let i = 0; i < input.records.length; i += MAX_BATCH_SIZE) {
    batches.push(input.records.slice(i, i + MAX_BATCH_SIZE));
  }

  // 7. Insert job
  const job = await jobRepo.createJob({
    workspaceId,
    requestedFields: input.fields,
    waterfallConfig: input.waterfallConfig ?? null,
    totalRecords: input.records.length,
    estimatedCredits,
    createdBy: userId,
  });

  // 8. Pre-compute field → provider slugs map for the workflow.
  //    The workflow runs in the Temporal sandbox and cannot access the
  //    provider registry, so we resolve provider lists here.
  const fieldProviders: Record<string, string[]> = {};
  for (const field of input.fields) {
    if (input.waterfallConfig?.[field]) {
      fieldProviders[field] = input.waterfallConfig[field].providers;
    } else {
      fieldProviders[field] = registry
        .getProvidersForField(field)
        .map((p) => p.slug);
    }
  }

  // 9. Start Temporal workflow
  const temporal = getTemporalClient();
  await temporal.startEnrichmentWorkflow(job.id, {
    jobId: job.id,
    workspaceId,
    batches,
    requestedFields: input.fields,
    waterfallConfig: input.waterfallConfig ?? null,
    fieldProviders,
  });

  // 10. Return the created job
  return job;
}

/**
 * Fetch a single enrichment job by ID, scoped to workspace.
 * Throws NotFoundError if the job does not exist.
 */
export async function getJob(workspaceId: string, jobId: string): Promise<EnrichmentJob> {
  const job = await jobRepo.getJobById(jobId, workspaceId);
  if (!job) {
    throw new NotFoundError(`Enrichment job ${jobId} not found`);
  }
  return job;
}

/**
 * List enrichment jobs for a workspace with pagination.
 */
export async function listJobs(
  workspaceId: string,
  pagination: { page: number; limit: number },
): Promise<{ jobs: EnrichmentJob[]; total: number }> {
  return jobRepo.listJobs(workspaceId, pagination);
}

/**
 * Cancel a running enrichment job.
 *
 * 1. Fetch the job (throws NotFoundError if missing)
 * 2. Send cancel signal to Temporal workflow
 * 3. Update job status to 'cancelled'
 * 4. Return the updated job
 */
export async function cancelJob(workspaceId: string, jobId: string): Promise<EnrichmentJob> {
  const job = await getJob(workspaceId, jobId);

  const temporal = getTemporalClient();
  await temporal.cancelEnrichmentWorkflow(job.id);

  const updated = await jobRepo.updateJobStatus(jobId, {
    status: 'cancelled',
  });

  // updateJobStatus returns null only if the row doesn't exist,
  // which shouldn't happen since we just fetched it above
  return updated!;
}

/**
 * Fetch a single enrichment record by ID, scoped to workspace.
 * Throws NotFoundError if the record does not exist.
 */
export async function getRecord(workspaceId: string, recordId: string): Promise<EnrichmentRecord> {
  const record = await recordRepo.getRecordById(recordId, workspaceId);
  if (!record) {
    throw new NotFoundError(`Enrichment record ${recordId} not found`);
  }
  return record;
}

/**
 * List enrichment records for a job with pagination.
 */
export async function listRecords(
  workspaceId: string,
  jobId: string,
  pagination: { page: number; limit: number },
): Promise<{ records: EnrichmentRecord[]; total: number }> {
  return recordRepo.listRecordsByJob(jobId, workspaceId, pagination);
}
