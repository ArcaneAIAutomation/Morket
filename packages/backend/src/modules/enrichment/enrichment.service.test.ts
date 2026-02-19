import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock setup (must be before service import) ---

vi.mock('../credit/credit.service', () => ({
  getBilling: vi.fn(),
}));

vi.mock('./job.repository', () => ({
  createJob: vi.fn(),
  getJobById: vi.fn(),
  listJobs: vi.fn(),
  updateJobStatus: vi.fn(),
}));

vi.mock('./record.repository', () => ({
  getRecordById: vi.fn(),
  listRecordsByJob: vi.fn(),
}));

import * as creditService from '../credit/credit.service';
import * as jobRepo from './job.repository';
import * as recordRepo from './record.repository';
import {
  createJob,
  getJob,
  cancelJob,
  getRecord,
  setTemporalClient,
  setRegistry,
} from './enrichment.service';
import { createProviderRegistry } from './provider-registry';
import { NotFoundError, ValidationError, InsufficientCreditsError } from '../../shared/errors';
import type { EnrichmentJob } from './job.repository';
import type { EnrichmentRecord } from './record.repository';
import type { BillingRecord } from '../credit/billing.repository';

// --- Shared fixtures ---

const mockTemporalClient = {
  startEnrichmentWorkflow: vi.fn().mockResolvedValue(undefined),
  cancelEnrichmentWorkflow: vi.fn().mockResolvedValue(undefined),
};

const now = new Date('2024-06-01T00:00:00Z');

function makeBilling(overrides: Partial<BillingRecord> = {}): BillingRecord {
  return {
    workspaceId: 'ws-1',
    planType: 'pro',
    creditBalance: 1000,
    creditLimit: 5000,
    billingCycleStart: now,
    billingCycleEnd: now,
    autoRecharge: false,
    autoRechargeThreshold: 0,
    autoRechargeAmount: 0,
    ...overrides,
  };
}

function makeJob(overrides: Partial<EnrichmentJob> = {}): EnrichmentJob {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    status: 'pending',
    requestedFields: ['email'],
    waterfallConfig: null,
    totalRecords: 1,
    completedRecords: 0,
    failedRecords: 0,
    estimatedCredits: 2,
    createdBy: 'user-1',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    ...overrides,
  };
}

