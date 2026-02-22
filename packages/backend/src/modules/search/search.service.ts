import { getOpenSearch } from './opensearch/client';
import {
  getWorkspaceIndexName,
  WORKSPACE_INDEX_MAPPING_V1,
} from './mappings/workspace-index.v1';
import * as searchRepo from './search.repository';
import type {
  ReindexJob,
  EnrichmentRecordDoc,
  ContactCompanyRecordDoc,
  ScrapeResultDoc,
} from './search.repository';
import { getPool } from '../../shared/db';
import { logger } from '../../shared/logger';
import { AppError } from '../../shared/errors';
import type {
  SearchQuery as SchemaSearchQuery,
  SearchResult as SchemaSearchResult,
} from './search.schemas';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Cache interface — get/set used by suggest, invalidateWorkspace used by indexing pipeline */
export interface SearchCache {
  get<T>(key: string): T | null;
  set<T>(key: string, data: T, ttlMs?: number): void;
  invalidateWorkspace(workspaceId: string): void;
}

export interface ReindexStatus {
  id: string;
  workspaceId: string;
  status: string;
  totalDocuments: number;
  indexedDocuments: number;
  failedDocuments: number;
  startedAt: Date | null;
  completedAt: Date | null;
  errorReason: string | null;
  createdAt: Date;
}

/** OpenSearch document shape matching the workspace index mapping. */
export interface SearchDocument {
  document_type: string;
  record_id: string;
  workspace_id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  job_title: string | null;
  location: string | null;
  phone: string | null;
  domain: string | null;
  provider_slug: string | null;
  enrichment_status: string | null;
  enrichment_fields: string[] | null;
  raw_data: Record<string, unknown> | null;
  tags: string[] | null;
  source_url: string | null;
  scrape_target_type: string | null;
  created_at: string;
  updated_at: string;
}

// Re-export schema types for use by consumers
export type SearchQuery = SchemaSearchQuery;

export interface SearchResponse {
  data: SchemaSearchResult[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    executionTimeMs: number;
    facets: Record<string, Array<{ value: string; count: number }>>;
  };
}

// Suggestions are returned as plain string arrays per the design doc
export interface ClusterHealth {
  status: 'green' | 'yellow' | 'red';
  numberOfNodes: number;
  activeShards: number;
  unassignedShards: number;
  clusterName: string;
}
export interface IndexInfo {
  index: string;
  health: string;
  docsCount: number;
  storageSize: string;
}

export interface SearchService {
  createWorkspaceIndex(workspaceId: string): Promise<void>;
  deleteWorkspaceIndex(workspaceId: string): Promise<void>;
  reindexWorkspace(workspaceId: string): Promise<ReindexJob>;
  getReindexStatus(workspaceId: string): Promise<ReindexStatus | null>;
  search(workspaceId: string, query: SearchQuery): Promise<SearchResponse>;
  suggest(workspaceId: string, prefix: string): Promise<string[]>;
  getClusterHealth(): Promise<ClusterHealth>;
  getIndexList(): Promise<IndexInfo[]>;
}

// ---------------------------------------------------------------------------
// Document transformation
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;

/**
 * Transforms an enrichment record from PostgreSQL into an OpenSearch document.
 */
export function transformEnrichmentRecord(rec: EnrichmentRecordDoc): SearchDocument {
  const output = rec.outputData ?? {};
  return {
    document_type: 'enrichment_record',
    record_id: rec.id,
    workspace_id: rec.workspaceId,
    name: (output.name as string) ?? null,
    email: (output.email as string) ?? null,
    company: (output.company as string) ?? null,
    job_title: (output.job_title as string) ?? (output.jobTitle as string) ?? null,
    location: (output.location as string) ?? null,
    phone: (output.phone as string) ?? null,
    domain: (output.domain as string) ?? null,
    provider_slug: rec.providerSlug,
    enrichment_status: rec.status,
    enrichment_fields: output ? Object.keys(output) : null,
    raw_data: output,
    tags: null,
    source_url: null,
    scrape_target_type: null,
    created_at: rec.createdAt.toISOString(),
    updated_at: rec.updatedAt.toISOString(),
  };
}

/**
 * Transforms a contact/company record from PostgreSQL into an OpenSearch document.
 */
