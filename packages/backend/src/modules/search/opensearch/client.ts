import { Client } from '@opensearch-project/opensearch';
import { readFileSync } from 'fs';

export interface OpenSearchConfig {
  nodeUrls: string[];
  username?: string;
  password?: string;
  requestTimeoutMs: number;
  maxRetries: number;
  sslCertPath?: string;
}

export interface ClusterHealth {
  status: 'green' | 'yellow' | 'red';
  numberOfNodes: number;
  activeShards: number;
  unassignedShards: number;
  clusterName: string;
}

let client: Client | null = null;

/**
 * Initializes the singleton OpenSearch client with the given config.
 * Call once at application startup.
 */
export function initOpenSearch(config: OpenSearchConfig): Client {
  if (!client) {
    const ssl = config.sslCertPath
      ? { ca: readFileSync(config.sslCertPath, 'utf-8') }
      : undefined;

    const auth =
      config.username && config.password
        ? { username: config.username, password: config.password }
        : undefined;

    client = new Client({
      nodes: config.nodeUrls,
      auth,
      ssl,
      requestTimeout: config.requestTimeoutMs,
      maxRetries: config.maxRetries,
    });
  }
  return client;
}

/**
 * Returns the current OpenSearch client instance.
 * Throws if the client has not been initialized via initOpenSearch().
 */
export function getOpenSearch(): Client {
  if (!client) {
    throw new Error('OpenSearch client not initialized. Call initOpenSearch() first.');
  }
  return client;
}

/**
 * Performs a health check against the OpenSearch cluster.
 * Returns cluster health details including status, node count, and shard info.
 */
export async function healthCheck(): Promise<ClusterHealth> {
  const os = getOpenSearch();
  const { body } = await os.cluster.health();
  return {
    status: body.status as ClusterHealth['status'],
    numberOfNodes: body.number_of_nodes,
    activeShards: body.active_shards,
    unassignedShards: body.unassigned_shards,
    clusterName: body.cluster_name,
  };
}

/**
 * Gracefully closes the OpenSearch client connection.
 */
export async function closeOpenSearch(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}

/**
 * Replaces the client instance — useful for testing with a mock.
 */
export function setOpenSearch(customClient: Client): void {
  client = customClient;
}

/**
 * Resets the client to null — useful for testing.
 */
export function resetOpenSearch(): void {
  client = null;
}
