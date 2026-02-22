import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Client } from '@opensearch-project/opensearch';

const { MockClient, mockReadFileSync } = vi.hoisted(() => ({
  MockClient: vi.fn(),
  mockReadFileSync: vi.fn().mockReturnValue('mock-cert-content'),
}));

vi.mock('@opensearch-project/opensearch', () => ({
  Client: MockClient,
}));

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
}));

import {
  initOpenSearch,
  getOpenSearch,
  healthCheck,
  closeOpenSearch,
  setOpenSearch,
  resetOpenSearch,
} from './client';

const baseConfig = {
  nodeUrls: ['http://localhost:9200'],
  requestTimeoutMs: 10000,
  maxRetries: 3,
};

describe('opensearch/client', () => {
  beforeEach(() => {
    resetOpenSearch();
    vi.clearAllMocks();
    MockClient.mockImplementation(() => ({
      cluster: { health: vi.fn() },
      close: vi.fn().mockResolvedValue(undefined),
    }));
  });

  describe('getOpenSearch', () => {
    it('throws when client is not initialized', () => {
      expect(() => getOpenSearch()).toThrow(
        'OpenSearch client not initialized. Call initOpenSearch() first.',
      );
    });

    it('returns client after setOpenSearch', () => {
      const mockClient = { fake: true } as unknown as Client;
      setOpenSearch(mockClient);
      expect(getOpenSearch()).toBe(mockClient);
    });
  });

  describe('initOpenSearch', () => {
    it('creates client and getOpenSearch returns it', () => {
      const client = initOpenSearch(baseConfig);
      expect(client).toBeDefined();
      expect(getOpenSearch()).toBe(client);
      expect(MockClient).toHaveBeenCalledOnce();
    });

    it('returns same instance on subsequent calls (singleton)', () => {
      const client1 = initOpenSearch(baseConfig);
      const client2 = initOpenSearch(baseConfig);
      expect(client1).toBe(client2);
      expect(MockClient).toHaveBeenCalledOnce();
    });

    it('passes correct options to Client constructor', () => {
      initOpenSearch({
        nodeUrls: ['http://node1:9200', 'http://node2:9200'],
        username: 'admin',
        password: 'secret',
        requestTimeoutMs: 5000,
        maxRetries: 5,
      });

      expect(MockClient).toHaveBeenCalledWith({
        nodes: ['http://node1:9200', 'http://node2:9200'],
        auth: { username: 'admin', password: 'secret' },
        ssl: undefined,
        requestTimeout: 5000,
        maxRetries: 5,
      });
    });

    it('omits auth when username/password not provided', () => {
      initOpenSearch(baseConfig);

      expect(MockClient).toHaveBeenCalledWith(
        expect.objectContaining({ auth: undefined }),
      );
    });
  });

  describe('TLS config', () => {
    it('passes ssl.ca when sslCertPath is provided', () => {
      initOpenSearch({
        ...baseConfig,
        sslCertPath: '/path/to/cert.pem',
      });

      expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/cert.pem', 'utf-8');
      expect(MockClient).toHaveBeenCalledWith(
        expect.objectContaining({
          ssl: { ca: 'mock-cert-content' },
        }),
      );
    });

    it('does not set ssl when sslCertPath is not provided', () => {
      initOpenSearch(baseConfig);

      expect(MockClient).toHaveBeenCalledWith(
        expect.objectContaining({ ssl: undefined }),
      );
    });
  });

  describe('healthCheck', () => {
    it('returns mapped ClusterHealth from cluster.health() response', async () => {
      const mockHealth = vi.fn().mockResolvedValue({
        body: {
          status: 'green',
          number_of_nodes: 3,
          active_shards: 42,
          unassigned_shards: 0,
          cluster_name: 'morket-cluster',
        },
      });

      MockClient.mockImplementation(() => ({
        cluster: { health: mockHealth },
        close: vi.fn(),
      }));

      initOpenSearch(baseConfig);
      const result = await healthCheck();

      expect(result).toEqual({
        status: 'green',
        numberOfNodes: 3,
        activeShards: 42,
        unassignedShards: 0,
        clusterName: 'morket-cluster',
      });
    });

    it('throws when client is not initialized', async () => {
      await expect(healthCheck()).rejects.toThrow(
        'OpenSearch client not initialized. Call initOpenSearch() first.',
      );
    });
  });

  describe('closeOpenSearch', () => {
    it('closes client and resets to null', async () => {
      const mockClose = vi.fn().mockResolvedValue(undefined);
      MockClient.mockImplementation(() => ({
        cluster: { health: vi.fn() },
        close: mockClose,
      }));

      initOpenSearch(baseConfig);
      expect(getOpenSearch()).toBeDefined();

      await closeOpenSearch();

      expect(mockClose).toHaveBeenCalledOnce();
      expect(() => getOpenSearch()).toThrow(
        'OpenSearch client not initialized. Call initOpenSearch() first.',
      );
    });

    it('is a no-op when client is already null', async () => {
      await expect(closeOpenSearch()).resolves.toBeUndefined();
    });
  });
});
