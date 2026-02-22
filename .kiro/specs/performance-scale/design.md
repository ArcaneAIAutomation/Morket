# Design — Module 8.7: Performance & Scale

## Architecture

```
src/cache/
├── redis.ts          # Redis client singleton
├── cache.ts          # Generic cache layer with TTL
```

No migration needed — Redis is external.

## Environment Variables

```
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
REDIS_TLS=false
```

## Cache Keys

| Key Pattern | TTL | Description |
|-------------|-----|-------------|
| `ws:{workspaceId}:config` | 5min | Workspace configuration |
| `user:{userId}:session` | 15min | User session data |
| `provider:{slug}:health` | 1min | Provider health status |
| `rl:{endpoint}:{ip}` | 1min | Rate limit counter |
