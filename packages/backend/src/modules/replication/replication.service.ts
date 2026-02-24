import { Client } from 'pg';
import { env } from '../../config/env';
import { logger } from '../../shared/logger';
import { getClickHouse } from '../../clickhouse/client';
import {
  fetchEnrichmentEvents,
  fetchCreditEvents,
  fetchScrapeEvents,
  type EnrichmentEventRow,
  type CreditEventRow,
  type ScrapeEventRow,
} from './replication.queries';

// These modules will be created in Tasks 4 and 5 respectively.
// Import their interfaces and use them when available.
import type { AnalyticsCache } from '../analytics/analytics.cache';
import type { DLQRepository } from './dlq.repository';

/** Channels the replication service listens on. */
export const CHANNELS = ['enrichment_events', 'scrape_events', 'credit_events'] as const;
export type Channel = (typeof CHANNELS)[number];

/** Buffered event from a PG NOTIFY payload. */
export interface BufferedEvent {
  channel: Channel;
  id: string;
  payload: Record<string, unknown>;
  receivedAt: number;
}

export interface ReplicationConfig {
  batchSize: number;
  flushIntervalMs: number;
  maxRetries: number;
  retryBackoffMs: number[];
}

export interface ReplicationStats {
  bufferedEvents: number;
  totalFlushed: number;
  totalFailed: number;
  lastFlushAt: Date | null;
  dlqPending: number;
}

export interface ReplicationDeps {
  dlqRepository?: DLQRepository;
  analyticsCache?: AnalyticsCache;
}

const DEFAULT_CONFIG: ReplicationConfig = {
  batchSize: 100,
  flushIntervalMs: 5_000,
  maxRetries: 3,
  retryBackoffMs: [1000, 2000, 4000],
};

/**
 * Creates and returns a replication service instance.
 *
 * The service opens a dedicated PG connection (not from pool) for LISTEN,
 * buffers incoming NOTIFY events, and flushes them to ClickHouse in batches.
 */
