import { env } from './config/env';
import { initPool, closePool } from './shared/db';
import { logger } from './shared/logger';
import { createApp } from './app';
import { initClickHouse, closeClickHouse } from './clickhouse/client';
import { createReplicationService } from './modules/replication/replication.service';
import { initOpenSearch, healthCheck, closeOpenSearch } from './modules/search/opensearch/client';
import { createSearchIndexingPipeline } from './modules/search/search.indexing-pipeline';
import { createSearchCache } from './modules/search/search.cache';

const app = createApp({
  corsOrigin: env.CORS_ORIGIN,
  jwtSecret: env.JWT_SECRET,
  jwtAccessExpiry: env.JWT_ACCESS_EXPIRY,
  jwtRefreshExpiry: env.JWT_REFRESH_EXPIRY,
  encryptionMasterKey: env.ENCRYPTION_MASTER_KEY,
});

// Initialize database pool
initPool({ connectionString: env.DATABASE_URL });

// Initialize ClickHouse client (non-blocking — logs warning if unavailable)
try {
  initClickHouse({
    url: env.CLICKHOUSE_URL,
    database: env.CLICKHOUSE_DATABASE,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD ?? '',
  });
} catch (err) {
  logger.warn('ClickHouse initialization failed, analytics will be unavailable', {
    error: err instanceof Error ? err.message : String(err),
  });
}

// Initialize OpenSearch client (non-blocking — logs warning if unavailable)
try {
  initOpenSearch({
    nodeUrls: env.OPENSEARCH_NODE_URLS.split(','),
    username: env.OPENSEARCH_USERNAME,
    password: env.OPENSEARCH_PASSWORD,
    requestTimeoutMs: env.OPENSEARCH_REQUEST_TIMEOUT_MS,
    maxRetries: 3,
    sslCertPath: env.OPENSEARCH_SSL_CERT_PATH,
  });
} catch (err) {
  logger.warn('OpenSearch initialization failed, search will be unavailable', {
    error: err instanceof Error ? err.message : String(err),
  });
}

// Create replication service (starts after server is listening)
const replicationService = createReplicationService();

// Create search cache and indexing pipeline (starts after server is listening)
const searchCache = createSearchCache();
const searchIndexingPipeline = createSearchIndexingPipeline({}, { searchCache });

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`, {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
  });

  // Start replication pipeline after server is ready
  replicationService.start().catch((err) => {
    logger.warn('Replication service failed to start, events will not be replicated', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Start search indexing pipeline after server is ready
  searchIndexingPipeline.start().catch((err) => {
    logger.warn('Search indexing pipeline failed to start, incremental indexing will be unavailable', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  // Verify OpenSearch cluster is reachable (non-blocking)
  healthCheck()
    .then((health) => {
      logger.info('OpenSearch cluster connected', {
        status: health.status,
        nodes: health.numberOfNodes,
        clusterName: health.clusterName,
      });
    })
    .catch((err) => {
      logger.warn('OpenSearch cluster unreachable, search will be unavailable until cluster recovers', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully`);

  // Stop accepting new connections
  server.close();

  // Stop replication (flushes remaining buffer)
  await replicationService.stop();

  // Stop search indexing pipeline (flushes remaining buffer)
  await searchIndexingPipeline.stop();

  // Close OpenSearch
  await closeOpenSearch();

  // Close ClickHouse
  await closeClickHouse();

  // Close PG pool
  await closePool();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
