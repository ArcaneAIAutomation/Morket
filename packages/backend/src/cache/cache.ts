import { getRedis } from './redis';

/**
 * Generic cache layer with graceful degradation.
 * All operations are wrapped in try/catch — cache failures never break the app.
 */

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    const value = await redis.get(key);
    return value ? (JSON.parse(value) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // Silently fail — cache is optional
  }
}

export async function cacheDel(key: string): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.del(key);
  } catch {
    // Silently fail
  }
}

export async function cacheDelPattern(pattern: string): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const keys = await redis.keys(pattern);
    if (keys.length > 0) await redis.del(...keys);
  } catch {
    // Silently fail
  }
}

// --- Domain-specific cache helpers ---

const TTL = {
  WORKSPACE_CONFIG: 300,   // 5 min
  USER_SESSION: 900,       // 15 min
  PROVIDER_HEALTH: 60,     // 1 min
  RATE_LIMIT: 60,          // 1 min
};

export async function getWorkspaceConfig<T>(workspaceId: string): Promise<T | null> {
  return cacheGet<T>(`ws:${workspaceId}:config`);
}

export async function setWorkspaceConfig(workspaceId: string, config: unknown): Promise<void> {
  return cacheSet(`ws:${workspaceId}:config`, config, TTL.WORKSPACE_CONFIG);
}

export async function invalidateWorkspaceConfig(workspaceId: string): Promise<void> {
  return cacheDel(`ws:${workspaceId}:config`);
}

export async function getUserSession<T>(userId: string): Promise<T | null> {
  return cacheGet<T>(`user:${userId}:session`);
}

export async function setUserSession(userId: string, session: unknown): Promise<void> {
  return cacheSet(`user:${userId}:session`, session, TTL.USER_SESSION);
}

export async function invalidateUserSession(userId: string): Promise<void> {
  return cacheDel(`user:${userId}:session`);
}

export async function getProviderHealth<T>(slug: string): Promise<T | null> {
  return cacheGet<T>(`provider:${slug}:health`);
}

export async function setProviderHealth(slug: string, health: unknown): Promise<void> {
  return cacheSet(`provider:${slug}:health`, health, TTL.PROVIDER_HEALTH);
}
