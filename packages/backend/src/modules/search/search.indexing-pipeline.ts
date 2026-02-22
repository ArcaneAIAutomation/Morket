import { Client } from 'pg';
import { env } from '../../config/env';
import { logger } from '../../shared/logger';
import { getOpenSearch } from './opensearch/client';
import { getWorkspaceIndexName } from './mappings/workspace-index.v1';
import * as searchRepo from './search.repository';
import {
  transformToSearchDocument,
  type SearchCache,
} from './search.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexingPipelineConfig {
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  retryBackoffMs: number[];
}

export interface IndexingPipelineDeps {
  searchCache?: SearchCache;
}

export interface IndexingStats {
  bufferedEvents: number;
  totalFlushed: number;
  totalFailed: number;
  lastFlushAt: Date | null;
}

export interface SearchIndexingPipeline {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStats(): IndexingStats;
  _handleNotification(channel: string, payload: string | undefined): void;
  _flushAll(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CHANNELS = [
  'search_index_enrichment',
  'search_index_records',
  'search_index_scrape',
] as const;

export type Channel = (typeof CHANNELS)[number];

interface BufferedEvent {
  channel: Channel;
  recordId: string;
  workspaceId: string;
  op: string;
  payload: Record<string, unknown>;
  receivedAt: number;
}

const DEFAULT_CONFIG: IndexingPipelineConfig = {
  batchSize: 50,
  flushIntervalMs: 3_000,
  maxRetries: 3,
  retryBackoffMs: [1000, 2000, 4000],
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a search indexing pipeline that listens for PG NOTIFY events
 * on search channels, buffers them, and bulk-indexes into OpenSearch.
 *
 * Follows the same pattern as `createReplicationService()`:
 * - Dedicated `pg.Client` for LISTEN (not from pool)
 * - Per-channel event buffers
 * - Flush on batch size threshold or interval timer
 * - Retry with exponential backoff
 * - Graceful shutdown: flush remaining buffer, close PG connection
 */
export function createSearchIndexingPipeline(
  config: Partial<IndexingPipelineConfig> = {},
  deps: IndexingPipelineDeps = {},
): SearchIndexingPipeline {
  const cfg: IndexingPipelineConfig = { ...DEFAULT_CONFIG, ...config };

  // State
  let pgClient: Client | null = null;
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let flushing = false;

  // Per-channel event buffers
  const buffers: Record<Channel, BufferedEvent[]> = {
    search_index_enrichment: [],
    search_index_records: [],
    search_index_scrape: [],
  };

  // Stats
  const stats: IndexingStats = {
    bufferedEvents: 0,
    totalFlushed: 0,
    totalFailed: 0,
    lastFlushAt: null,
  };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function totalBuffered(): number {
    return (
      buffers.search_index_enrichment.length +
      buffers.search_index_records.length +
      buffers.search_index_scrape.length
    );
  }

  /** Parse a NOTIFY payload and buffer the event. */
  function handleNotification(channel: string, payload: string | undefined): void {
    if (!payload) return;

    const ch = channel as Channel;
    if (!CHANNELS.includes(ch)) {
      logger.warn('SearchIndexingPipeline: unknown channel', { channel });
      return;
    }

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;

      // Extract identifiers based on channel
      const recordId =
        ch === 'search_index_scrape'
          ? String(parsed.task_id ?? '')
          : String(parsed.record_id ?? '');
      const workspaceId = String(parsed.workspace_id ?? '');
      const op = String(parsed.op ?? 'INSERT');

      buffers[ch].push({
        channel: ch,
        recordId,
        workspaceId,
        op,
        payload: parsed,
        receivedAt: Date.now(),
      });

      stats.bufferedEvents = totalBuffered();

      // Check if batch size threshold reached
      if (totalBuffered() >= cfg.batchSize) {
        void flushAll();
      }
    } catch (err) {
      logger.error('SearchIndexingPipeline: failed to parse NOTIFY payload', {
        channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Flush logic
  // ---------------------------------------------------------------------------

  async function flushAll(): Promise<void> {
    if (flushing) return;
    flushing = true;

    try {
      for (const channel of CHANNELS) {
        const events = buffers[channel].splice(0);
        if (events.length === 0) continue;

        await flushChannel(channel, events);
      }

      stats.bufferedEvents = totalBuffered();
      stats.lastFlushAt = new Date();
    } catch (err) {
      logger.error('SearchIndexingPipeline: flush error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      flushing = false;
    }
  }

  /** Flush events for a single channel. */
  async function flushChannel(channel: Channel, events: BufferedEvent[]): Promise<void> {
    // Group by workspace_id
    const byWorkspace = new Map<string, BufferedEvent[]>();
    for (const event of events) {
      const existing = byWorkspace.get(event.workspaceId);
      if (existing) {
        existing.push(event);
      } else {
        byWorkspace.set(event.workspaceId, [event]);
      }
    }

    const affectedWorkspaceIds = new Set<string>();

    for (const [workspaceId, wsEvents] of byWorkspace) {
      const indexName = getWorkspaceIndexName(workspaceId);

      // Separate DELETE operations from INSERT/UPDATE
      const deleteEvents = wsEvents.filter((e) => e.op === 'DELETE');
      const upsertEvents = wsEvents.filter((e) => e.op !== 'DELETE');

      // Build bulk body
      const bulkBody: Array<Record<string, unknown>> = [];

      // Handle DELETE operations
      for (const event of deleteEvents) {
        bulkBody.push({ delete: { _index: indexName, _id: event.recordId } });
      }

      // Handle INSERT/UPDATE operations — fetch full documents from PG
      for (const event of upsertEvents) {
        const doc = await fetchAndTransform(channel, event);
        if (doc) {
          bulkBody.push({ index: { _index: indexName, _id: doc.record_id } });
          bulkBody.push(doc as unknown as Record<string, unknown>);
        }
      }

      if (bulkBody.length === 0) continue;

      // Send bulk request with retry
      const success = await bulkWithRetry(bulkBody);
      if (success) {
        stats.totalFlushed += deleteEvents.length + upsertEvents.length;
        affectedWorkspaceIds.add(workspaceId);
      } else {
        stats.totalFailed += deleteEvents.length + upsertEvents.length;
      }
    }

    // Invalidate suggestion cache for affected workspaces
    if (deps.searchCache) {
      for (const wsId of affectedWorkspaceIds) {
        deps.searchCache.invalidateWorkspace(wsId);
      }
    }
  }

  /** Fetch a full document from PG and transform to OpenSearch document. */
  async function fetchAndTransform(
    channel: Channel,
    event: BufferedEvent,
  ): Promise<Record<string, unknown> | null> {
    try {
      switch (channel) {
        case 'search_index_enrichment': {
          const rec = await searchRepo.fetchEnrichmentRecord(event.recordId);
          if (!rec) return null;
          return transformToSearchDocument(rec, 'enrichment') as unknown as Record<string, unknown>;
        }
        case 'search_index_records': {
          const rec = await searchRepo.fetchContactCompanyRecord(event.recordId);
          if (!rec) return null;
          return transformToSearchDocument(rec, 'record') as unknown as Record<string, unknown>;
        }
        case 'search_index_scrape': {
          const rec = await searchRepo.fetchScrapeResult(event.recordId, event.workspaceId);
          if (!rec) return null;
          return transformToSearchDocument(rec, 'scrape') as unknown as Record<string, unknown>;
        }
      }
    } catch (err) {
      logger.error('SearchIndexingPipeline: failed to fetch document from PG', {
        channel,
        recordId: event.recordId,
        workspaceId: event.workspaceId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Send a bulk request to OpenSearch with retry logic.
   * Retries up to maxRetries times with exponential backoff.
   * Returns true on success, false on exhaustion.
   */
  async function bulkWithRetry(bulkBody: Array<Record<string, unknown>>): Promise<boolean> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
      try {
        const os = getOpenSearch();
        const { body: result } = await os.bulk({ body: bulkBody });

        if (result.errors) {
          // Log individual item failures but consider the bulk request successful
          for (const item of result.items) {
            const action = item.index ?? item.delete ?? item.create;
            if (action && action.error) {
              logger.error('SearchIndexingPipeline: bulk item failed', {
                id: action._id,
                error: JSON.stringify(action.error),
              });
            }
          }
        }

        return true;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn('SearchIndexingPipeline: bulk request failed, retrying', {
          attempt: attempt + 1,
          maxRetries: cfg.maxRetries,
          error: lastError.message,
        });

        if (attempt < cfg.maxRetries - 1) {
          const backoff = cfg.retryBackoffMs[attempt] ?? 4000;
          await sleep(backoff);
        }
      }
    }

    // All retries exhausted — log failed documents
    logger.error('SearchIndexingPipeline: bulk request failed after all retries', {
      maxRetries: cfg.maxRetries,
      error: lastError?.message,
    });

    return false;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async function start(): Promise<void> {
    if (running) return;

    logger.info('SearchIndexingPipeline: starting');

    // Open dedicated PG connection for LISTEN (not from pool)
    pgClient = new Client({ connectionString: env.DATABASE_URL });
    await pgClient.connect();

    // Subscribe to channels
    for (const channel of CHANNELS) {
      await pgClient.query(`LISTEN ${channel}`);
    }

    // Handle notifications
    pgClient.on('notification', (msg) => {
      handleNotification(msg.channel, msg.payload);
    });

    // Handle connection errors
    pgClient.on('error', (err) => {
      logger.error('SearchIndexingPipeline: PG LISTEN connection error', {
        error: err.message,
      });
    });

    // Start flush interval timer
    flushTimer = setInterval(() => {
      if (totalBuffered() > 0) {
        void flushAll();
      }
    }, cfg.flushIntervalMs);

    running = true;
    logger.info('SearchIndexingPipeline: started, listening on channels', {
      channels: [...CHANNELS],
      batchSize: cfg.batchSize,
      flushIntervalMs: cfg.flushIntervalMs,
    });
  }

  async function stop(): Promise<void> {
    if (!running) return;

    logger.info('SearchIndexingPipeline: stopping');
    running = false;

    // Stop flush timer
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }

    // Flush remaining buffered events
    if (totalBuffered() > 0) {
      logger.info('SearchIndexingPipeline: flushing remaining buffer on shutdown', {
        buffered: totalBuffered(),
      });
      await flushAll();
    }

    // Close dedicated PG connection
    if (pgClient) {
      try {
        await pgClient.end();
      } catch (err) {
        logger.error('SearchIndexingPipeline: error closing PG LISTEN connection', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      pgClient = null;
    }

    logger.info('SearchIndexingPipeline: stopped', {
      totalFlushed: stats.totalFlushed,
      totalFailed: stats.totalFailed,
    });
  }

  function getStats(): IndexingStats {
    return {
      ...stats,
      bufferedEvents: totalBuffered(),
    };
  }

  // Expose internals for testing
  return {
    start,
    stop,
    getStats,
    _handleNotification: handleNotification,
    _flushAll: flushAll,
  };
}

export type SearchIndexingPipelineInstance = ReturnType<typeof createSearchIndexingPipeline>;

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
