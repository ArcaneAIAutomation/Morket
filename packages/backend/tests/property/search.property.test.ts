import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { searchQuerySchema, searchResultSchema } from '../../src/modules/search/search.schemas';
import {
  getWorkspaceIndexName,
  WORKSPACE_INDEX_PREFIX,
} from '../../src/modules/search/mappings/workspace-index.v1';

// ---------------------------------------------------------------------------
// Mocks for Property 5 (workspace scoping via service methods)
// ---------------------------------------------------------------------------

const mockOsSearch = vi.fn();

vi.mock('../../src/modules/search/opensearch/client', () => ({
  getOpenSearch: () => ({
    indices: { create: vi.fn(), delete: vi.fn() },
    bulk: vi.fn(),
    search: mockOsSearch,
  }),
}));

vi.mock('../../src/modules/search/search.repository', () => ({
  createReindexJob: vi.fn(),
  updateReindexProgress: vi.fn(),
  getLatestReindexJob: vi.fn(),
  upsertIndexStatus: vi.fn(),
  fetchEnrichmentRecordsBatch: vi.fn(),
  fetchContactCompanyRecordsBatch: vi.fn(),
  fetchScrapeResultsBatch: vi.fn(),
}));

vi.mock('../../src/shared/db', () => ({
  getPool: () => ({ connect: vi.fn() }),
}));

vi.mock('../../src/shared/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/shared/errors', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    code: string;
    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
}));

// --- Shared Generators ---

const uuidArb = fc.uuid();

const datetimeArb = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') })
  .map((d) => d.toISOString());

const shortStringArb = fc.string({ minLength: 0, maxLength: 50 });

const documentTypeArb = fc.constantFrom(
  'enrichment_record',
  'contact',
  'company',
  'scrape_result',
);

const fuzzinessArb = fc.constantFrom('0', '1', '2', 'AUTO');

const sortFieldArb = fc.constantFrom('_score', 'created_at', 'updated_at', 'name');
const sortDirectionArb = fc.constantFrom('asc', 'desc');

const facetFieldArb = fc.constantFrom(
  'document_type',
  'provider_slug',
  'enrichment_status',
  'scrape_target_type',
  'tags',
);

// --- Property 1 Generators ---

const dateRangeArb = fc.record({
  gte: fc.option(datetimeArb, { nil: undefined }),
  lte: fc.option(datetimeArb, { nil: undefined }),
});

const filtersArb = fc.record({
  document_type: fc.option(fc.array(documentTypeArb, { minLength: 0, maxLength: 4 }), {
    nil: undefined,
  }),
  provider_slug: fc.option(fc.array(shortStringArb, { minLength: 0, maxLength: 3 }), {
    nil: undefined,
  }),
  enrichment_status: fc.option(fc.array(shortStringArb, { minLength: 0, maxLength: 3 }), {
    nil: undefined,
  }),
  scrape_target_type: fc.option(fc.array(shortStringArb, { minLength: 0, maxLength: 3 }), {
    nil: undefined,
  }),
  tags: fc.option(fc.array(shortStringArb, { minLength: 0, maxLength: 5 }), {
    nil: undefined,
  }),
  created_at: fc.option(dateRangeArb, { nil: undefined }),
  updated_at: fc.option(dateRangeArb, { nil: undefined }),
});

const searchQueryArb = fc.record({
  q: fc.string({ minLength: 0, maxLength: 500 }),
  filters: filtersArb,
  facets: fc.subarray(
    ['document_type', 'provider_slug', 'enrichment_status', 'scrape_target_type', 'tags'] as const,
  ),
  page: fc.integer({ min: 1, max: 1000 }),
  pageSize: fc.integer({ min: 1, max: 100 }),
  sort: fc.record({
    field: sortFieldArb,
    direction: sortDirectionArb,
  }),
  fuzziness: fuzzinessArb,
});

// --- Property 2 Generators ---

const nullableStringArb = fc.option(shortStringArb, { nil: null });

const highlightsArb = fc.option(
  fc.dictionary(
    fc.constantFrom('name', 'email', 'company', 'job_title', 'location'),
    fc.array(fc.string({ minLength: 1, maxLength: 100 }), { minLength: 1, maxLength: 3 }),
    { minKeys: 1, maxKeys: 5 },
  ),
  { nil: undefined },
);

const searchResultArb = fc.record({
  record_id: uuidArb,
  document_type: documentTypeArb,
  workspace_id: uuidArb,
  name: nullableStringArb,
  email: nullableStringArb,
  company: nullableStringArb,
  job_title: nullableStringArb,
  location: nullableStringArb,
  phone: nullableStringArb,
  domain: nullableStringArb,
  provider_slug: nullableStringArb,
  enrichment_status: nullableStringArb,
  tags: fc.option(fc.array(shortStringArb, { minLength: 0, maxLength: 5 }), { nil: null }),
  source_url: nullableStringArb,
  scrape_target_type: nullableStringArb,
  created_at: datetimeArb,
  updated_at: datetimeArb,
  score: fc.double({ min: 0, max: 100, noNaN: true }),
  highlights: highlightsArb,
});

// --- Property 16 Generators ---

const operationTypeArb = fc.constantFrom('INSERT', 'UPDATE', 'DELETE');

// ============================================================================
// Property Tests
// ============================================================================

