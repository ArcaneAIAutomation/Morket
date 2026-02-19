import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getPool, query, closePool, setPool, initPool, type DbConfig } from './db';
import type Pool from 'pg-pool';
import type { Client } from 'pg';

const testConfig: DbConfig = {
  connectionString: 'postgresql://user:pass@localhost:5432/testdb',
  max: 5,
};

describe('db', () => {
  beforeEach(async () => {
    await closePool();
  });

  describe('getPool', () => {
    it('throws when pool is not initialized', () => {
      expect(() => getPool()).toThrow('Database pool not initialized');
    });

    it('returns the pool after setPool', () => {
      const mockPool = { query: vi.fn(), end: vi.fn() } as unknown as Pool<Client>;
      setPool(mockPool);
      expect(getPool()).toBe(mockPool);
    });
  });

  describe('initPool', () => {
    it('creates and returns a Pool instance', () => {
      const pool = initPool(testConfig);
      expect(pool).toBeDefined();
      expect(typeof pool.query).toBe('function');
    });

    it('returns the same pool on subsequent calls', () => {
      const pool1 = initPool(testConfig);
      const pool2 = initPool(testConfig);
      expect(pool1).toBe(pool2);
    });

    it('makes pool accessible via getPool', () => {
      const pool = initPool(testConfig);
      expect(getPool()).toBe(pool);
    });
  });

  describe('setPool', () => {
    it('replaces the pool instance', () => {
      const mockPool = { query: vi.fn(), end: vi.fn() } as unknown as Pool<Client>;
      setPool(mockPool);
      expect(getPool()).toBe(mockPool);
    });
  });

  describe('query', () => {
    it('delegates to pool.query with text and params', async () => {
      const mockResult = { rows: [{ id: 1 }], rowCount: 1 };
      const mockPool = {
        query: vi.fn().mockResolvedValue(mockResult),
        end: vi.fn(),
      } as unknown as Pool<Client>;

      setPool(mockPool);

      const result = await query('SELECT $1::int AS id', [1]);
      expect(mockPool.query).toHaveBeenCalledWith('SELECT $1::int AS id', [1]);
      expect(result).toBe(mockResult);
    });

    it('delegates to pool.query without params', async () => {
      const mockResult = { rows: [], rowCount: 0 };
      const mockPool = {
        query: vi.fn().mockResolvedValue(mockResult),
        end: vi.fn(),
      } as unknown as Pool<Client>;

      setPool(mockPool);

      const result = await query('SELECT 1');
      expect(mockPool.query).toHaveBeenCalledWith('SELECT 1', undefined);
      expect(result).toBe(mockResult);
    });

    it('throws when pool is not initialized', async () => {
      await expect(query('SELECT 1')).rejects.toThrow('Database pool not initialized');
    });
  });

  describe('closePool', () => {
    it('ends the pool and resets it', async () => {
      const mockEnd = vi.fn().mockResolvedValue(undefined);
      const mockPool = {
        query: vi.fn(),
        end: mockEnd,
      } as unknown as Pool<Client>;

      setPool(mockPool);
      await closePool();

      expect(mockEnd).toHaveBeenCalled();
      expect(() => getPool()).toThrow('Database pool not initialized');
    });

    it('is a no-op when pool is already null', async () => {
      await expect(closePool()).resolves.toBeUndefined();
    });
  });
});