export function createReplicationService(
  config: Partial<ReplicationConfig> = {},
  deps: ReplicationDeps = {},
) {
  const cfg: ReplicationConfig = { ...DEFAULT_CONFIG, ...config };

  // State
  let pgClient: Client | null = null;
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  let dlqReplayTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let flushing = false;

  // Per-channel event buffers
  const buffers: Record<Channel, BufferedEvent[]> = {
    enrichment_events: [],
    scrape_events: [],
    credit_events: [],
  };

  // Stats
  const stats: ReplicationStats = {
    bufferedEvents: 0,
    totalFlushed: 0,
    totalFailed: 0,
    lastFlushAt: null,
    dlqPending: 0,
  };

  /** Total buffered events across all channels. */
  function totalBuffered(): number {
    return buffers.enrichment_events.length +
      buffers.scrape_events.length +
      buffers.credit_events.length;
  }

  /** Parse a NOTIFY payload and buffer the event. */
  function handleNotification(channel: string, payload: string | undefined): void {
    if (!payload) return;

    const ch = channel as Channel;
    if (!CHANNELS.includes(ch)) {
      logger.warn('Replication: unknown channel', { channel });
      return;
    }

    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const id = extractId(ch, parsed);

      buffers[ch].push({
        channel: ch,
        id,
        payload: parsed,
        receivedAt: Date.now(),
      });

      stats.bufferedEvents = totalBuffered();

      // Check if batch size threshold reached
      if (totalBuffered() >= cfg.batchSize) {
        void flushAll();
      }
    } catch (err) {
      logger.error('Replication: failed to parse NOTIFY payload', {
        channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Extract the primary identifier from a NOTIFY payload based on channel. */
  function extractId(channel: Channel, payload: Record<string, unknown>): string {
    switch (channel) {
      case 'enrichment_events':
        return String(payload.record_id ?? '');
      case 'credit_events':
        return String(payload.transaction_id ?? '');
      case 'scrape_events':
        return String(payload.task_id ?? '');
    }
  }

  /**
   * Flush all buffered events to ClickHouse.
   * Groups by channel, fetches denormalized data from PG, and batch inserts.
   */
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
      logger.error('Replication: flush error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      flushing = false;
    }
  }

  /** Flush events for a single channel. */
  async function flushChannel(channel: Channel, events: BufferedEvent[]): Promise<void> {
    const ids = events.map((e) => e.id);

    try {
      // Fetch denormalized data from PostgreSQL
      const rows = await fetchDenormalizedData(channel, ids);

      if (rows.length === 0) {
        logger.warn('Replication: no rows returned from PG for channel', {
          channel,
          idCount: ids.length,
        });
        return;
      }

      // Insert into ClickHouse with retry
      await insertWithRetry(channel, rows as unknown as Record<string, unknown>[]);

      stats.totalFlushed += rows.length;

      // Invalidate analytics cache for affected workspaces
      invalidateCacheForRows(channel, rows as unknown as Record<string, unknown>[]);
    } catch (err) {
      stats.totalFailed += events.length;

      // Write to DLQ
      await writeToDLQ(channel, events, err);
    }
  }

  /** Fetch denormalized event data from PostgreSQL based on channel. */
  async function fetchDenormalizedData(
    channel: Channel,
    ids: string[],
  ): Promise<EnrichmentEventRow[] | CreditEventRow[] | ScrapeEventRow[]> {
    switch (channel) {
      case 'enrichment_events':
        return fetchEnrichmentEvents(ids);
      case 'credit_events':
        return fetchCreditEvents(ids);
      case 'scrape_events':
        return fetchScrapeEvents(ids);
    }
  }

  /** Map channel to ClickHouse table name. */
  function getTableName(channel: Channel): string {
    switch (channel) {
      case 'enrichment_events':
        return 'enrichment_events';
      case 'credit_events':
        return 'credit_events';
      case 'scrape_events':
        return 'scrape_events';
    }
  }

  /**
   * Insert rows into ClickHouse with retry logic.
   * 3 attempts with exponential backoff (1s, 2s, 4s).
   */
  async function insertWithRetry(
    channel: Channel,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    const table = getTableName(channel);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= cfg.maxRetries - 1; attempt++) {
      try {
        const ch = getClickHouse();
        await ch.insert({
          table,
          values: rows,
          format: 'JSONEachRow',
        });
        return; // Success
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        logger.warn('Replication: ClickHouse insert failed, retrying', {
          channel,
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

    // All retries exhausted
    throw lastError ?? new Error('ClickHouse insert failed after retries');
  }

  /** Write failed events to the dead letter queue. */
  async function writeToDLQ(
    channel: Channel,
    events: BufferedEvent[],
    err: unknown,
  ): Promise<void> {
    const errorReason = err instanceof Error ? err.message : String(err);

    if (!deps.dlqRepository) {
      logger.error('Replication: DLQ repository not available, events lost', {
        channel,
        eventCount: events.length,
        error: errorReason,
      });
      return;
    }

    for (const event of events) {
      try {
        await deps.dlqRepository.insertDLQEvent({
          channel,
          eventPayload: event.payload,
          errorReason,
          retryCount: 0,
          maxRetries: 5,
          status: 'pending',
          nextRetryAt: new Date(),
        });
        stats.dlqPending++;
      } catch (dlqErr) {
        logger.error('Replication: failed to write to DLQ', {
          channel,
          eventId: event.id,
          error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
        });
      }
    }
  }

  /** Invalidate analytics cache for workspace IDs found in flushed rows. */
  function invalidateCacheForRows(
    _channel: Channel,
    rows: Record<string, unknown>[],
  ): void {
    if (!deps.analyticsCache) return;

    const workspaceIds = new Set<string>();
    for (const row of rows) {
      const wsId = row.workspace_id;
      if (typeof wsId === 'string') {
        workspaceIds.add(wsId);
      }
    }

    for (const wsId of workspaceIds) {
      deps.analyticsCache.invalidateWorkspace(wsId);
    }
  }

  /**
   * Replay pending DLQ events by re-inserting them into ClickHouse.
   * Status transitions:
   *   pending → replayed  (success)
   *   pending → pending   (transient failure, retry_count < max_retries)
   *   pending → exhausted (retry_count >= max_retries)
   */
  async function replayDLQ(): Promise<void> {
    if (!deps.dlqRepository) return;

    try {
      const events = await deps.dlqRepository.getPendingEvents(50);
      if (events.length === 0) return;

      logger.info('Replication: replaying DLQ events', { count: events.length });

      for (const event of events) {
        try {
          const ch = getClickHouse();
          const table = getTableName(event.channel as Channel);
          await ch.insert({
            table,
            values: [event.eventPayload],
            format: 'JSONEachRow',
          });

          await deps.dlqRepository.markReplayed(event.id);
          stats.dlqPending = Math.max(0, stats.dlqPending - 1);

          logger.info('Replication: DLQ event replayed successfully', {
            eventId: event.id,
            channel: event.channel,
          });
        } catch (err) {
          const nextRetryCount = event.retryCount + 1;

          if (nextRetryCount >= event.maxRetries) {
            await deps.dlqRepository.markExhausted(event.id);
            logger.error('Replication: DLQ event exhausted all retries', {
              eventId: event.id,
              channel: event.channel,
              retryCount: nextRetryCount,
              maxRetries: event.maxRetries,
              error: err instanceof Error ? err.message : String(err),
            });
          } else {
            // Exponential backoff: 60s * 2^retryCount
            const backoffMs = 60_000 * Math.pow(2, nextRetryCount);
            const nextRetryAt = new Date(Date.now() + backoffMs);
            await deps.dlqRepository.incrementRetry(event.id, nextRetryAt);
            logger.warn('Replication: DLQ event retry scheduled', {
              eventId: event.id,
              channel: event.channel,
              retryCount: nextRetryCount,
              nextRetryAt: nextRetryAt.toISOString(),
            });
          }
        }
      }
    } catch (err) {
      logger.error('Replication: DLQ replay error', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Start the replication service. */
  async function start(): Promise<void> {
    if (running) return;

    logger.info('Replication: starting service');

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
      logger.error('Replication: PG LISTEN connection error', {
        error: err.message,
      });
    });

    // Start flush interval timer
    flushTimer = setInterval(() => {
      if (totalBuffered() > 0) {
        void flushAll();
      }
    }, cfg.flushIntervalMs);

    // Replay DLQ events on startup
    void replayDLQ();

    // Start periodic DLQ replay timer (every 60s)
    dlqReplayTimer = setInterval(() => {
      void replayDLQ();
    }, 60_000);

    running = true;
    logger.info('Replication: service started, listening on channels', {
      channels: [...CHANNELS],
      batchSize: cfg.batchSize,
      flushIntervalMs: cfg.flushIntervalMs,
    });
  }

  /** Stop the replication service gracefully. */
  async function stop(): Promise<void> {
    if (!running) return;

    logger.info('Replication: stopping service');
    running = false;

    // Stop flush timer
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }

    // Stop DLQ replay timer
    if (dlqReplayTimer) {
      clearInterval(dlqReplayTimer);
      dlqReplayTimer = null;
    }

    // Flush remaining buffered events
    if (totalBuffered() > 0) {
      logger.info('Replication: flushing remaining buffer on shutdown', {
        buffered: totalBuffered(),
      });
      await flushAll();
    }

    // Close dedicated PG connection
    if (pgClient) {
      try {
        await pgClient.end();
      } catch (err) {
        logger.error('Replication: error closing PG LISTEN connection', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      pgClient = null;
    }

    logger.info('Replication: service stopped', {
      totalFlushed: stats.totalFlushed,
      totalFailed: stats.totalFailed,
    });
  }

  /** Get current replication stats. */
  function getStats(): ReplicationStats {
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
    replayDLQ,
    // Exposed for unit testing
    _handleNotification: handleNotification,
    _flushAll: flushAll,
    _getBuffers: () => buffers,
    _getTotalBuffered: totalBuffered,
  };
}

export type ReplicationService = ReturnType<typeof createReplicationService>;

/** Utility: sleep for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