export function transformContactCompanyRecord(rec: ContactCompanyRecordDoc): SearchDocument {
  return {
    document_type: rec.company ? 'company' : 'contact',
    record_id: rec.id,
    workspace_id: rec.workspaceId,
    name: rec.name,
    email: rec.email,
    company: rec.company,
    job_title: rec.jobTitle,
    location: rec.location,
    phone: rec.phone,
    domain: rec.domain,
    provider_slug: null,
    enrichment_status: null,
    enrichment_fields: null,
    raw_data: null,
    tags: rec.tags,
    source_url: null,
    scrape_target_type: null,
    created_at: rec.createdAt.toISOString(),
    updated_at: rec.updatedAt.toISOString(),
  };
}

/**
 * Transforms a scrape result from PostgreSQL into an OpenSearch document.
 */
export function transformScrapeResult(rec: ScrapeResultDoc): SearchDocument {
  const data = rec.resultData ?? {};
  return {
    document_type: 'scrape_result',
    record_id: rec.id,
    workspace_id: rec.workspaceId,
    name: (data.name as string) ?? null,
    email: (data.email as string) ?? null,
    company: (data.company as string) ?? null,
    job_title: (data.job_title as string) ?? (data.jobTitle as string) ?? null,
    location: (data.location as string) ?? null,
    phone: (data.phone as string) ?? null,
    domain: rec.targetDomain,
    provider_slug: null,
    enrichment_status: null,
    enrichment_fields: null,
    raw_data: data,
    tags: null,
    source_url: rec.targetUrl,
    scrape_target_type: rec.targetType,
    created_at: rec.createdAt.toISOString(),
    updated_at: rec.updatedAt.toISOString(),
  };
}

/**
 * Generic transform dispatcher — converts any PG record to an OpenSearch document.
 * Exported for use by the indexing pipeline.
 */
export function transformToSearchDocument(
  record: EnrichmentRecordDoc | ContactCompanyRecordDoc | ScrapeResultDoc,
  source: 'enrichment' | 'record' | 'scrape',
): SearchDocument {
  switch (source) {
    case 'enrichment':
      return transformEnrichmentRecord(record as EnrichmentRecordDoc);
    case 'record':
      return transformContactCompanyRecord(record as ContactCompanyRecordDoc);
    case 'scrape':
      return transformScrapeResult(record as ScrapeResultDoc);
  }
}

// ---------------------------------------------------------------------------
// Bulk indexing helpers
// ---------------------------------------------------------------------------

/**
 * Sends a batch of documents to OpenSearch via the bulk API.
 * Uses `_id = record_id` for idempotent upserts.
 * Returns the count of failed items in the batch.
 */
async function bulkIndex(indexName: string, docs: SearchDocument[]): Promise<number> {
  if (docs.length === 0) return 0;

  const os = getOpenSearch();
  const body: Array<Record<string, unknown>> = [];

  for (const doc of docs) {
    body.push({ index: { _index: indexName, _id: doc.record_id } });
    body.push(doc as unknown as Record<string, unknown>);
  }

  const { body: result } = await os.bulk({ body });

  if (!result.errors) return 0;

  let failedCount = 0;
  for (const item of result.items) {
    const action = item.index ?? item.create;
    if (action && action.error) {
      failedCount++;
      logger.error('Bulk index item failed', {
        index: indexName,
        recordId: action._id,
        error: JSON.stringify(action.error),
      });
    }
  }
  return failedCount;
}

/**
 * Fetches and indexes all records of a given source type in cursor-based batches.
 * Returns { indexed, failed } counts.
 */
async function indexSourceBatches(
  workspaceId: string,
  indexName: string,
  source: 'enrichment' | 'record' | 'scrape',
): Promise<{ indexed: number; failed: number }> {
  let cursor: string | null = null;
  let totalIndexed = 0;
  let totalFailed = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let batch;
    switch (source) {
      case 'enrichment':
        batch = await searchRepo.fetchEnrichmentRecordsBatch(workspaceId, cursor, BATCH_SIZE);
        break;
      case 'record':
        batch = await searchRepo.fetchContactCompanyRecordsBatch(workspaceId, cursor, BATCH_SIZE);
        break;
      case 'scrape':
        batch = await searchRepo.fetchScrapeResultsBatch(workspaceId, cursor, BATCH_SIZE);
        break;
    }

    if (batch.records.length === 0) break;

    const docs = batch.records.map((rec) => transformToSearchDocument(rec, source));

    try {
      const failed = await bulkIndex(indexName, docs);
      totalIndexed += docs.length - failed;
      totalFailed += failed;
    } catch (err) {
      // Partial failure: log and continue with remaining batches (Req 4.5)
      logger.error('Bulk index batch failed', {
        workspaceId,
        source,
        batchSize: docs.length,
        error: err instanceof Error ? err.message : String(err),
      });
      totalFailed += docs.length;
    }

    cursor = batch.nextCursor;
    if (!cursor) break;
  }

  return { indexed: totalIndexed, failed: totalFailed };
}

