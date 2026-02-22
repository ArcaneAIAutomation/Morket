import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

const OTEL_EXPORTER_URL = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces';
const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';

let sdk: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK with auto-instrumentation for HTTP, Express, PostgreSQL, and Redis.
 * Must be called before any other imports that load instrumented libraries.
 * Set OTEL_ENABLED=false to disable tracing entirely.
 */
export function initTracing(): void {
  if (!OTEL_ENABLED) return;

  const exporter = new OTLPTraceExporter({ url: OTEL_EXPORTER_URL });

  sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: 'morket-backend',
      [ATTR_SERVICE_VERSION]: '0.1.0',
    }),
    traceExporter: exporter,
    contextManager: new AsyncLocalStorageContextManager(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          // Don't trace health/readiness/metrics probes
          const url = req.url ?? '';
          return url === '/api/v1/health' || url === '/api/v1/readiness' || url === '/api/v1/metrics';
        },
      }),
      new ExpressInstrumentation(),
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation(),
    ],
  });

  sdk.start();
}

/**
 * Gracefully shut down the OpenTelemetry SDK, flushing any pending spans.
 */
export async function shutdownTracing(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
