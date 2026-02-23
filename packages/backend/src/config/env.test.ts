import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Valid env values for testing
const VALID_ENV = {
  PORT: '3000',
  DATABASE_URL: 'postgresql://user:password@localhost:5432/morket',
  JWT_SECRET: 'a]3Fj!kL9#mN2$pQ5&rS8*tU0^vW4(xY',
  JWT_ACCESS_EXPIRY: '15m',
  JWT_REFRESH_EXPIRY: '7d',
  ENCRYPTION_MASTER_KEY: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  CORS_ORIGINS: 'http://localhost:5173',
  NODE_ENV: 'development',
};

describe('env config', () => {
  const originalEnv = process.env;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('should parse valid environment variables', async () => {
    Object.assign(process.env, VALID_ENV);
    const { env } = await import('./env');

    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(env.JWT_SECRET).toBe(VALID_ENV.JWT_SECRET);
    expect(env.JWT_ACCESS_EXPIRY).toBe('15m');
    expect(env.JWT_REFRESH_EXPIRY).toBe('7d');
    expect(env.ENCRYPTION_MASTER_KEY).toBe(VALID_ENV.ENCRYPTION_MASTER_KEY);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.NODE_ENV).toBe('development');
  });

  it('should default PORT to 3000 when not provided', async () => {
    const { PORT: _port, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);
    delete process.env.PORT;
    const { env } = await import('./env');

    expect(env.PORT).toBe(3000);
  });

  it('should default NODE_ENV to development when not provided', async () => {
    const { NODE_ENV: _nodeEnv, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);
    delete process.env.NODE_ENV;
    const { env } = await import('./env');

    expect(env.NODE_ENV).toBe('development');
  });

  it('should accept all valid NODE_ENV values', async () => {
    for (const nodeEnv of ['development', 'production', 'test']) {
      vi.resetModules();
      Object.assign(process.env, { ...VALID_ENV, NODE_ENV: nodeEnv });
      const { env } = await import('./env');
      expect(env.NODE_ENV).toBe(nodeEnv);
    }
  });

  it('should terminate when DATABASE_URL is missing', async () => {
    const { DATABASE_URL: _db, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);
    delete process.env.DATABASE_URL;
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('should terminate when DATABASE_URL is not a postgresql URL', async () => {
    Object.assign(process.env, { ...VALID_ENV, DATABASE_URL: 'mysql://localhost/db' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should terminate when JWT_SECRET is too short', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_SECRET: 'short' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should terminate when ENCRYPTION_MASTER_KEY is not 64 hex chars', async () => {
    Object.assign(process.env, { ...VALID_ENV, ENCRYPTION_MASTER_KEY: 'not-hex' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should terminate when ENCRYPTION_MASTER_KEY is wrong length', async () => {
    Object.assign(process.env, { ...VALID_ENV, ENCRYPTION_MASTER_KEY: 'abcdef1234' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should terminate when NODE_ENV is invalid', async () => {
    Object.assign(process.env, { ...VALID_ENV, NODE_ENV: 'staging' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should log descriptive error messages on failure', async () => {
    const { DATABASE_URL: _db, JWT_SECRET: _jwt, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    await import('./env');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Environment validation failed')
    );
  });

  it('should accept PORT as a numeric string', async () => {
    Object.assign(process.env, { ...VALID_ENV, PORT: '8080' });
    const { env } = await import('./env');

    expect(env.PORT).toBe(8080);
  });

  it('should terminate when PORT is not a valid number', async () => {
    Object.assign(process.env, { ...VALID_ENV, PORT: 'abc' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should terminate when JWT_ACCESS_EXPIRY exceeds 15 minutes', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_ACCESS_EXPIRY: '16m' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should terminate when JWT_ACCESS_EXPIRY has invalid format', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_ACCESS_EXPIRY: 'forever' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should accept JWT_ACCESS_EXPIRY at exactly 15 minutes', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_ACCESS_EXPIRY: '15m' });
    const { env } = await import('./env');

    expect(env.JWT_ACCESS_EXPIRY).toBe('15m');
  });

  it('should accept JWT_ACCESS_EXPIRY in seconds within limit', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_ACCESS_EXPIRY: '900s' });
    const { env } = await import('./env');

    expect(env.JWT_ACCESS_EXPIRY).toBe('900s');
  });

  it('should terminate when JWT_REFRESH_EXPIRY exceeds 7 days', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_REFRESH_EXPIRY: '8d' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should terminate when JWT_REFRESH_EXPIRY has invalid format', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_REFRESH_EXPIRY: '1w' });
    await import('./env');

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should accept JWT_REFRESH_EXPIRY at exactly 7 days', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_REFRESH_EXPIRY: '7d' });
    const { env } = await import('./env');

    expect(env.JWT_REFRESH_EXPIRY).toBe('7d');
  });

  it('should accept JWT_REFRESH_EXPIRY in hours within limit', async () => {
    Object.assign(process.env, { ...VALID_ENV, JWT_REFRESH_EXPIRY: '168h' });
    const { env } = await import('./env');

    expect(env.JWT_REFRESH_EXPIRY).toBe('168h');
  });
});
