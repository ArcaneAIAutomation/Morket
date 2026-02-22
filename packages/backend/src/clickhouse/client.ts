import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { logger } from '../shared/logger';

export interface ClickHouseConfig {
  url: string;
  database: string;
  username: string;
  password: string;
  maxOpenConnections?: number;
  requestTimeout?: number;
  connectTimeout?: number;
}

let client: ClickHouseClient | null = null;

/**
 * Initializes the singleton ClickHouse client with the given config.
 * Call once at application startup.
 */
export function initClickHouse(config: ClickHouseConfig): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: config.url,
      database: config.database,
      username: config.username,
      password: config.password,
      max_open_connections: config.maxOpenConnections ?? 10,
      request_timeout: config.requestTimeout ?? 30_000,
      connect_timeout: config.connectTimeout ?? 5_000,
    });
  }
  return client;
}

/**
 * Returns the current ClickHouse client instance.
 * Throws if the client has not been initialized via initClickHouse().
 */
export function getClickHouse(): ClickHouseClient {
  if (!client) {
    throw new Error('ClickHouse client not initialized. Call initClickHouse() first.');
  }
  return client;
}

/**
 * Gracefully closes the ClickHouse client connection.
 */
export async function closeClickHouse(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/**
 * Performs a health check against ClickHouse by executing `SELECT 1`.
 * Returns true if the query succeeds within 5 seconds, false otherwise.
 */
export async function healthCheck(): Promise<boolean> {
  if (!client) {
    return false;
  }
  try {
    const result = await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 5,
      },
    });
    await result.close();
    return true;
  } catch (err) {
    logger.warn('ClickHouse health check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Replaces the client instance — useful for testing with a mock.
 */
export function setClickHouse(customClient: ClickHouseClient): void {
  client = customClient;
}
