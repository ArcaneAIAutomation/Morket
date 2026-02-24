/**
 * Vitest global setup — sets minimum required env vars so that
 * modules importing `config/env.ts` don't trigger process.exit(1).
 *
 * Individual tests that need to test env validation should use
 * vi.resetModules() + dynamic import() as env.test.ts does.
 */

// Only set if not already defined — allows CI/local overrides
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/morket_test';
}
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-secret-key-at-least-32-chars-long!!';
}
if (!process.env.ENCRYPTION_MASTER_KEY) {
  process.env.ENCRYPTION_MASTER_KEY = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
}
if (!process.env.CORS_ORIGINS) {
  process.env.CORS_ORIGINS = 'http://localhost:5173';
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}
