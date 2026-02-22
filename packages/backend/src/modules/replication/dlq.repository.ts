import { query } from '../../shared/db';

export type DLQStatus = 'pending' | 'replayed' | 'exhausted';

export interface DeadLetterEvent {
  id: string;
  channel: string;
  eventPayload: Record<string, unknown>;
  errorReason: string;
  retryCount: number;
  maxRetries: number;
  status: DLQStatus;
  createdAt: Date;
  nextRetryAt: Date;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface DLQRepository {
  insertDLQEvent(data: Omit<DeadLetterEvent, 'id' | 'createdAt'>): Promise<DeadLetterEvent>;
  getPendingEvents(limit: number): Promise<DeadLetterEvent[]>;
  markReplayed(id: string): Promise<void>;
  markExhausted(id: string): Promise<void>;
  incrementRetry(id: string, nextRetryAt: Date): Promise<void>;
  resetExhausted(): Promise<number>;
  listEvents(options: { status?: DLQStatus; page: number; limit: number }): Promise<PaginatedResult<DeadLetterEvent>>;
}

interface DeadLetterEventRow {
  id: string;
  channel: string;
  event_payload: Record<string, unknown>;
  error_reason: string;
  retry_count: number;
  max_retries: number;
  status: DLQStatus;
  created_at: Date;
  next_retry_at: Date;
}

function toDeadLetterEvent(row: DeadLetterEventRow): DeadLetterEvent {
  return {
    id: row.id,
    channel: row.channel,
    eventPayload: row.event_payload,
    errorReason: row.error_reason,
    retryCount: Number(row.retry_count),
    maxRetries: Number(row.max_retries),
    status: row.status,
    createdAt: row.created_at,
    nextRetryAt: row.next_retry_at,
  };
}

const DLQ_COLUMNS =
  'id, channel, event_payload, error_reason, retry_count, max_retries, status, created_at, next_retry_at';

export async function insertDLQEvent(
  data: Omit<DeadLetterEvent, 'id' | 'createdAt'>,
): Promise<DeadLetterEvent> {
  const result = await query<DeadLetterEventRow>(
    `INSERT INTO dead_letter_queue (channel, event_payload, error_reason, retry_count, max_retries, status, next_retry_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${DLQ_COLUMNS}`,
    [
      data.channel,
      JSON.stringify(data.eventPayload),
      data.errorReason,
      data.retryCount,
      data.maxRetries,
      data.status,
      data.nextRetryAt,
    ],
  );
  return toDeadLetterEvent(result.rows[0]);
}

export async function getPendingEvents(limit: number): Promise<DeadLetterEvent[]> {
  const result = await query<DeadLetterEventRow>(
    `SELECT ${DLQ_COLUMNS}
     FROM dead_letter_queue
     WHERE status = 'pending' AND next_retry_at <= NOW()
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(toDeadLetterEvent);
}

export async function markReplayed(id: string): Promise<void> {
  await query(
    `UPDATE dead_letter_queue SET status = 'replayed' WHERE id = $1`,
    [id],
  );
}

export async function markExhausted(id: string): Promise<void> {
  await query(
    `UPDATE dead_letter_queue SET status = 'exhausted' WHERE id = $1`,
    [id],
  );
}

export async function incrementRetry(id: string, nextRetryAt: Date): Promise<void> {
  await query(
    `UPDATE dead_letter_queue
     SET retry_count = retry_count + 1, next_retry_at = $2
     WHERE id = $1`,
    [id, nextRetryAt],
  );
}

export async function resetExhausted(): Promise<number> {
  const result = await query(
    `UPDATE dead_letter_queue
     SET status = 'pending', retry_count = 0, next_retry_at = NOW()
     WHERE status = 'exhausted'`,
  );
  return result.rowCount ?? 0;
}

export async function listEvents(
  options: { status?: DLQStatus; page: number; limit: number },
): Promise<PaginatedResult<DeadLetterEvent>> {
  const { page, limit, status } = options;
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [dataResult, countResult] = await Promise.all([
    query<DeadLetterEventRow>(
      `SELECT ${DLQ_COLUMNS}
       FROM dead_letter_queue
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limit, offset],
    ),
    query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM dead_letter_queue ${whereClause}`,
      params,
    ),
  ]);

  return {
    items: dataResult.rows.map(toDeadLetterEvent),
    total: parseInt(countResult.rows[0].count, 10),
    page,
    limit,
  };
}

/** Factory that returns a DLQRepository object for dependency injection. */
export function createDLQRepository(): DLQRepository {
  return {
    insertDLQEvent,
    getPendingEvents,
    markReplayed,
    markExhausted,
    incrementRetry,
    resetExhausted,
    listEvents,
  };
}
