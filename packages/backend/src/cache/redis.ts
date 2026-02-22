import Redis from 'ioredis';

let client: Redis | null = null;
let isConnected = false;

export interface RedisConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  tls?: boolean;
}

/**
 * Initialize Redis client. Gracefully handles connection failures —
 * the app continues to work without Redis (cache misses fall through to DB).
 */
export function initRedis(config: RedisConfig): Redis | null {
  if (client) return client;

  try {
    if (config.url) {
      client = new Redis(config.url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 3000),
        lazyConnect: true,
      });
    } else {
      client = new Redis({
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        password: config.password,
        tls: config.tls ? {} : undefined,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 3000),
        lazyConnect: true,
      });
    }

    client.on('connect', () => { isConnected = true; });
    client.on('error', () => { isConnected = false; });
    client.on('close', () => { isConnected = false; });

    // Non-blocking connect
    client.connect().catch(() => { isConnected = false; });

    return client;
  } catch {
    client = null;
    return null;
  }
}

export function getRedis(): Redis | null {
  return isConnected ? client : null;
}

export function isRedisConnected(): boolean {
  return isConnected;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = null;
    isConnected = false;
  }
}

export async function redisHealthCheck(): Promise<boolean> {
  if (!client || !isConnected) return false;
  try {
    const result = await client.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