function makeRecord(overrides: Partial<EnrichmentRecord> = {}): EnrichmentRecord {
  return {
    id: 'rec-1',
    jobId: 'job-1',
    workspaceId: 'ws-1',
    inputData: { email: 'test@example.com' },
    outputData: null,
    providerSlug: 'apollo',
    creditsConsumed: 2,
    status: 'success',
    errorReason: null,
    idempotencyKey: 'job-1:0:email:apollo',
    creditTransactionId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('enrichment.service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setTemporalClient(mockTemporalClient);
    setRegistry(createProviderRegistry());
  });

  // ---------------------------------------------------------------
  // createJob
  // ---------------------------------------------------------------
  describe('createJob', () => {
    it('happy path — creates job and starts workflow', async () => {
      const billing = makeBilling({ creditBalance: 1000 });
      const job = makeJob();

      vi.mocked(creditService.getBilling).mockResolvedValue(billing);
      vi.mocked(jobRepo.createJob).mockResolvedValue(job);

      const result = await createJob('ws-1', 'user-1', {
        records: [{ email: 'a@b.com' }],
        fields: ['email'],
      });

      expect(result).toEqual(job);
      expect(creditService.getBilling).toHaveBeenCalledWith('ws-1');
      expect(jobRepo.createJob).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          createdBy: 'user-1',
          totalRecords: 1,
          requestedFields: ['email'],
        }),
      );
      expect(mockTemporalClient.startEnrichmentWorkflow).toHaveBeenCalledWith(
        job.id,
        expect.objectContaining({
          jobId: job.id,
          workspaceId: 'ws-1',
          requestedFields: ['email'],
        }),
      );
    });

    it('rejects when workspace has insufficient credits', async () => {
      const billing = makeBilling({ creditBalance: 0 });
      vi.mocked(creditService.getBilling).mockResolvedValue(billing);

      await expect(
        createJob('ws-1', 'user-1', {
          records: [{ email: 'a@b.com' }],
          fields: ['email'],
        }),
      ).rejects.toThrow(InsufficientCreditsError);

      expect(jobRepo.createJob).not.toHaveBeenCalled();
      expect(mockTemporalClient.startEnrichmentWorkflow).not.toHaveBeenCalled();
    });

    it('rejects input records that fail provider schema validation', async () => {
      const billing = makeBilling({ creditBalance: 1000 });
      vi.mocked(creditService.getBilling).mockResolvedValue(billing);

      // Apollo requires { email: string (email format) } — pass invalid data
      await expect(
        createJob('ws-1', 'user-1', {
          records: [{ not_email: 'missing' }],
          fields: ['email'],
        }),
      ).rejects.toThrow(ValidationError);

      expect(jobRepo.createJob).not.toHaveBeenCalled();
    });

    it('rejects unknown provider slugs in waterfall config', async () => {
      const billing = makeBilling({ creditBalance: 1000 });
      vi.mocked(creditService.getBilling).mockResolvedValue(billing);

      await expect(
        createJob('ws-1', 'user-1', {
          records: [{ email: 'a@b.com' }],
          fields: ['email'],
          waterfallConfig: {
            email: { providers: ['nonexistent-provider'] },
          },
        }),
      ).rejects.toThrow(ValidationError);

      expect(jobRepo.createJob).not.toHaveBeenCalled();
    });

    it('splits >1000 records into batches', async () => {
      const billing = makeBilling({ creditBalance: 100_000 });
      const job = makeJob({ totalRecords: 2500 });

      vi.mocked(creditService.getBilling).mockResolvedValue(billing);
      vi.mocked(jobRepo.createJob).mockResolvedValue(job);

      // Generate 2500 valid records for the apollo input schema (email field)
      const records = Array.from({ length: 2500 }, (_, i) => ({
        email: `user${i}@example.com`,
      }));

      await createJob('ws-1', 'user-1', {
        records,
        fields: ['email'],
      });

      // Verify the workflow was started with batches
      const workflowCall = mockTemporalClient.startEnrichmentWorkflow.mock.calls[0];
      const workflowInput = workflowCall[1] as { batches: unknown[][] };

      // 2500 records / 1000 max = 3 batches (1000, 1000, 500)
      expect(workflowInput.batches).toHaveLength(3);
      expect(workflowInput.batches[0]).toHaveLength(1000);
      expect(workflowInput.batches[1]).toHaveLength(1000);
      expect(workflowInput.batches[2]).toHaveLength(500);
    });
  });

  // ---------------------------------------------------------------
  // getJob
  // ---------------------------------------------------------------
  describe('getJob', () => {
    it('returns job when found', async () => {
      const job = makeJob();
      vi.mocked(jobRepo.getJobById).mockResolvedValue(job);

      const result = await getJob('ws-1', 'job-1');

      expect(result).toEqual(job);
      expect(jobRepo.getJobById).toHaveBeenCalledWith('job-1', 'ws-1');
    });

    it('throws NotFoundError when job does not exist', async () => {
      vi.mocked(jobRepo.getJobById).mockResolvedValue(null);

      await expect(getJob('ws-1', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  // ---------------------------------------------------------------
  // cancelJob
  // ---------------------------------------------------------------
  describe('cancelJob', () => {
    it('sends cancel signal and updates status to cancelled', async () => {
      const job = makeJob({ status: 'running' });
      const cancelledJob = makeJob({ status: 'cancelled' });

      vi.mocked(jobRepo.getJobById).mockResolvedValue(job);
      vi.mocked(jobRepo.updateJobStatus).mockResolvedValue(cancelledJob);

      const result = await cancelJob('ws-1', 'job-1');

      expect(result.status).toBe('cancelled');
      expect(mockTemporalClient.cancelEnrichmentWorkflow).toHaveBeenCalledWith('job-1');
      expect(jobRepo.updateJobStatus).toHaveBeenCalledWith('job-1', { status: 'cancelled' });
    });

    it('throws NotFoundError for missing job', async () => {
      vi.mocked(jobRepo.getJobById).mockResolvedValue(null);

      await expect(cancelJob('ws-1', 'nonexistent')).rejects.toThrow(NotFoundError);
      expect(mockTemporalClient.cancelEnrichmentWorkflow).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // getRecord
  // ---------------------------------------------------------------
  describe('getRecord', () => {
    it('returns record when found', async () => {
      const record = makeRecord();
      vi.mocked(recordRepo.getRecordById).mockResolvedValue(record);

      const result = await getRecord('ws-1', 'rec-1');

      expect(result).toEqual(record);
      expect(recordRepo.getRecordById).toHaveBeenCalledWith('rec-1', 'ws-1');
    });

    it('throws NotFoundError when record does not exist', async () => {
      vi.mocked(recordRepo.getRecordById).mockResolvedValue(null);

      await expect(getRecord('ws-1', 'nonexistent')).rejects.toThrow(NotFoundError);
    });
  });
});
