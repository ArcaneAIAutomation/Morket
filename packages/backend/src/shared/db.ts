import Pool from 'pg-pool';
import { type Client, type QueryResultRow, type QueryResult } from 'pg';

let pool: Pool<Client> | null = null;

export interface DbConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

/**
 * Initializes the singleton pool with the given config.
 * Call once at application startup (e.g. in server.ts) with values from validated env.
 */
export function initPool(config: DbConfig): Pool<Client> {
  if (!pool) {
    pool = new Pool({
      connectionString: config.connectionString,
      max: config.max ?? 20,
      idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
      connectionTimeoutMillis: config.connectionTimeoutMillis ?? 5_000,
    });
  }

  return pool;
}

/**
 * Returns the current pool instance.
 * Throws if the pool has not been initialized via initPool() or setPool().
 */
export function getPool(): Pool<Client> {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initPool() or setPool() first.');
  }
  return pool;
}

/**
 * Convenience query helper that uses the shared pool.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Gracefully shuts down the connection pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Replaces the pool instance — useful for testing with a mock or custom pool.
 */
export function setPool(customPool: Pool<Client>): void {
  pool = customPool;
}