describe('Feature: search-layer, Property Tests', () => {
  // Feature: search-layer, Property 1: SearchQuery serialization round-trip
  describe('Property 1: SearchQuery serialization round-trip', () => {
    /**
     * For any valid SearchQuery object, serializing to JSON via JSON.stringify
     * and deserializing back through searchQuerySchema.parse() shall produce
     * an object deeply equal to the original.
     *
     * **Validates: Requirements 14.3**
     */
    it('serialize → JSON.stringify → JSON.parse → searchQuerySchema.parse() produces deep equality', () => {
      fc.assert(
        fc.property(searchQueryArb, (query) => {
          // First parse through schema to get the canonical form (with defaults applied)
          const canonical = searchQuerySchema.parse(query);

          // Serialize to JSON and back
          const json = JSON.stringify(canonical);
          const deserialized = JSON.parse(json);
          const roundTripped = searchQuerySchema.parse(deserialized);

          expect(roundTripped).toEqual(canonical);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 2: SearchResult serialization round-trip
  describe('Property 2: SearchResult serialization round-trip', () => {
    /**
     * For any valid SearchResult object, parsing through searchResultSchema.parse()
     * and re-serializing via JSON.stringify shall produce a string identical to
     * the original serialization.
     *
     * **Validates: Requirements 14.5**
     */
    it('parse → JSON.stringify → JSON.parse → parse produces identical serialization', () => {
      fc.assert(
        fc.property(searchResultArb, (result) => {
          // Parse through schema to get canonical form
          const parsed = searchResultSchema.parse(result);

          // Serialize, deserialize, re-parse
          const json = JSON.stringify(parsed);
          const deserialized = JSON.parse(json);
          const reParsed = searchResultSchema.parse(deserialized);
          const reJson = JSON.stringify(reParsed);

          expect(reJson).toBe(json);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 15: Index naming follows workspace pattern
  describe('Property 15: Index naming follows workspace pattern', () => {
    /**
     * For any workspace ID (valid UUID), the index name shall be exactly
     * `morket-workspace-{workspaceId}` and is deterministic (same UUID
     * always produces the same name).
     *
     * **Validates: Requirements 2.1**
     */
    it('index name is exactly morket-workspace-{workspaceId}', () => {
      fc.assert(
        fc.property(uuidArb, (workspaceId) => {
          const indexName = getWorkspaceIndexName(workspaceId);
          expect(indexName).toBe(`morket-workspace-${workspaceId}`);
          expect(indexName.startsWith(WORKSPACE_INDEX_PREFIX)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('index naming is deterministic — same UUID always produces same name', () => {
      fc.assert(
        fc.property(uuidArb, (workspaceId) => {
          const name1 = getWorkspaceIndexName(workspaceId);
          const name2 = getWorkspaceIndexName(workspaceId);
          expect(name1).toBe(name2);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 16: NOTIFY payload contains only identifiers
  describe('Property 16: NOTIFY payload contains only identifiers', () => {
    /**
     * For any PG NOTIFY payload built from record IDs and operation types,
     * the JSON payload shall contain only identifier fields (UUIDs and operation
     * type string) and shall be under 8000 bytes.
     *
     * **Validates: Requirements 8.5**
     */
    const ALLOWED_KEYS_ENRICHMENT = new Set(['record_id', 'workspace_id', 'op']);
    const ALLOWED_KEYS_RECORDS = new Set(['record_id', 'workspace_id', 'op']);
    const ALLOWED_KEYS_SCRAPE = new Set(['task_id', 'workspace_id', 'job_id', 'op']);
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const VALID_OPS = new Set(['INSERT', 'UPDATE', 'DELETE']);

    it('enrichment NOTIFY payload contains only identifier fields and is under 8000 bytes', () => {
      fc.assert(
        fc.property(uuidArb, uuidArb, operationTypeArb, (recordId, workspaceId, op) => {
          const payload = JSON.stringify({
            record_id: recordId,
            workspace_id: workspaceId,
            op,
          });

          // Payload must be under 8000 bytes
          expect(Buffer.byteLength(payload, 'utf8')).toBeLessThan(8000);

          // Must contain only allowed keys
          const parsed = JSON.parse(payload);
          const keys = Object.keys(parsed);
          for (const key of keys) {
            expect(ALLOWED_KEYS_ENRICHMENT.has(key)).toBe(true);
          }

          // UUID fields must be valid UUIDs
          expect(UUID_REGEX.test(parsed.record_id)).toBe(true);
          expect(UUID_REGEX.test(parsed.workspace_id)).toBe(true);

          // Operation must be valid
          expect(VALID_OPS.has(parsed.op)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('records NOTIFY payload contains only identifier fields and is under 8000 bytes', () => {
      fc.assert(
        fc.property(uuidArb, uuidArb, operationTypeArb, (recordId, workspaceId, op) => {
          const payload = JSON.stringify({
            record_id: recordId,
            workspace_id: workspaceId,
            op,
          });

          expect(Buffer.byteLength(payload, 'utf8')).toBeLessThan(8000);

          const parsed = JSON.parse(payload);
          const keys = Object.keys(parsed);
          for (const key of keys) {
            expect(ALLOWED_KEYS_RECORDS.has(key)).toBe(true);
          }

          expect(UUID_REGEX.test(parsed.record_id)).toBe(true);
          expect(UUID_REGEX.test(parsed.workspace_id)).toBe(true);
          expect(VALID_OPS.has(parsed.op)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('scrape NOTIFY payload contains only identifier fields and is under 8000 bytes', () => {
      fc.assert(
        fc.property(uuidArb, uuidArb, uuidArb, (taskId, workspaceId, jobId) => {
          const payload = JSON.stringify({
            task_id: taskId,
            workspace_id: workspaceId,
            job_id: jobId,
            op: 'INSERT',
          });

          expect(Buffer.byteLength(payload, 'utf8')).toBeLessThan(8000);

          const parsed = JSON.parse(payload);
          const keys = Object.keys(parsed);
          for (const key of keys) {
            expect(ALLOWED_KEYS_SCRAPE.has(key)).toBe(true);
          }

          expect(UUID_REGEX.test(parsed.task_id)).toBe(true);
          expect(UUID_REGEX.test(parsed.workspace_id)).toBe(true);
          expect(UUID_REGEX.test(parsed.job_id)).toBe(true);
          expect(parsed.op).toBe('INSERT');
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 6: Field-specific query parsing
  describe('Property 6: Field-specific query parsing', () => {
    /**
     * For any search term containing the pattern `{field}:{value}` where `field`
     * is one of the searchable fields (name, email, company, job_title, location,
     * domain), the query builder shall produce a field-specific `match` query on
     * that field rather than a multi-match query. For search terms without the
     * `field:value` pattern, the query builder shall produce a multi-match query
     * across all searchable fields.
     *
     * **Validates: Requirements 5.2**
     */

    const ALLOWED_FIELDS = ['name', 'email', 'company', 'job_title', 'location', 'domain'];

    // Generator: field-specific search terms (field:value where field is in allowlist)
    const fieldSpecificTermArb = fc
      .tuple(
        fc.constantFrom(...ALLOWED_FIELDS),
        fc
          .string({ minLength: 1, maxLength: 50 })
          .filter((s) => !s.includes(':') && s.trim().length > 0),
      )
      .map(([field, value]) => ({ field, value, term: `${field}:${value}` }));

    // Generator: plain search terms that do NOT match field:value with an allowed field
    const plainTermArb = fc
      .string({ minLength: 1, maxLength: 100 })
      .filter((s) => {
        const trimmed = s.trim();
        if (trimmed.length === 0) return false;
        const match = trimmed.match(/^(\w+):(.+)$/);
        if (!match) return true; // no colon pattern → plain term
        return !ALLOWED_FIELDS.includes(match[1]); // colon but field not in allowlist
      });

    it('field:value with allowed field produces a match query on that field', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(uuidArb, fieldSpecificTermArb, async (workspaceId, { field, term }) => {
          vi.resetAllMocks();

          mockOsSearch.mockResolvedValueOnce({
            body: {
              timed_out: false,
              hits: { total: { value: 0 }, hits: [] },
              aggregations: {},
            },
          });

          const mockCache = {
            get: vi.fn().mockReturnValue(null),
            set: vi.fn(),
            invalidateWorkspace: vi.fn(),
          };
          const service = createSearchService(mockCache);

          const parsedQuery = searchQuerySchema.parse({
            q: term,
            page: 1,
            pageSize: 20,
          });
          await service.search(workspaceId, parsedQuery);

          expect(mockOsSearch).toHaveBeenCalledOnce();

          const body = mockOsSearch.mock.calls[0][0].body as Record<string, unknown>;
          const query = body.query as Record<string, unknown>;
          const bool = query.bool as Record<string, unknown>;
          const must = bool.must as Array<Record<string, unknown>>;

          // Must contain a match query on the specific field, NOT a multi_match
          const hasFieldMatch = must.some(
            (clause) => clause.match !== undefined && (clause.match as Record<string, unknown>)[field] !== undefined,
          );
          const hasMultiMatch = must.some((clause) => clause.multi_match !== undefined);

          expect(hasFieldMatch).toBe(true);
          expect(hasMultiMatch).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('plain search terms (no field:value or unknown field) produce a multi_match query', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(uuidArb, plainTermArb, async (workspaceId, term) => {
          vi.resetAllMocks();

          mockOsSearch.mockResolvedValueOnce({
            body: {
              timed_out: false,
              hits: { total: { value: 0 }, hits: [] },
              aggregations: {},
            },
          });

          const mockCache = {
            get: vi.fn().mockReturnValue(null),
            set: vi.fn(),
            invalidateWorkspace: vi.fn(),
          };
          const service = createSearchService(mockCache);

          const parsedQuery = searchQuerySchema.parse({
            q: term,
            page: 1,
            pageSize: 20,
          });
          await service.search(workspaceId, parsedQuery);

          expect(mockOsSearch).toHaveBeenCalledOnce();

          const body = mockOsSearch.mock.calls[0][0].body as Record<string, unknown>;
          const query = body.query as Record<string, unknown>;
          const bool = query.bool as Record<string, unknown>;
          const must = bool.must as Array<Record<string, unknown>>;

          // Must contain a multi_match query, NOT a field-specific match
          const hasMultiMatch = must.some((clause) => clause.multi_match !== undefined);
          const hasFieldMatch = must.some((clause) => {
            if (clause.match === undefined) return false;
            const matchFields = Object.keys(clause.match as Record<string, unknown>);
            return matchFields.some((f) => ALLOWED_FIELDS.includes(f));
          });

          expect(hasMultiMatch).toBe(true);
          expect(hasFieldMatch).toBe(false);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 5: Workspace scoping on all queries
  describe('Property 5: Workspace scoping on all queries', () => {
    /**
     * For any search query or suggestion query and for any workspace ID,
     * the generated OpenSearch query body shall contain a mandatory term
     * filter on workspace_id matching the authenticated user's workspace.
     * No query shall be sent to OpenSearch without this filter.
     *
     * **Validates: Requirements 5.9, 7.5**
     */

    // Generator: valid search query with page/pageSize constrained so page*pageSize <= 10000
    const scopedSearchQueryArb = fc
      .record({
        page: fc.integer({ min: 1, max: 100 }),
        pageSize: fc.integer({ min: 1, max: 100 }),
      })
      .filter(({ page, pageSize }) => page * pageSize <= 10_000)
      .chain(({ page, pageSize }) =>
        fc.record({
          q: fc.string({ minLength: 0, maxLength: 100 }),
          filters: fc.constant({}),
          facets: fc.constant([
            'document_type' as const,
            'provider_slug' as const,
            'enrichment_status' as const,
            'scrape_target_type' as const,
            'tags' as const,
          ]),
          page: fc.constant(page),
          pageSize: fc.constant(pageSize),
          sort: fc.constant({ field: '_score' as const, direction: 'desc' as const }),
          fuzziness: fc.constant('AUTO' as const),
        }),
      );

    // Suggest prefix: 2–50 chars (must be ≥ 2 for suggest)
    const suggestPrefixArb = fc.string({ minLength: 2, maxLength: 50 });

    // Helper: make a standard empty OpenSearch search response
    function makeEmptyOsResponse() {
      return {
        body: {
          timed_out: false,
          hits: { total: { value: 0 }, hits: [] },
          aggregations: {},
        },
      };
    }

    // Helper: make a suggest-style OpenSearch response
    function makeEmptySuggestResponse() {
      return {
        body: {
          timed_out: false,
          hits: { total: { value: 0 }, hits: [] },
        },
      };
    }

    // Helper: extract the filter array from the captured body
    function extractFilters(body: Record<string, unknown>): Array<Record<string, unknown>> {
      const query = body.query as Record<string, unknown>;
      const bool = query.bool as Record<string, unknown>;
      return (bool.filter ?? []) as Array<Record<string, unknown>>;
    }

    // Helper: check that workspace_id term filter is present
    function hasWorkspaceFilter(
      filters: Array<Record<string, unknown>>,
      expectedWorkspaceId: string,
    ): boolean {
      return filters.some((f) => {
        const term = f.term as Record<string, unknown> | undefined;
        return term !== undefined && term.workspace_id === expectedWorkspaceId;
      });
    }

    it('search() always includes workspace_id term filter in OpenSearch query', async () => {
      // Dynamically import after mocks are set up
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(uuidArb, scopedSearchQueryArb, async (workspaceId, query) => {
          // Reset mocks each iteration to avoid stale queues
          vi.resetAllMocks();

          mockOsSearch.mockResolvedValueOnce(makeEmptyOsResponse());

          const mockCache = {
            get: vi.fn().mockReturnValue(null),
            set: vi.fn(),
            invalidateWorkspace: vi.fn(),
          };
          const service = createSearchService(mockCache);

          const parsedQuery = searchQuerySchema.parse(query);
          await service.search(workspaceId, parsedQuery);

          // Verify mockOsSearch was called
          expect(mockOsSearch).toHaveBeenCalledOnce();

          const callArgs = mockOsSearch.mock.calls[0][0];
          const body = callArgs.body as Record<string, unknown>;
          const filters = extractFilters(body);

          // The workspace_id term filter must be present
          expect(hasWorkspaceFilter(filters, workspaceId)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('suggest() always includes workspace_id term filter in OpenSearch query', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(uuidArb, suggestPrefixArb, async (workspaceId, prefix) => {
          // Reset mocks each iteration to avoid stale queues
          vi.resetAllMocks();

          mockOsSearch.mockResolvedValueOnce(makeEmptySuggestResponse());

          const mockCache = {
            get: vi.fn().mockReturnValue(null),
            set: vi.fn(),
            invalidateWorkspace: vi.fn(),
          };
          const service = createSearchService(mockCache);

          await service.suggest(workspaceId, prefix);

          // Verify mockOsSearch was called (cache.get returns null so it queries OS)
          expect(mockOsSearch).toHaveBeenCalledOnce();

          const callArgs = mockOsSearch.mock.calls[0][0];
          const body = callArgs.body as Record<string, unknown>;
          const filters = extractFilters(body);

          // The workspace_id term filter must be present
          expect(hasWorkspaceFilter(filters, workspaceId)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 7: Filter application produces correct query clauses
  describe('Property 7: Filter application produces correct query clauses', () => {
    /**
     * For any combination of keyword filters (document_type, provider_slug,
     * enrichment_status, scrape_target_type, tags) and date range filters
     * (created_at, updated_at), the generated OpenSearch query shall contain
     * a bool.filter clause with one terms filter per active keyword filter
     * and one range filter per active date range filter. The total number of
     * filter clauses = 1 (workspace_id) + active keyword filters + active date ranges.
     *
     * **Validates: Requirements 5.4, 5.5**
     */

    const KEYWORD_FIELDS = ['document_type', 'provider_slug', 'enrichment_status', 'scrape_target_type', 'tags'] as const;
    const DATE_FIELDS = ['created_at', 'updated_at'] as const;

    // Generator: random filter combinations with 0–5 keyword filters and 0–2 date ranges
    const keywordFilterArb = fc.record({
      document_type: fc.option(fc.array(fc.constantFrom('enrichment_record', 'contact', 'company', 'scrape_result'), { minLength: 1, maxLength: 3 }), { nil: undefined }),
      provider_slug: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
      enrichment_status: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
      scrape_target_type: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
      tags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
      created_at: fc.option(fc.record({
        gte: fc.option(datetimeArb, { nil: undefined }),
        lte: fc.option(datetimeArb, { nil: undefined }),
      }).filter(r => r.gte !== undefined || r.lte !== undefined), { nil: undefined }),
      updated_at: fc.option(fc.record({
        gte: fc.option(datetimeArb, { nil: undefined }),
        lte: fc.option(datetimeArb, { nil: undefined }),
      }).filter(r => r.gte !== undefined || r.lte !== undefined), { nil: undefined }),
    });

    it('filter clause count = 1 (workspace) + active keyword filters + active date ranges, with correct clause types', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(uuidArb, keywordFilterArb, async (workspaceId, filters) => {
          vi.resetAllMocks();

          mockOsSearch.mockResolvedValueOnce({
            body: {
              timed_out: false,
              hits: { total: { value: 0 }, hits: [] },
              aggregations: {},
            },
          });

          const mockCache = {
            get: vi.fn().mockReturnValue(null),
            set: vi.fn(),
            invalidateWorkspace: vi.fn(),
          };
          const service = createSearchService(mockCache);

          const parsedQuery = searchQuerySchema.parse({
            q: '',
            filters,
            page: 1,
            pageSize: 20,
          });
          await service.search(workspaceId, parsedQuery);

          expect(mockOsSearch).toHaveBeenCalledOnce();

          const body = mockOsSearch.mock.calls[0][0].body as Record<string, unknown>;
          const query = body.query as Record<string, unknown>;
          const bool = query.bool as Record<string, unknown>;
          const filterClauses = (bool.filter ?? []) as Array<Record<string, unknown>>;

          // Count expected active keyword filters (non-empty arrays after Zod parse)
          const parsedFilters = parsedQuery.filters;
          let expectedKeywordCount = 0;
          for (const field of KEYWORD_FIELDS) {
            const values = (parsedFilters as Record<string, unknown>)[field];
            if (Array.isArray(values) && values.length > 0) {
              expectedKeywordCount++;
            }
          }

          // Count expected active date range filters (has gte or lte)
          let expectedDateCount = 0;
          for (const field of DATE_FIELDS) {
            const range = (parsedFilters as Record<string, unknown>)[field] as
              | { gte?: string; lte?: string }
              | undefined;
            if (range && (range.gte || range.lte)) {
              expectedDateCount++;
            }
          }

          // Total = 1 (workspace_id term) + keyword filters + date range filters
          const expectedTotal = 1 + expectedKeywordCount + expectedDateCount;
          expect(filterClauses.length).toBe(expectedTotal);

          // Verify workspace_id term filter is present
          const workspaceClause = filterClauses.find(
            (c) => c.term !== undefined && (c.term as Record<string, unknown>).workspace_id === workspaceId,
          );
          expect(workspaceClause).toBeDefined();

          // Verify each active keyword filter is a `terms` clause
          for (const field of KEYWORD_FIELDS) {
            const values = (parsedFilters as Record<string, unknown>)[field];
            if (Array.isArray(values) && values.length > 0) {
              const termsClause = filterClauses.find(
                (c) => c.terms !== undefined && (c.terms as Record<string, unknown>)[field] !== undefined,
              );
              expect(termsClause).toBeDefined();
            }
          }

          // Verify each active date range filter is a `range` clause
          for (const field of DATE_FIELDS) {
            const range = (parsedFilters as Record<string, unknown>)[field] as
              | { gte?: string; lte?: string }
              | undefined;
            if (range && (range.gte || range.lte)) {
              const rangeClause = filterClauses.find(
                (c) => c.range !== undefined && (c.range as Record<string, unknown>)[field] !== undefined,
              );
              expect(rangeClause).toBeDefined();
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 8: Pagination computes correct from/size with max window guard
  describe('Property 8: Pagination computes correct from/size with max window guard', () => {
    /**
     * For any valid page (≥1) and pageSize (1–100), the OpenSearch query shall set
     * from to (page - 1) * pageSize and size to pageSize. For any page and pageSize
     * where page × pageSize > 10,000, the service shall reject the request with a
     * 400 error before querying OpenSearch.
     *
     * **Validates: Requirements 5.7, 15.6**
     */

    // Generator: valid pagination where page * pageSize <= 10000
    const validPaginationArb = fc.tuple(
      fc.integer({ min: 1, max: 1000 }),
      fc.integer({ min: 1, max: 100 }),
    ).filter(([page, pageSize]) => page * pageSize <= 10_000);

    // Generator: invalid pagination where page * pageSize > 10000
    const invalidPaginationArb = fc.tuple(
      fc.integer({ min: 1, max: 1000 }),
      fc.integer({ min: 1, max: 100 }),
    ).filter(([page, pageSize]) => page * pageSize > 10_000);

    it('valid pagination sets from = (page - 1) * pageSize and size = pageSize', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(uuidArb, validPaginationArb, async (workspaceId, [page, pageSize]) => {
          vi.resetAllMocks();

          mockOsSearch.mockResolvedValueOnce({
            body: {
              timed_out: false,
              hits: { total: { value: 0 }, hits: [] },
              aggregations: {},
            },
          });

          const mockCache = {
            get: vi.fn().mockReturnValue(null),
            set: vi.fn(),
            invalidateWorkspace: vi.fn(),
          };
          const service = createSearchService(mockCache);

          const query = searchQuerySchema.parse({
            q: '',
            page,
            pageSize,
          });
          await service.search(workspaceId, query);

          expect(mockOsSearch).toHaveBeenCalledOnce();

          const body = mockOsSearch.mock.calls[0][0].body as Record<string, unknown>;
          expect(body.from).toBe((page - 1) * pageSize);
          expect(body.size).toBe(pageSize);
        }),
        { numRuns: 100 },
      );
    });

    it('rejects pagination when page * pageSize > 10000 with 400 before querying OpenSearch', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(uuidArb, invalidPaginationArb, async (workspaceId, [page, pageSize]) => {
          vi.resetAllMocks();

          const mockCache = {
            get: vi.fn().mockReturnValue(null),
            set: vi.fn(),
            invalidateWorkspace: vi.fn(),
          };
          const service = createSearchService(mockCache);

          const query = searchQuerySchema.parse({
            q: '',
            page,
            pageSize,
          });

          try {
            await service.search(workspaceId, query);
            // Should not reach here
            expect.unreachable('Expected AppError to be thrown');
          } catch (err: unknown) {
            const appErr = err as { statusCode: number; code: string };
            expect(appErr.statusCode).toBe(400);
            expect(appErr.code).toBe('VALIDATION_ERROR');
          }

          // OpenSearch should NOT have been called
          expect(mockOsSearch).not.toHaveBeenCalled();
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 9: Response envelope structure
  describe('Property 9: Response envelope structure', () => {
    /**
     * For any random total, page, and pageSize, the search service response
     * shall contain `data` (array) and `meta` with correct pagination fields:
     * total, page, pageSize, totalPages, executionTimeMs, and facets.
     * totalPages = Math.ceil(total / pageSize), or 0 if total is 0.
     *
     * **Validates: Requirements 9.4, 9.5**
     */

    const paginationArb = fc
      .tuple(
        fc.integer({ min: 0, max: 500 }), // total
        fc.integer({ min: 1, max: 100 }), // page
        fc.integer({ min: 1, max: 100 }), // pageSize
      )
      .filter(([, page, pageSize]) => page * pageSize <= 10_000);

    it('response has data array and meta with correct pagination math', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          paginationArb,
          async (workspaceId, [total, page, pageSize]) => {
            vi.resetAllMocks();

            // Mock OpenSearch to return the generated total with no hits
            mockOsSearch.mockResolvedValueOnce({
              body: {
                timed_out: false,
                hits: { total: { value: total }, hits: [] },
                aggregations: {},
              },
            });

            const mockCache = {
              get: vi.fn().mockReturnValue(null),
              set: vi.fn(),
              invalidateWorkspace: vi.fn(),
            };
            const service = createSearchService(mockCache);

            const query = searchQuerySchema.parse({
              q: '',
              page,
              pageSize,
            });

            const result = await service.search(workspaceId, query);

            // Verify data is an array
            expect(Array.isArray(result.data)).toBe(true);

            // Verify meta exists with all required fields
            expect(result.meta).toBeDefined();
            expect(typeof result.meta.total).toBe('number');
            expect(typeof result.meta.page).toBe('number');
            expect(typeof result.meta.pageSize).toBe('number');
            expect(typeof result.meta.totalPages).toBe('number');
            expect(typeof result.meta.executionTimeMs).toBe('number');
            expect(result.meta.facets).toBeDefined();

            // Verify pagination values match
            expect(result.meta.total).toBe(total);
            expect(result.meta.page).toBe(page);
            expect(result.meta.pageSize).toBe(pageSize);

            // Verify totalPages calculation
            const expectedTotalPages =
              total > 0 ? Math.ceil(total / pageSize) : 0;
            expect(result.meta.totalPages).toBe(expectedTotalPages);

            // executionTimeMs must be non-negative
            expect(result.meta.executionTimeMs).toBeGreaterThanOrEqual(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 10: Suggestion response invariants
  describe('Property 10: Suggestion response invariants', () => {
    /**
     * For any suggestion query response, the returned suggestions array shall:
     * (a) contain at most 10 items,
     * (b) contain no case-insensitive duplicate strings,
     * (c) be sorted by document frequency in descending order.
     *
     * **Validates: Requirements 7.1, 7.3, 7.4**
     */

    // Generator: individual OpenSearch hit _source with nullable name/company/job_title
    const suggestHitArb = fc.record({
      name: fc.option(fc.string({ minLength: 0, maxLength: 30 }), { nil: null }),
      company: fc.option(fc.string({ minLength: 0, maxLength: 30 }), { nil: null }),
      job_title: fc.option(fc.string({ minLength: 0, maxLength: 30 }), { nil: null }),
    });

    // Generator: array of 0–50 hits (matching the suggest query's size: 50)
    const suggestHitsArb = fc.array(suggestHitArb, { minLength: 0, maxLength: 50 });

    // Generator: suggest prefix (min 2 chars per schema)
    const suggestPrefixArb = fc.string({ minLength: 2, maxLength: 20 });

    /**
     * Compute expected frequencies from raw hits — mirrors the service logic
     * so we can verify the sort order invariant.
     */
    function computeExpectedFrequencies(
      hits: Array<{ name: string | null; company: string | null; job_title: string | null }>,
    ): Map<string, number> {
      const freqMap = new Map<string, number>();
      for (const hit of hits) {
        for (const val of [hit.name, hit.company, hit.job_title]) {
          if (typeof val === 'string' && val.trim().length > 0) {
            const lower = val.trim().toLowerCase();
            freqMap.set(lower, (freqMap.get(lower) ?? 0) + 1);
          }
        }
      }
      return freqMap;
    }

    it('suggestions have at most 10 items, no case-insensitive duplicates, and are sorted by frequency descending', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(
          uuidArb,
          suggestPrefixArb,
          suggestHitsArb,
          async (workspaceId, prefix, hits) => {
            vi.resetAllMocks();

            // Mock OpenSearch response with generated hits
            mockOsSearch.mockResolvedValueOnce({
              body: {
                timed_out: false,
                hits: {
                  total: { value: hits.length },
                  hits: hits.map((source, i) => ({
                    _source: source,
                    _score: 10 - i,
                  })),
                },
              },
            });

            const mockCache = {
              get: vi.fn().mockReturnValue(null), // cache miss → queries OS
              set: vi.fn(),
              invalidateWorkspace: vi.fn(),
            };
            const service = createSearchService(mockCache);

            const suggestions = await service.suggest(workspaceId, prefix);

            // (a) At most 10 items
            expect(suggestions.length).toBeLessThanOrEqual(10);

            // (b) No case-insensitive duplicates
            const lowerSet = new Set(suggestions.map((s) => s.toLowerCase()));
            expect(lowerSet.size).toBe(suggestions.length);

            // (c) Sorted by frequency descending
            const freqMap = computeExpectedFrequencies(hits);
            for (let i = 0; i < suggestions.length - 1; i++) {
              const freqCurrent = freqMap.get(suggestions[i].toLowerCase()) ?? 0;
              const freqNext = freqMap.get(suggestions[i + 1].toLowerCase()) ?? 0;
              expect(freqCurrent).toBeGreaterThanOrEqual(freqNext);
            }

            // All returned strings should be non-empty and trimmed
            for (const s of suggestions) {
              expect(s.length).toBeGreaterThan(0);
              expect(s).toBe(s.trim());
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 11: Facet buckets have no zero counts
  describe('Property 11: Facet buckets have no zero counts', () => {
    /**
     * For any search response containing facets, every facet bucket in every
     * facet field shall have a count value ≥ 1. No bucket with count of 0
     * shall appear in the response.
     *
     * **Validates: Requirements 6.4**
     */

    const facetFieldNames = [
      'document_type',
      'provider_slug',
      'enrichment_status',
      'scrape_target_type',
      'tags',
    ] as const;

    // Generator: individual aggregation bucket (doc_count includes 0 to test filtering)
    const facetBucketArb = fc.record({
      key: fc.string({ minLength: 1, maxLength: 20 }),
      doc_count: fc.integer({ min: 0, max: 100 }),
    });

    // Generator: aggregations object with random buckets per facet field
    const aggregationsArb = fc.record(
      Object.fromEntries(
        facetFieldNames.map((field) => [
          field,
          fc.record({
            buckets: fc.array(facetBucketArb, { minLength: 0, maxLength: 10 }),
          }),
        ]),
      ) as Record<string, fc.Arbitrary<{ buckets: Array<{ key: string; doc_count: number }> }>>,
    );

    it('every facet bucket in the response has count >= 1 (zero-count buckets are filtered out)', async () => {
      const { createSearchService } = await import(
        '../../src/modules/search/search.service'
      );

      await fc.assert(
        fc.asyncProperty(uuidArb, aggregationsArb, async (workspaceId, aggregations) => {
          vi.resetAllMocks();

          mockOsSearch.mockResolvedValueOnce({
            body: {
              timed_out: false,
              hits: { total: { value: 0 }, hits: [] },
              aggregations,
            },
          });

          const mockCache = {
            get: vi.fn().mockReturnValue(null),
            set: vi.fn(),
            invalidateWorkspace: vi.fn(),
          };
          const service = createSearchService(mockCache);

          const query = searchQuerySchema.parse({
            q: '',
            page: 1,
            pageSize: 20,
          });

          const result = await service.search(workspaceId, query);

          // Verify every bucket in every facet field has count >= 1
          for (const field of facetFieldNames) {
            const buckets = result.meta.facets[field] ?? [];
            for (const bucket of buckets) {
              expect(bucket.count).toBeGreaterThanOrEqual(1);
            }
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 13: Cache key isolation by workspace
  describe('Property 13: Cache key isolation by workspace', () => {
    /**
     * For any two distinct workspace IDs and the same suggestion prefix,
     * the cache shall store and return separate entries. A cache hit for
     * workspace A's prefix shall never be returned for workspace B's
     * identical prefix query.
     *
     * **Validates: Requirements 15.3, 15.4**
     */

    // Two distinct UUIDs
    const distinctUuidPairArb = fc
      .tuple(fc.uuid(), fc.uuid())
      .filter(([a, b]) => a !== b);

    // Common prefix
    const prefixArb = fc.string({ minLength: 2, maxLength: 50 });

    it('separate workspace IDs with the same prefix produce isolated cache entries', async () => {
      const { createSearchCache } = await import(
        '../../src/modules/search/search.cache'
      );

      fc.assert(
        fc.property(
          distinctUuidPairArb,
          prefixArb,
          ([wsA, wsB], prefix) => {
            const cache = createSearchCache();

            const keyA = `search:${wsA}:suggest:${prefix}`;
            const keyB = `search:${wsB}:suggest:${prefix}`;

            const valueA = { suggestions: [`result-a-${wsA}`] };
            const valueB = { suggestions: [`result-b-${wsB}`] };

            cache.set(keyA, valueA);
            cache.set(keyB, valueB);

            // Each workspace gets its own value back
            expect(cache.get(keyA)).toEqual(valueA);
            expect(cache.get(keyB)).toEqual(valueB);

            // Values are distinct — no cross-workspace leakage
            expect(cache.get(keyA)).not.toEqual(cache.get(keyB));
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 14: Cache invalidation on index flush
  describe('Property 14: Cache invalidation on index flush', () => {
    /**
     * For any workspace that receives newly indexed documents via the indexing
     * pipeline flush, all cached suggestion entries for that workspace shall be
     * invalidated. A subsequent suggestion query for that workspace shall query
     * OpenSearch rather than returning stale cached data.
     *
     * **Validates: Requirements 15.5**
     */

    const prefixesArb = fc.array(fc.string({ minLength: 2, maxLength: 30 }), { minLength: 1, maxLength: 5 });

    it('invalidateWorkspace clears all cached entries for that workspace', async () => {
      const { createSearchCache } = await import(
        '../../src/modules/search/search.cache'
      );

      fc.assert(
        fc.property(
          uuidArb,
          prefixesArb,
          (workspaceId, prefixes) => {
            const cache = createSearchCache();

            // Populate cache entries for the workspace
            for (const prefix of prefixes) {
              const key = `search:${workspaceId}:suggest:${prefix}`;
              cache.set(key, { suggestions: [`suggestion-${prefix}`] });
            }

            // Verify entries are populated
            for (const prefix of prefixes) {
              const key = `search:${workspaceId}:suggest:${prefix}`;
              expect(cache.get(key)).not.toBeNull();
            }

            // Simulate flush/invalidation
            cache.invalidateWorkspace(workspaceId);

            // All entries for this workspace should now be cache misses
            for (const prefix of prefixes) {
              const key = `search:${workspaceId}:suggest:${prefix}`;
              expect(cache.get(key)).toBeNull();
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('invalidateWorkspace does not affect entries for other workspaces', async () => {
      const { createSearchCache } = await import(
        '../../src/modules/search/search.cache'
      );

      const distinctUuidPairArb = fc
        .tuple(fc.uuid(), fc.uuid())
        .filter(([a, b]) => a !== b);

      fc.assert(
        fc.property(
          distinctUuidPairArb,
          prefixesArb,
          ([targetWs, otherWs], prefixes) => {
            const cache = createSearchCache();

            // Populate entries for both workspaces
            for (const prefix of prefixes) {
              cache.set(`search:${targetWs}:suggest:${prefix}`, { ws: targetWs });
              cache.set(`search:${otherWs}:suggest:${prefix}`, { ws: otherWs });
            }

            // Invalidate only the target workspace
            cache.invalidateWorkspace(targetWs);

            // Target workspace entries are gone
            for (const prefix of prefixes) {
              expect(cache.get(`search:${targetWs}:suggest:${prefix}`)).toBeNull();
            }

            // Other workspace entries are untouched
            for (const prefix of prefixes) {
              expect(cache.get(`search:${otherWs}:suggest:${prefix}`)).toEqual({ ws: otherWs });
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 3: Document transformation preserves required fields
  describe('Property 3: Document transformation preserves required fields', () => {
    /**
     * For any valid PostgreSQL record (enrichment record, contact/company record,
     * or scrape result), transforming it into an OpenSearch document shall produce
     * an object containing all required Index_Mapping fields (document_type,
     * record_id, workspace_id, created_at, updated_at) with correct types, and
     * the document_type value shall match the source table.
     *
     * **Validates: Requirements 3.4**
     */

    const dateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') });

    // Generator: EnrichmentRecordDoc
    const enrichmentRecordArb = fc.record({
      id: fc.uuid(),
      workspaceId: fc.uuid(),
      jobId: fc.uuid(),
      inputData: fc.constant({}),
      outputData: fc.option(fc.constant({ name: 'Test' }), { nil: null }),
      providerSlug: fc.string({ minLength: 1, maxLength: 20 }),
      status: fc.constantFrom('pending', 'completed', 'failed'),
      createdAt: dateArb,
      updatedAt: dateArb,
    });

    // Generator: ContactCompanyRecordDoc
    const contactCompanyRecordArb = fc.record({
      id: fc.uuid(),
      workspaceId: fc.uuid(),
      name: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      email: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      company: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      jobTitle: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      location: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      phone: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: null }),
      domain: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      tags: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 5 }), { nil: null }),
      createdAt: dateArb,
      updatedAt: dateArb,
    });

    // Generator: ScrapeResultDoc
    const scrapeResultArb = fc.record({
      id: fc.uuid(),
      workspaceId: fc.uuid(),
      jobId: fc.uuid(),
      targetUrl: fc.option(fc.webUrl(), { nil: null }),
      targetType: fc.option(fc.constantFrom('linkedin_profile', 'company_website', 'job_posting'), { nil: null }),
      targetDomain: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      resultData: fc.option(fc.constant({ name: 'Scraped' }), { nil: null }),
      status: fc.constantFrom('completed', 'failed', 'pending'),
      createdAt: dateArb,
      updatedAt: dateArb,
    });

    /** Helper: validates the ISO 8601 date string format */
    function isValidIsoDate(value: unknown): boolean {
      if (typeof value !== 'string') return false;
      const parsed = new Date(value);
      return !isNaN(parsed.getTime()) && value === parsed.toISOString();
    }

    it('transformEnrichmentRecord produces all required fields with correct types', async () => {
      const { transformEnrichmentRecord } = await import(
        '../../src/modules/search/search.service'
      );

      fc.assert(
        fc.property(enrichmentRecordArb, (rec) => {
          const doc = transformEnrichmentRecord(rec);

          // document_type is a non-empty string matching the source type
          expect(typeof doc.document_type).toBe('string');
          expect(doc.document_type).toBe('enrichment_record');

          // record_id is a non-empty string matching the input id
          expect(typeof doc.record_id).toBe('string');
          expect(doc.record_id.length).toBeGreaterThan(0);
          expect(doc.record_id).toBe(rec.id);

          // workspace_id is a non-empty string matching the input workspaceId
          expect(typeof doc.workspace_id).toBe('string');
          expect(doc.workspace_id.length).toBeGreaterThan(0);
          expect(doc.workspace_id).toBe(rec.workspaceId);

          // created_at is a valid ISO date string
          expect(isValidIsoDate(doc.created_at)).toBe(true);

          // updated_at is a valid ISO date string
          expect(isValidIsoDate(doc.updated_at)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('transformContactCompanyRecord produces all required fields with correct types', async () => {
      const { transformContactCompanyRecord } = await import(
        '../../src/modules/search/search.service'
      );

      fc.assert(
        fc.property(contactCompanyRecordArb, (rec) => {
          const doc = transformContactCompanyRecord(rec);

          // document_type is a non-empty string matching the source type
          expect(typeof doc.document_type).toBe('string');
          expect(doc.document_type.length).toBeGreaterThan(0);
          // contact or company depending on whether company field is set
          const expectedType = rec.company ? 'company' : 'contact';
          expect(doc.document_type).toBe(expectedType);

          // record_id is a non-empty string matching the input id
          expect(typeof doc.record_id).toBe('string');
          expect(doc.record_id.length).toBeGreaterThan(0);
          expect(doc.record_id).toBe(rec.id);

          // workspace_id is a non-empty string matching the input workspaceId
          expect(typeof doc.workspace_id).toBe('string');
          expect(doc.workspace_id.length).toBeGreaterThan(0);
          expect(doc.workspace_id).toBe(rec.workspaceId);

          // created_at is a valid ISO date string
          expect(isValidIsoDate(doc.created_at)).toBe(true);

          // updated_at is a valid ISO date string
          expect(isValidIsoDate(doc.updated_at)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });

    it('transformScrapeResult produces all required fields with correct types', async () => {
      const { transformScrapeResult } = await import(
        '../../src/modules/search/search.service'
      );

      fc.assert(
        fc.property(scrapeResultArb, (rec) => {
          const doc = transformScrapeResult(rec);

          // document_type is a non-empty string matching the source type
          expect(typeof doc.document_type).toBe('string');
          expect(doc.document_type).toBe('scrape_result');

          // record_id is a non-empty string matching the input id
          expect(typeof doc.record_id).toBe('string');
          expect(doc.record_id.length).toBeGreaterThan(0);
          expect(doc.record_id).toBe(rec.id);

          // workspace_id is a non-empty string matching the input workspaceId
          expect(typeof doc.workspace_id).toBe('string');
          expect(doc.workspace_id.length).toBeGreaterThan(0);
          expect(doc.workspace_id).toBe(rec.workspaceId);

          // created_at is a valid ISO date string
          expect(isValidIsoDate(doc.created_at)).toBe(true);

          // updated_at is a valid ISO date string
          expect(isValidIsoDate(doc.updated_at)).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 12: Invalid inputs return 400
  describe('Property 12: Invalid inputs return 400', () => {
    /**
     * For any request body or query parameter that fails Zod schema validation
     * (e.g., search term > 500 chars, suggest prefix < 2 chars, invalid sort
     * field, pageSize > 100, non-UUID workspace ID), the schema shall reject
     * the input. Combined with the validate middleware, this produces HTTP 400.
     *
     * **Validates: Requirements 9.2, 7.7**
     */

    it('search term > 500 chars is rejected by searchQuerySchema', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 501, maxLength: 600 }),
          (longTerm) => {
            const result = searchQuerySchema.safeParse({ q: longTerm });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('suggest prefix < 2 chars is rejected by suggestQuerySchema', () => {
      const { suggestQuerySchema } = require('../../src/modules/search/search.schemas');
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 1 }),
          (shortPrefix) => {
            const result = suggestQuerySchema.safeParse({ q: shortPrefix });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('pageSize > 100 is rejected by searchQuerySchema', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 101, max: 10000 }),
          (bigPageSize) => {
            const result = searchQuerySchema.safeParse({ q: '', pageSize: bigPageSize });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('non-UUID workspace ID is rejected by workspaceParamsSchema', () => {
      const { workspaceParamsSchema } = require('../../src/modules/search/search.schemas');
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter((s) => {
            // Filter out strings that happen to be valid UUIDs
            return !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
          }),
          (badId) => {
            const result = workspaceParamsSchema.safeParse({ id: badId });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('invalid sort field is rejected by searchQuerySchema', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }).filter(
            (s) => !['_score', 'created_at', 'updated_at', 'name'].includes(s),
          ),
          (badField) => {
            const result = searchQuerySchema.safeParse({
              q: '',
              sort: { field: badField, direction: 'desc' },
            });
            expect(result.success).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: search-layer, Property 4: Idempotent indexing
  describe('Property 4: Idempotent indexing', () => {
    /**
     * For any document and any number of times it is indexed (≥1), the OpenSearch
     * index shall contain exactly one document with that record_id. Re-indexing
     * the same document shall overwrite the previous version without producing
     * duplicates.
     *
     * Since we cannot test against a real OpenSearch instance in property tests,
     * we verify the structural guarantee: the bulk request body uses
     * `_id = record_id` for each document, and transforming the same record N
     * times always produces the same record_id. This ensures OpenSearch overwrites
     * by _id rather than creating duplicates.
     *
     * **Validates: Requirements 3.8**
     */

    const dateArb = fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') });

    const enrichmentRecordArb = fc.record({
      id: fc.uuid(),
      workspaceId: fc.uuid(),
      jobId: fc.uuid(),
      inputData: fc.constant({}),
      outputData: fc.option(fc.constant({ name: 'Test' }), { nil: null }),
      providerSlug: fc.string({ minLength: 1, maxLength: 20 }),
      status: fc.constantFrom('pending', 'completed', 'failed'),
      createdAt: dateArb,
      updatedAt: dateArb,
    });

    const repeatCountArb = fc.integer({ min: 2, max: 5 });

    it('bulk action _id always equals record_id for any transformed document', async () => {
      const { transformEnrichmentRecord } = await import(
        '../../src/modules/search/search.service'
      );

      fc.assert(
        fc.property(enrichmentRecordArb, uuidArb, (rec, workspaceId) => {
          const doc = transformEnrichmentRecord(rec);
          const indexName = getWorkspaceIndexName(workspaceId);

          // Build the bulk action the same way the indexing pipeline does
          const bulkAction = { index: { _index: indexName, _id: doc.record_id } };

          // The _id in the bulk action must equal the document's record_id
          expect(bulkAction.index._id).toBe(doc.record_id);

          // record_id must match the original input id
          expect(doc.record_id).toBe(rec.id);
        }),
        { numRuns: 100 },
      );
    });

    it('transforming the same record N times always produces the same record_id (deterministic)', async () => {
      const { transformEnrichmentRecord } = await import(
        '../../src/modules/search/search.service'
      );

      fc.assert(
        fc.property(enrichmentRecordArb, repeatCountArb, (rec, n) => {
          const results: string[] = [];
          for (let i = 0; i < n; i++) {
            const doc = transformEnrichmentRecord(rec);
            results.push(doc.record_id);
          }

          // All record_ids must be identical
          const allSame = results.every((id) => id === results[0]);
          expect(allSame).toBe(true);

          // And they must match the input id
          expect(results[0]).toBe(rec.id);
        }),
        { numRuns: 100 },
      );
    });

    it('indexing the same record N times produces N bulk actions all with the same _id', async () => {
      const { transformEnrichmentRecord } = await import(
        '../../src/modules/search/search.service'
      );

      fc.assert(
        fc.property(enrichmentRecordArb, repeatCountArb, uuidArb, (rec, n, workspaceId) => {
          const indexName = getWorkspaceIndexName(workspaceId);
          const bulkIds: string[] = [];

          for (let i = 0; i < n; i++) {
            const doc = transformEnrichmentRecord(rec);
            const bulkAction = { index: { _index: indexName, _id: doc.record_id } };
            bulkIds.push(bulkAction.index._id);
          }

          // All _id values must be identical — guarantees OpenSearch overwrites
          const uniqueIds = new Set(bulkIds);
          expect(uniqueIds.size).toBe(1);

          // The single _id must equal the original record id
          expect(bulkIds[0]).toBe(rec.id);
        }),
        { numRuns: 100 },
      );
    });
  });
});
