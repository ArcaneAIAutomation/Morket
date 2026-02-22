import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  initClickHouse,
  getClickHouse,
  closeClickHouse,
  healthCheck,
  setClickHouse,
  type ClickHouseConfig,
} from './client';
import type { ClickHouseClient } from '@clickhouse/client';

const testConfig: ClickHouseConfig = {
  url: 'http://localhost:8123',
  database: 'morket_test',
  username: 'default',
  password: '',
};

describe('clickhouse/client', () => {
  beforeEach(async () => {
    await closeClickHouse();
  });

  describe('getClickHouse', () => {
    it('throws when client is not initialized', () => {
      expect(() => getClickHouse()).toThrow(
        'ClickHouse client not initialized. Call initClickHouse() first.',
      );
    });

    it('returns the client after setClickHouse', () => {
      const mockClient = { close: vi.fn() } as unknown as ClickHouseClient;
      setClickHouse(mockClient);
      expect(getClickHouse()).toBe(mockClient);
    });
  });

  describe('initClickHouse', () => {
    it('creates and returns a ClickHouse client instance', () => {
      const client = initClickHouse(testConfig);
      expect(client).toBeDefined();
    });

    it('returns the same client on subsequent calls', () => {
      const client1 = initClickHouse(testConfig);
      const client2 = initClickHouse(testConfig);
      expect(client1).toBe(client2);
    });

    it('makes client accessible via getClickHouse', () => {
      const client = initClickHouse(testConfig);
      expect(getClickHouse()).toBe(client);
    });
  });

  describe('setClickHouse', () => {
    it('replaces the client instance', () => {
      const mockClient = { close: vi.fn() } as unknown as ClickHouseClient;
      setClickHouse(mockClient);
      expect(getClickHouse()).toBe(mockClient);
    });
  });

  describe('closeClickHouse', () => {
    it('closes the client and resets it', async () => {
      const mockClose = vi.fn().mockResolvedValue(undefined);
      const mockClient = { close: mockClose } as unknown as ClickHouseClient;
      setClickHouse(mockClient);

      await closeClickHouse();

      expect(mockClose).toHaveBeenCalled();
      expect(() => getClickHouse()).toThrow('ClickHouse client not initialized');
    });

    it('is a no-op when client is already null', async () => {
      await expect(closeClickHouse()).resolves.toBeUndefined();
    });
  });

  describe('healthCheck', () => {
    it('returns false when client is not initialized', async () => {
      const result = await healthCheck();
      expect(result).toBe(false);
    });

    it('returns true when SELECT 1 succeeds', async () => {
      const mockResult = { close: vi.fn().mockResolvedValue(undefined) };
      const mockClient = {
        query: vi.fn().mockResolvedValue(mockResult),
        close: vi.fn(),
      } as unknown as ClickHouseClient;
      setClickHouse(mockClient);

      const result = await healthCheck();

      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'SELECT 1' }),
      );
      expect(mockResult.close).toHaveBeenCalled();
    });

    it('returns false when query throws', async () => {
      const mockClient = {
        query: vi.fn().mockRejectedValue(new Error('Connection refused')),
        close: vi.fn(),
      } as unknown as ClickHouseClient;
      setClickHouse(mockClient);

      const result = await healthCheck();

      expect(result).toBe(false);
    });
  });
});
