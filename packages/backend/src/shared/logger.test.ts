import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, logger, RequestLogEntry } from './logger';

describe('log', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('writes a JSON line to stdout with all required fields', () => {
    const entry: RequestLogEntry = {
      method: 'GET',
      path: '/api/v1/health',
      statusCode: 200,
      responseTime: 42,
    };

    log(entry);

    expect(stdoutSpy).toHaveBeenCalledOnce();
    const output = stdoutSpy.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(output.trim());
    expect(parsed.method).toBe('GET');
    expect(parsed.path).toBe('/api/v1/health');
    expect(parsed.statusCode).toBe(200);
    expect(parsed.responseTime).toBe(42);
    expect(parsed.level).toBe('info');
    expect(parsed.timestamp).toBeDefined();
  });

  it('produces valid JSON for various HTTP methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
    for (const method of methods) {
      log({ method, path: '/test', statusCode: 200, responseTime: 1 });
    }

    expect(stdoutSpy).toHaveBeenCalledTimes(methods.length);
    for (const call of stdoutSpy.mock.calls) {
      const parsed = JSON.parse((call[0] as string).trim());
      expect(parsed).toHaveProperty('method');
      expect(parsed).toHaveProperty('path');
      expect(parsed).toHaveProperty('statusCode');
      expect(parsed).toHaveProperty('responseTime');
    }
  });
});

describe('logger', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('info writes JSON to stdout with level info', () => {
    logger.info('server started', { port: 3000 });

    expect(stdoutSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('server started');
    expect(parsed.port).toBe(3000);
    expect(parsed.timestamp).toBeDefined();
  });

  it('warn writes JSON to stdout with level warn', () => {
    logger.warn('high memory usage');

    expect(stdoutSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((stdoutSpy.mock.calls[0][0] as string).trim());
    expect(parsed.level).toBe('warn');
    expect(parsed.message).toBe('high memory usage');
  });

  it('error writes JSON to stderr with level error', () => {
    logger.error('connection failed', { host: 'db.local' });

    expect(stderrSpy).toHaveBeenCalledOnce();
    const parsed = JSON.parse((stderrSpy.mock.calls[0][0] as string).trim());
    expect(parsed.level).toBe('error');
    expect(parsed.message).toBe('connection failed');
    expect(parsed.host).toBe('db.local');
  });

  it('info and warn work without extra data', () => {
    logger.info('plain message');
    logger.warn('plain warning');

    expect(stdoutSpy).toHaveBeenCalledTimes(2);
    for (const call of stdoutSpy.mock.calls) {
      const parsed = JSON.parse((call[0] as string).trim());
      expect(parsed.message).toBeDefined();
      expect(parsed.timestamp).toBeDefined();
    }
  });
});