// ---------------------------------------------------------------------------
// Search query helpers
// ---------------------------------------------------------------------------

/** Fields allowed in `field:value` search syntax. */
const SEARCHABLE_FIELDS = ['name', 'email', 'company', 'job_title', 'location', 'domain'];

/** Default fields for multi-match queries. */
const MULTI_MATCH_FIELDS = ['name', 'email', 'company', 'job_title', 'location'];

/** Keyword filter fields (use `terms` filter). */
const KEYWORD_FILTER_FIELDS = ['document_type', 'provider_slug', 'enrichment_status', 'scrape_target_type', 'tags'];

/** Date range filter fields (use `range` filter). */
const DATE_FILTER_FIELDS = ['created_at', 'updated_at'];

/** Default facet fields. */
const FACET_FIELDS = ['document_type', 'provider_slug', 'enrichment_status', 'scrape_target_type', 'tags'];

/** Max deep pagination window. */
const MAX_RESULT_WINDOW = 10_000;

/**
 * Escapes OpenSearch special characters in user search terms to prevent query injection.
 * Characters: + - = && || > < ! ( ) { } [ ] ^ " ~ * ? : \ /
 */
function escapeSearchTerm(term: string): string {
  return term.replace(/[+\-=&|><!(){}\[\]^"~*?:\\/]/g, '\\$&');
}

/**
 * Parses `field:value` syntax from a search term.
 * Returns { field, value } if the field is in the allowlist, otherwise null.
 */
function parseFieldQuery(q: string): { field: string; value: string } | null {
  const match = q.match(/^(\w+):(.+)$/);
  if (!match) return null;
  const [, field, value] = match;
  if (!SEARCHABLE_FIELDS.includes(field)) return null;
  return { field, value: value.trim() };
}

/**
 * Builds the `query` portion of the OpenSearch request body.
 */
function buildSearchQuery(
  workspaceId: string,
  q: string,
  filters: SearchQuery['filters'],
  fuzziness: string,
): Record<string, unknown> {
  const must: Array<Record<string, unknown>> = [];
  const filterClauses: Array<Record<string, unknown>> = [];

  // Mandatory workspace scoping
  filterClauses.push({ term: { workspace_id: workspaceId } });

  // Build the main query clause
  if (q && q.trim().length > 0) {
    const fieldQuery = parseFieldQuery(q.trim());
    if (fieldQuery) {
      must.push({
        match: { [fieldQuery.field]: { query: escapeSearchTerm(fieldQuery.value), fuzziness } },
      });
    } else {
      must.push({
        multi_match: {
          query: escapeSearchTerm(q.trim()),
          fields: MULTI_MATCH_FIELDS,
          fuzziness,
          type: 'best_fields',
        },
      });
    }
  }

  // Keyword filters
  if (filters) {
    for (const field of KEYWORD_FILTER_FIELDS) {
      const values = (filters as Record<string, unknown>)[field];
      if (Array.isArray(values) && values.length > 0) {
        filterClauses.push({ terms: { [field]: values } });
      }
    }

    // Date range filters
    for (const field of DATE_FILTER_FIELDS) {
      const range = (filters as Record<string, unknown>)[field] as
        | { gte?: string; lte?: string }
        | undefined;
      if (range && (range.gte || range.lte)) {
        const rangeClause: Record<string, string> = {};
        if (range.gte) rangeClause.gte = range.gte;
        if (range.lte) rangeClause.lte = range.lte;
        filterClauses.push({ range: { [field]: rangeClause } });
      }
    }
  }

  return {
    bool: {
      ...(must.length > 0 ? { must } : { must: [{ match_all: {} }] }),
      filter: filterClauses,
    },
  };
}

/**
 * Builds sort configuration for the OpenSearch query.
 */
function buildSort(sort: SearchQuery['sort']): Array<Record<string, unknown>> {
  if (!sort) return [{ _score: { order: 'desc' } }];

  const { field, direction } = sort;

  if (field === '_score') {
    return [{ _score: { order: direction } }];
  }

  // For `name`, sort on the keyword sub-field
  const sortField = field === 'name' ? 'name.keyword' : field;
  return [{ [sortField]: { order: direction } }];
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function createSearchService(cache: SearchCache): SearchService {
  return {
    /**
     * Creates a workspace OpenSearch index with the v1 mapping.
     * Ignores 400 (index already exists).
     * Req 2.1
     */
    async createWorkspaceIndex(workspaceId: string): Promise<void> {
      const os = getOpenSearch();
      const indexName = getWorkspaceIndexName(workspaceId);

      try {
        await os.indices.create({
          index: indexName,
          body: WORKSPACE_INDEX_MAPPING_V1 as Record<string, unknown>,
        });
        logger.info('Created workspace index', { workspaceId, indexName });
      } catch (err: unknown) {
        // Ignore 400 — index already exists
        if (isOpenSearchError(err, 400)) {
          logger.info('Workspace index already exists', { workspaceId, indexName });
          return;
        }
        throw err;
      }
    },

    /**
     * Deletes a workspace OpenSearch index.
     * Ignores 404 (index doesn't exist).
     * Req 2.5
     */
    async deleteWorkspaceIndex(workspaceId: string): Promise<void> {
      const os = getOpenSearch();
      const indexName = getWorkspaceIndexName(workspaceId);

      try {
        await os.indices.delete({ index: indexName });
        logger.info('Deleted workspace index', { workspaceId, indexName });
      } catch (err: unknown) {
        // Ignore 404 — index doesn't exist
        if (isOpenSearchError(err, 404)) {
          logger.info('Workspace index does not exist, nothing to delete', { workspaceId, indexName });
          return;
        }
        throw err;
      }
    },

    /**
     * Performs a full reindex of a workspace:
     *  1. Acquires a PostgreSQL advisory lock to prevent concurrent reindex
     *  2. Creates a reindex job row
     *  3. Deletes and recreates the workspace index
     *  4. Reads records in cursor-based batches of 500 from all three sources
     *  5. Bulk indexes each batch, updating progress
     *  6. Handles partial failures (log and continue)
     *  7. Updates final job status
     *
     * Req 2.6, 4.1–4.7
     */
    async reindexWorkspace(workspaceId: string): Promise<ReindexJob> {
      const client = await getPool().connect();
      let job: ReindexJob | null = null;

      try {
        await client.query('BEGIN');

        // Acquire advisory lock — prevents concurrent reindex for same workspace (Req 4.7)
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('reindex:' || $1))`,
          [workspaceId],
        );

        // Create reindex job
        job = await searchRepo.createReindexJob(workspaceId, client);

        // Mark as running
        job = (await searchRepo.updateReindexProgress(
          job.id,
          { status: 'running', startedAt: new Date() },
          client,
        ))!;

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // From here on, we operate outside the advisory lock transaction.
      // The lock was only needed to prevent concurrent job creation.
      const startTime = Date.now();
      const indexName = getWorkspaceIndexName(workspaceId);

      try {
        // Delete and recreate the index with latest mapping (Req 2.6)
        await this.deleteWorkspaceIndex(workspaceId);
        await this.createWorkspaceIndex(workspaceId);

        // Index all three sources in cursor-based batches (Req 4.1, 4.2, 4.4)
        const enrichmentResult = await indexSourceBatches(workspaceId, indexName, 'enrichment');
        const recordResult = await indexSourceBatches(workspaceId, indexName, 'record');
        const scrapeResult = await indexSourceBatches(workspaceId, indexName, 'scrape');

        const totalIndexed =
          enrichmentResult.indexed + recordResult.indexed + scrapeResult.indexed;
        const totalFailed =
          enrichmentResult.failed + recordResult.failed + scrapeResult.failed;
        const totalDocuments = totalIndexed + totalFailed;

        const elapsedMs = Date.now() - startTime;

        // Determine final status
        const finalStatus = totalFailed > 0 && totalIndexed === 0 ? 'failed' : 'completed';

        // Update job with final progress (Req 4.3, 4.6)
        job = (await searchRepo.updateReindexProgress(job!.id, {
          status: finalStatus,
          totalDocuments,
          indexedDocuments: totalIndexed,
          failedDocuments: totalFailed,
          completedAt: new Date(),
          errorReason: totalFailed > 0 ? `${totalFailed} documents failed to index` : null,
        }))!;

        // Update index status
        await searchRepo.upsertIndexStatus(workspaceId, {
          lastIndexedAt: new Date(),
          documentCount: totalIndexed,
          status: 'active',
          errorReason: null,
        });

        // Invalidate suggestion cache for this workspace
        cache.invalidateWorkspace(workspaceId);

        logger.info('Reindex completed', {
          workspaceId,
          totalDocuments,
          totalIndexed,
          totalFailed,
          elapsedMs,
        });
      } catch (err) {
        // Catastrophic failure — mark job as failed
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (job) {
          await searchRepo.updateReindexProgress(job.id, {
            status: 'failed',
            completedAt: new Date(),
            errorReason: errorMessage,
          }).catch((updateErr) => {
            logger.error('Failed to update reindex job status after error', {
              jobId: job!.id,
              error: updateErr instanceof Error ? updateErr.message : String(updateErr),
            });
          });
        }

        await searchRepo.upsertIndexStatus(workspaceId, {
          status: 'error',
          errorReason: errorMessage,
        }).catch((updateErr) => {
          logger.error('Failed to update index status after error', {
            workspaceId,
            error: updateErr instanceof Error ? updateErr.message : String(updateErr),
          });
        });

        throw err;
      }

      return job;
    },

    /**
     * Returns the latest reindex job status for a workspace.
     * Req 4.3
     */
    async getReindexStatus(workspaceId: string): Promise<ReindexStatus | null> {
      const job = await searchRepo.getLatestReindexJob(workspaceId);
      if (!job) return null;

      return {
        id: job.id,
        workspaceId: job.workspaceId,
        status: job.status,
        totalDocuments: job.totalDocuments,
        indexedDocuments: job.indexedDocuments,
        failedDocuments: job.failedDocuments,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        errorReason: job.errorReason,
        createdAt: job.createdAt,
      };
    },

    /**
     * Executes a full-text search against the workspace OpenSearch index.
     *
     * - Parses `field:value` syntax for field-specific search
     * - Multi-match across name, email, company, job_title, location with fuzziness
     * - Applies keyword term filters and date range filters
     * - Mandatory workspace_id scoping
     * - Highlights with <mark> tags, fragment size 150
     * - Terms aggregations for facets
     * - Pagination with max window guard (10,000)
     * - 10s query timeout; 408 on timeout, 503 on unreachable
     * - Escapes user search terms to prevent query injection
     *
     * Req 5.1–5.10, 6.1–6.5, 9.3–9.7, 15.1, 15.6
     */
    async search(workspaceId: string, query: SearchQuery): Promise<SearchResponse> {
      const { q, filters, facets, page, pageSize, sort, fuzziness } = query;

      // Validate pagination window (Req 15.6)
      if (page * pageSize > MAX_RESULT_WINDOW) {
        throw new AppError(400, 'VALIDATION_ERROR', `Result window too large: page * pageSize must not exceed ${MAX_RESULT_WINDOW}`);
      }

      const indexName = getWorkspaceIndexName(workspaceId);
      const from = (page - 1) * pageSize;

      // Build query body
      const queryClause = buildSearchQuery(workspaceId, q, filters, fuzziness);
      const sortClause = buildSort(sort);

      // Highlight configuration (Req 5.6)
      const highlight: Record<string, unknown> = {
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
        fragment_size: 150,
        fields: {
          name: {},
          email: {},
          company: {},
          job_title: {},
          location: {},
        },
      };

      // Aggregations for facets (Req 6.1, 6.5)
      const aggs: Record<string, unknown> = {};
      const facetFields = facets && facets.length > 0 ? facets : FACET_FIELDS;
      for (const field of facetFields) {
        aggs[field] = { terms: { field, size: 20, min_doc_count: 1 } };
      }

      const body: Record<string, unknown> = {
        query: queryClause,
        highlight,
        aggs,
        from,
        size: pageSize,
        sort: sortClause,
        timeout: '10s',
      };

      const startTime = Date.now();

      let response: Record<string, unknown>;
      try {
        const os = getOpenSearch();
        const result = await os.search({ index: indexName, body });
        response = result.body as Record<string, unknown>;
      } catch (err: unknown) {
        // Timeout detection (Req 9.7)
        if (isTimeoutError(err)) {
          throw new AppError(408, 'SEARCH_TIMEOUT', 'Search query timed out');
        }
        // Unreachable detection (Req 9.3)
        if (isConnectionError(err)) {
          throw new AppError(503, 'SEARCH_UNAVAILABLE', 'Search service temporarily unavailable');
        }
        throw err;
      }

      const executionTimeMs = Date.now() - startTime;

      // Check for timed_out flag in response
      if (response.timed_out === true) {
        throw new AppError(408, 'SEARCH_TIMEOUT', 'Search query timed out');
      }

      // Extract hits
      const hits = response.hits as Record<string, unknown>;
      const totalObj = hits.total as { value: number } | number;
      const total = typeof totalObj === 'number' ? totalObj : totalObj.value;
      const hitArray = (hits.hits ?? []) as Array<Record<string, unknown>>;

      // Map to SearchResult objects
      const data: SchemaSearchResult[] = hitArray.map((hit) => {
        const source = hit._source as Record<string, unknown>;
        const hitHighlight = (hit.highlight ?? {}) as Record<string, string[]>;

        return {
          record_id: source.record_id as string,
          document_type: source.document_type as string,
          workspace_id: source.workspace_id as string,
          name: (source.name as string) ?? null,
          email: (source.email as string) ?? null,
          company: (source.company as string) ?? null,
          job_title: (source.job_title as string) ?? null,
          location: (source.location as string) ?? null,
          phone: (source.phone as string) ?? null,
          domain: (source.domain as string) ?? null,
          provider_slug: (source.provider_slug as string) ?? null,
          enrichment_status: (source.enrichment_status as string) ?? null,
          tags: (source.tags as string[]) ?? null,
          source_url: (source.source_url as string) ?? null,
          scrape_target_type: (source.scrape_target_type as string) ?? null,
          created_at: source.created_at as string,
          updated_at: source.updated_at as string,
          score: (hit._score as number) ?? 0,
          highlights: Object.keys(hitHighlight).length > 0 ? hitHighlight : undefined,
        };
      });

      // Map aggregations to facet buckets (Req 6.3, 6.4)
      const responseFacets: Record<string, Array<{ value: string; count: number }>> = {};
      const aggregations = (response.aggregations ?? {}) as Record<string, Record<string, unknown>>;
      for (const field of facetFields) {
        const agg = aggregations[field];
        if (agg && Array.isArray(agg.buckets)) {
          responseFacets[field] = (agg.buckets as Array<{ key: string; doc_count: number }>)
            .filter((b) => b.doc_count > 0)
            .map((b) => ({ value: b.key, count: b.doc_count }));
        } else {
          responseFacets[field] = [];
        }
      }

      const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;

      return {
        data,
        meta: {
          total,
          page,
          pageSize,
          totalPages,
          executionTimeMs,
          facets: responseFacets,
        },
      };
    },

    /**
     * Returns up to 10 autocomplete suggestions for a prefix, scoped to a workspace.
     *
     * - Checks LRU cache first (key: search:{workspaceId}:suggest:{prefix}, TTL 30s)
     * - Queries name, company, job_title fields via multi_match (edge_ngram at index time)
     * - Deduplicates case-insensitively, sorts by document frequency descending
     * - Returns max 10 suggestions
     *
     * Req 7.1–7.6, 15.2, 15.3
     */
    async suggest(workspaceId: string, prefix: string): Promise<string[]> {
      const SUGGEST_CACHE_TTL_MS = 30_000;
      const cacheKey = `search:${workspaceId}:suggest:${prefix}`;

      // 1. Check cache
      const cached = cache.get<string[]>(cacheKey);
      if (cached) return cached;

      // 2. Build OpenSearch query
      const indexName = getWorkspaceIndexName(workspaceId);
      const body: Record<string, unknown> = {
        query: {
          bool: {
            must: [
              {
                multi_match: {
                  query: prefix,
                  fields: ['name', 'company', 'job_title'],
                  type: 'best_fields',
                },
              },
            ],
            filter: [{ term: { workspace_id: workspaceId } }],
          },
        },
        _source: ['name', 'company', 'job_title'],
        size: 50,
      };

      // 3. Execute query
      let response: Record<string, unknown>;
      try {
        const os = getOpenSearch();
        const result = await os.search({ index: indexName, body });
        response = result.body as Record<string, unknown>;
      } catch (err: unknown) {
        if (isTimeoutError(err)) {
          throw new AppError(408, 'SEARCH_TIMEOUT', 'Search query timed out');
        }
        if (isConnectionError(err)) {
          throw new AppError(503, 'SEARCH_UNAVAILABLE', 'Search service temporarily unavailable');
        }
        throw err;
      }

      // 4. Extract suggestion values from name, company, job_title
      const hits = response.hits as Record<string, unknown>;
      const hitArray = (hits.hits ?? []) as Array<Record<string, unknown>>;

      // Count occurrences for frequency-based sorting (case-insensitive)
      const freqMap = new Map<string, { canonical: string; count: number }>();

      for (const hit of hitArray) {
        const source = hit._source as Record<string, unknown>;
        const values = [source.name, source.company, source.job_title];

        for (const val of values) {
          if (typeof val === 'string' && val.trim().length > 0) {
            const lower = val.trim().toLowerCase();
            const existing = freqMap.get(lower);
            if (existing) {
              existing.count++;
            } else {
              freqMap.set(lower, { canonical: val.trim(), count: 1 });
            }
          }
        }
      }

      // 5. Sort by frequency descending, take max 10
      const suggestions = Array.from(freqMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
        .map((entry) => entry.canonical);

      // 6. Cache result
      cache.set(cacheKey, suggestions, SUGGEST_CACHE_TTL_MS);

      return suggestions;
    },

    async getClusterHealth(): Promise<ClusterHealth> {
      const os = getOpenSearch();

      try {
        const { body } = await os.cluster.health();

        return {
          status: body.status as 'green' | 'yellow' | 'red',
          numberOfNodes: body.number_of_nodes,
          activeShards: body.active_primary_shards,
          unassignedShards: body.unassigned_shards,
          clusterName: body.cluster_name,
        };
      } catch (err: unknown) {
        if (isConnectionError(err)) {
          throw new AppError(503, 'SEARCH_UNAVAILABLE', 'Search service temporarily unavailable');
        }
        throw err;
      }
    },

    async getIndexList(): Promise<IndexInfo[]> {
      const os = getOpenSearch();

      try {
        const { body } = await os.cat.indices({
          index: 'morket-workspace-*',
          format: 'json',
          h: 'index,health,docs.count,store.size',
        });

        if (!Array.isArray(body)) return [];

        return body.map((entry: Record<string, string>) => ({
          index: entry.index ?? '',
          health: entry.health ?? 'unknown',
          docsCount: parseInt(entry['docs.count'] ?? '0', 10) || 0,
          storageSize: entry['store.size'] ?? '0b',
        }));
      } catch (err: unknown) {
        if (isConnectionError(err)) {
          throw new AppError(503, 'SEARCH_UNAVAILABLE', 'Search service temporarily unavailable');
        }
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks if an error from the OpenSearch client has a specific HTTP status code.
 */
function isOpenSearchError(err: unknown, statusCode: number): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    // @opensearch-project/opensearch wraps errors with a `statusCode` or `meta.statusCode`
    if (e.statusCode === statusCode) return true;
    if (
      e.meta &&
      typeof e.meta === 'object' &&
      (e.meta as Record<string, unknown>).statusCode === statusCode
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an error is a timeout error from the OpenSearch client.
 */
function isTimeoutError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const name = (e.name as string) ?? '';
    const message = (e.message as string) ?? '';
    if (name === 'TimeoutError' || name === 'RequestAbortedError') return true;
    if (message.includes('timeout') || message.includes('Timeout') || message.includes('ETIMEDOUT')) return true;
    if (isOpenSearchError(err, 408)) return true;
  }
  return false;
}

/**
 * Checks if an error is a connection error (OpenSearch unreachable).
 */
function isConnectionError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const name = (e.name as string) ?? '';
    const message = (e.message as string) ?? '';
    if (name === 'ConnectionError' || name === 'NoLivingConnectionsError') return true;
    if (message.includes('ECONNREFUSED') || message.includes('ECONNRESET') || message.includes('ENOTFOUND')) return true;
    if (isOpenSearchError(err, 503)) return true;
  }
  return false;
}
