import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { createSearchController } from './search.controller';
import type { SearchService } from './search.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    params: { id: '00000000-0000-0000-0000-000000000001' },
    body: {},
    query: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

function mockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

function createMockService(): SearchService {
  return {
    createWorkspaceIndex: vi.fn(),
    deleteWorkspaceIndex: vi.fn(),
    reindexWorkspace: vi.fn(),
    getReindexStatus: vi.fn(),
    search: vi.fn(),
    suggest: vi.fn(),
    getClusterHealth: vi.fn(),
    getIndexList: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('search.controller', () => {
  let service: SearchService;
  let controller: ReturnType<typeof createSearchController>;

  beforeEach(() => {
    vi.resetAllMocks();
    service = createMockService();
    controller = createSearchController(service);
  });

  // --- search handler ---

  describe('search', () => {
    it('returns 200 with data, meta (facets + pagination + executionTimeMs)', async () => {
      const searchResult = {
        data: [
          {
            record_id: 'r1',
            document_type: 'contact',
            workspace_id: 'ws1',
            name: 'Jane',
            email: null,
            company: null,
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
            score: 5.5,
            highlights: { name: ['<mark>Jane</mark>'] },
          },
        ],
        meta: {
          total: 1,
          page: 1,
          pageSize: 20,
          totalPages: 1,
          executionTimeMs: 12,
          facets: { document_type: [{ value: 'contact', count: 1 }] },
        },
      };
      (service.search as ReturnType<typeof vi.fn>).mockResolvedValue(searchResult);

      const req = mockReq({ body: { q: 'Jane', page: 1, pageSize: 20 } });
      const res = mockRes();
      const next = mockNext();

      await controller.search(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(json.success).toBe(true);
      expect(json.data).toEqual(searchResult.data);
      expect(json.error).toBeNull();
      expect(json.meta.total).toBe(1);
      expect(json.meta.page).toBe(1);
      expect(json.meta.facets).toBeDefined();
      expect(typeof json.meta.executionTimeMs).toBe('number');
    });

    it('passes errors to next()', async () => {
      const error = new Error('search failed');
      (service.search as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const req = mockReq({ body: { q: 'test' } });
      const res = mockRes();
      const next = mockNext();

      await controller.search(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // --- suggest handler ---

  describe('suggest', () => {
    it('returns 200 with suggestions array', async () => {
      const suggestions = ['Jane Doe', 'Jane Smith'];
      (service.suggest as ReturnType<typeof vi.fn>).mockResolvedValue(suggestions);

      const req = mockReq({ query: { q: 'Jan' } as Record<string, string> });
      const res = mockRes();
      const next = mockNext();

      await controller.suggest(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(json.success).toBe(true);
      expect(json.data).toEqual(suggestions);
      expect(json.error).toBeNull();
    });

    it('passes errors to next()', async () => {
      const error = new Error('suggest failed');
      (service.suggest as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const req = mockReq({ query: { q: 'Ja' } as Record<string, string> });
      const res = mockRes();
      const next = mockNext();

      await controller.suggest(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // --- reindex handler ---

  describe('reindex', () => {
    it('returns 202 with job data', async () => {
      const job = {
        id: 'job-1',
        workspaceId: 'ws-1',
        status: 'running',
        totalDocuments: 0,
        indexedDocuments: 0,
        failedDocuments: 0,
        startedAt: new Date(),
        completedAt: null,
        errorReason: null,
        createdAt: new Date(),
      };
      (service.reindexWorkspace as ReturnType<typeof vi.fn>).mockResolvedValue(job);

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await controller.reindex(req, res, next);

      expect(res.status).toHaveBeenCalledWith(202);
      const json = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(json.success).toBe(true);
      expect(json.data).toEqual(job);
      expect(json.error).toBeNull();
    });

    it('passes errors to next()', async () => {
      const error = new Error('reindex failed');
      (service.reindexWorkspace as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await controller.reindex(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // --- getReindexStatus handler ---

  describe('getReindexStatus', () => {
    it('returns 200 with status data', async () => {
      const status = {
        id: 'job-1',
        workspaceId: 'ws-1',
        status: 'completed',
        totalDocuments: 100,
        indexedDocuments: 98,
        failedDocuments: 2,
        startedAt: new Date(),
        completedAt: new Date(),
        errorReason: '2 documents failed to index',
        createdAt: new Date(),
      };
      (service.getReindexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(status);

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await controller.getReindexStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(json.success).toBe(true);
      expect(json.data).toEqual(status);
    });

    it('returns 200 with null when no reindex job exists', async () => {
      (service.getReindexStatus as ReturnType<typeof vi.fn>).mockResolvedValue(null);

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await controller.getReindexStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(json.success).toBe(true);
      expect(json.data).toBeNull();
    });
  });

  // --- getClusterHealth handler ---

  describe('getClusterHealth', () => {
    it('returns 200 with cluster health', async () => {
      const health = {
        status: 'green' as const,
        numberOfNodes: 3,
        activeShards: 10,
        unassignedShards: 0,
        clusterName: 'morket-cluster',
      };
      (service.getClusterHealth as ReturnType<typeof vi.fn>).mockResolvedValue(health);

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await controller.getClusterHealth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(json.success).toBe(true);
      expect(json.data).toEqual(health);
    });

    it('passes errors to next()', async () => {
      const error = new Error('cluster unreachable');
      (service.getClusterHealth as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await controller.getClusterHealth(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // --- getIndexList handler ---

  describe('getIndexList', () => {
    it('returns 200 with index list', async () => {
      const indices = [
        { index: 'morket-workspace-ws1', health: 'green', docsCount: 500, storageSize: '2.1mb' },
        { index: 'morket-workspace-ws2', health: 'yellow', docsCount: 120, storageSize: '800kb' },
      ];
      (service.getIndexList as ReturnType<typeof vi.fn>).mockResolvedValue(indices);

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await controller.getIndexList(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const json = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(json.success).toBe(true);
      expect(json.data).toEqual(indices);
    });

    it('passes errors to next()', async () => {
      const error = new Error('index list failed');
      (service.getIndexList as ReturnType<typeof vi.fn>).mockRejectedValue(error);

      const req = mockReq();
      const res = mockRes();
      const next = mockNext();

      await controller.getIndexList(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
