# Tasks — Module 8.7: Performance & Scale

## 1. Redis Client
- [x] Redis singleton with lazy connect + graceful degradation
- [x] Health check integration
- [x] Configurable via REDIS_URL env var

## 2. Cache Layer
- [x] Generic get/set/delete with TTL
- [x] Pattern-based cache invalidation
- [x] Workspace config cache (5min TTL)
- [x] User session cache (15min TTL)
- [x] Provider health cache (1min TTL)
- [x] All operations wrapped in try/catch (silent failures)

## 3. App Integration
- [x] Redis health in /api/v1/health endpoint
- [x] REDIS_URL in env.ts + .env.example

## 4. Validation
- [x] Zero TypeScript diagnostics
