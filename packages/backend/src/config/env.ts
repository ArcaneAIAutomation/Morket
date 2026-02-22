import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file before validation
dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .default('3000')
    .transform(Number)
    .pipe(z.number().int().positive()),

  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required' })
    .url('DATABASE_URL must be a valid URL')
    .startsWith('postgresql://', 'DATABASE_URL must be a PostgreSQL connection URL'),

  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET is required' })
    .min(32, 'JWT_SECRET must be at least 32 characters'),

  JWT_ACCESS_EXPIRY: z
    .string({ required_error: 'JWT_ACCESS_EXPIRY is required' })
    .default('15m'),

  JWT_REFRESH_EXPIRY: z
    .string({ required_error: 'JWT_REFRESH_EXPIRY is required' })
    .default('7d'),

  ENCRYPTION_MASTER_KEY: z
    .string({ required_error: 'ENCRYPTION_MASTER_KEY is required' })
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_MASTER_KEY must be exactly 64 hex characters (32 bytes)'),

  CORS_ORIGIN: z
    .string({ required_error: 'CORS_ORIGIN is required' })
    .default('http://localhost:5173'),

  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // ClickHouse (OLAP)
  CLICKHOUSE_URL: z
    .string()
    .default('http://localhost:8123'),

  CLICKHOUSE_DATABASE: z
    .string()
    .default('morket'),

  CLICKHOUSE_USER: z
    .string()
    .default('default'),

  CLICKHOUSE_PASSWORD: z
    .string()
    .optional()
    .default(''),

  // OpenSearch
  OPENSEARCH_NODE_URLS: z
    .string()
    .default('http://localhost:9200'),

  OPENSEARCH_USERNAME: z
    .string()
    .optional(),

  OPENSEARCH_PASSWORD: z
    .string()
    .optional(),

  OPENSEARCH_REQUEST_TIMEOUT_MS: z
    .string()
    .default('10000')
    .transform(Number)
    .pipe(z.number().int().positive()),

  OPENSEARCH_SSL_CERT_PATH: z
    .string()
    .optional(),

  // Stripe Billing
  STRIPE_SECRET_KEY: z
    .string()
    .optional(),

  STRIPE_WEBHOOK_SECRET: z
    .string()
    .optional(),

  STRIPE_STARTER_PRICE_ID: z
    .string()
    .optional(),

  STRIPE_PRO_PRICE_ID: z
    .string()
    .optional(),

  STRIPE_ENTERPRISE_PRICE_ID: z
    .string()
    .optional(),

  // CRM Integrations (OAuth2)
  SALESFORCE_CLIENT_ID: z
    .string()
    .optional(),

  SALESFORCE_CLIENT_SECRET: z
    .string()
    .optional(),

  HUBSPOT_CLIENT_ID: z
    .string()
    .optional(),

  HUBSPOT_CLIENT_SECRET: z
    .string()
    .optional(),

  INTEGRATION_OAUTH_REDIRECT_BASE: z
    .string()
    .default('http://localhost:3000/api/v1/integrations/callback'),

  // Redis
  REDIS_URL: z
    .string()
    .optional(),

  // OpenTelemetry
  OTEL_ENABLED: z
    .string()
    .default('true'),

  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .default('http://localhost:4318/v1/traces'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    console.error('❌ Environment validation failed:\n' + formatted);
    process.exit(1);
  }

  return result.data;
}

export const env = validateEnv();
