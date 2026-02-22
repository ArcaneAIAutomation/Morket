import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { createApp } from '../../src/app';
import type { AppConfig } from '../../src/app';

/**
 * Integration tests for the search module.
 *
 * These tests verify the full HTTP request/response cycle through
 * Express middleware (validation, RBAC, error handling) using supertest.
 *
 * OpenSearch and PostgreSQL are mocked — these tests focus on the
 * API layer behavior, not the data stores.
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockOsSearch = vi.fn();
const mockOsIndicesCreate = vi.fn();
const mockOsIndicesDelete = vi.fn();
const mockOsBulk = vi.fn();
const mockOsClusterHealth = vi.fn();
const mockOsCatIndices = vi.fn();

vi.mock('../../src/modules/search/opensearch/client', () => ({
  getOpenSearch: () => ({
    indices: { create: mockOsIndicesCreate, delete: mockOsIndicesDelete },
    bulk: mockOsBulk,
    search: mockOsSearch,
    cluster: { health: mockOsClusterHealth },
    cat: { indices: mockOsCatIndices },
  }),
  healthCheck: vi.fn().mockResolvedValue({ status: 'green' }),
  initOpenSearch: vi.fn(),
}));

vi.mock('../../src/modules/search/search.repository', () => ({
  createReindexJob: vi.fn().mockResolvedValue({
    id: 'job-1', workspaceId: 'ws-1', status: 'pending',
    totalDocuments: 0, indexedDocuments: 0, failedDocuments: 0,
    startedAt: null, completedAt: null, errorReason: null, createdAt: new Date(),
  }),
  updateReindexProgress: vi.fn().mockResolvedValue({
    id: 'job-1', workspaceId: 'ws-1', status: 'running',
    totalDocuments: 0, indexedDocuments: 0, failedDocuments: 0,
    startedAt: new Date(), completedAt: null, errorReason: null, createdAt: new Date(),
  }),
  getLatestReindexJob: vi.fn().mockResolvedValue(null),
  upsertIndexStatus: vi.fn(),
  fetchEnrichmentRecordsBatch: vi.fn().mockResolvedValue({ records: [], nextCursor: null }),
  fetchContactCompanyRecordsBatch: vi.fn().mockResolvedValue({ records: [], nextCursor: null }),
  fetchScrapeResultsBatch: vi.fn().mockResolvedValue({ records: [], nextCursor: null }),
}));

// Mock auth middleware to inject a test user
vi.mock('../../src/middleware/auth', () => ({
  createAuthMiddleware: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.user = { userId: 'user-1', email: 'test@example.com' };
    next();
  },
}));

// Mock RBAC to always pass (we test RBAC separately)
vi.mock('../../src/middleware/rbac', () => ({
  requireRole: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    if (req.user) {
      (req.user as Record<string, unknown>).role = 'admin';
      (req.user as Record<string, unknown>).workspaceId = (req as Record<string, Record<string, string>>).params?.id;
    }
    next();
  },
}));

vi.mock('../../src/shared/db', () => ({
  getPool: () => ({
    connect: vi.fn().mockResolvedValue({
      query: vi.fn(),
      release: vi.fn(),
    }),
  }),
  query: vi.fn(),
}));

vi.mock('../../src/clickhouse/client', () => ({
  healthCheck: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/middleware/rateLimiter', () => ({
  generalRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  _resetRateLimiterState: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const config: AppConfig = {
  corsOrigin: '*',
  jwtSecret: 'test-secret',
  jwtAccessExpiry: '15m',
  jwtRefreshExpiry: '7d',
  encryptionMasterKey: 'a'.repeat(64),
};

const WS_ID = '00000000-0000-0000-0000-000000000001';

describe('Search Integration Tests', () => {
  let request: supertest.Agent;

  beforeEach(() => {
    vi.resetAllMocks();
    const app = createApp(config);
    request = supertest.agent(app);
  });

  describe('POST /api/v1/workspaces/:id/search', () => {
    it('returns 200 with search results', async () => {
      mockOsSearch.mockResolvedValueOnce({
        body: {
          timed_out: false,
          hits: {
            total: { value: 1 },
            hits: [{
              _source: {
                record_id: 'r1',
                document_type: 'contact',
                workspace_id: WS_ID,
                name: 'Jane Doe',
                email: null,
                company: 'Acme',
                job_title: null,
                location: null,
                phone: null,
                domain: null,
                provider_slug: null,
                enrichment_status: null,
                tags: null,
                source_url: null,
                scrape_target_type: null,
                created_at: '2025-01-01T00:00:00.000Z',
                updated_at: '2025-01-01T00:00:00.000Z',
              },
              _score: 5.5,
              highlight: { name: ['<mark>Jane</mark> Doe'] },
            }],
          },
          aggregations: {
            document_type: { buckets: [{ key: 'contact', doc_count: 1 }] },
            provider_slug: { buckets: [] },
            enrichment_status: { buckets: [] },
            scrape_target_type: { buckets: [] },
            tags: { buckets: [] },
          },
        },
      });

      const res = await request
        .post(`/api/v1/workspaces/${WS_ID}/search`)
        .send({ q: 'Jane', page: 1, pageSize: 20 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Jane Doe');
      expect(res.body.data[0].highlights).toBeDefined();
      expect(res.body.meta.total).toBe(1);
      expect(res.body.meta.facets).toBeDefined();
    });

    it('returns 200 with empty results for no matches', async () => {
      mockOsSearch.mockResolvedValueOnce({
        body: {
          timed_out: false,
          hits: { total: { value: 0 }, hits: [] },
          aggregations: {},
        },
      });

      const res = await request
        .post(`/api/v1/workspaces/${WS_ID}/search`)
        .send({ q: 'nonexistent' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBe(0);
    });

    it('returns 400 for invalid workspace ID', async () => {
      const res = await request
        .post('/api/v1/workspaces/not-a-uuid/search')
        .send({ q: 'test' });

      expect(res.status).toBe(400);
    });

    it('returns 400 for search term > 500 chars', async () => {
      const res = await request
        .post(`/api/v1/workspaces/${WS_ID}/search`)
        .send({ q: 'a'.repeat(501) });

      expect(res.status).toBe(400);
    });

    it('returns 400 for pageSize > 100', async () => {
      const res = await request
        .post(`/api/v1/workspaces/${WS_ID}/search`)
        .send({ q: 'test', pageSize: 101 });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/workspaces/:id/search/suggest', () => {
    it('returns 200 with suggestions', async () => {
      mockOsSearch.mockResolvedValueOnce({
        body: {
          timed_out: false,
          hits: {
            total: { value: 2 },
            hits: [
              { _source: { name: 'Jane Doe', company: 'Acme', job_title: null }, _score: 5 },
              { _source: { name: 'Jane Smith', company: null, job_title: null }, _score: 4 },
            ],
          },
        },
      });

      const res = await request
        .get(`/api/v1/workspaces/${WS_ID}/search/suggest`)
        .query({ q: 'Jan' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 400 for prefix < 2 chars', async () => {
      const res = await request
        .get(`/api/v1/workspaces/${WS_ID}/search/suggest`)
        .query({ q: 'J' });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/workspaces/:id/search/reindex/status', () => {
    it('returns 200 with null when no reindex job exists', async () => {
      const res = await request
        .get(`/api/v1/workspaces/${WS_ID}/search/reindex/status`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });
  });

  describe('GET /api/v1/admin/search/health', () => {
    it('returns 200 with cluster health', async () => {
      mockOsClusterHealth.mockResolvedValueOnce({
        body: {
          status: 'green',
          number_of_nodes: 3,
          active_primary_shards: 10,
          unassigned_shards: 0,
          cluster_name: 'morket-cluster',
        },
      });

      const res = await request.get('/api/v1/admin/search/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('green');
      expect(res.body.data.numberOfNodes).toBe(3);
    });
  });

  describe('GET /api/v1/admin/search/indices', () => {
    it('returns 200 with index list', async () => {
      mockOsCatIndices.mockResolvedValueOnce({
        body: [
          { index: 'morket-workspace-ws1', health: 'green', 'docs.count': '500', 'store.size': '2.1mb' },
        ],
      });

      const res = await request.get('/api/v1/admin/search/indices');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].index).toBe('morket-workspace-ws1');
      expect(res.body.data[0].docsCount).toBe(500);
    });
  });

  describe('GET /api/v1/health', () => {
    it('includes opensearch status in health check', async () => {
      const res = await request.get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.opensearch).toBeDefined();
    });
  });
});
