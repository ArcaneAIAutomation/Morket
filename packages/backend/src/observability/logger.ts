import { trace, context } from '@opentelemetry/api';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  trace_id?: string;
  span_id?: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function getTraceContext(): { trace_id?: string; span_id?: string } {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const ctx = span.spanContext();
  // Only include if trace is valid (not all-zeros)
  if (ctx.traceId === '00000000000000000000000000000000') return {};
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

function formatEntry(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'morket-backend',
    ...getTraceContext(),
    ...meta,
  };
  return JSON.stringify(entry);
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('debug')) process.stdout.write(formatEntry('debug', message, meta) + '\n');
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('info')) process.stdout.write(formatEntry('info', message, meta) + '\n');
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('warn')) process.stderr.write(formatEntry('warn', message, meta) + '\n');
  },

  error(message: string, meta?: Record<string, unknown>): void {
    if (shouldLog('error')) process.stderr.write(formatEntry('error', message, meta) + '\n');
  },
};


// --- Header and field redaction ---

const REDACTED_HEADERS = new Set([
  'authorization',
  'x-service-key',
  'cookie',
  'set-cookie',
]);

const REDACTED_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'refreshtoken',
  'accesstoken',
  'creditcard',
]);

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    redacted[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return redacted;
}

export function redactFields(body: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      redacted[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      redacted[key] = redactFields(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        item !== null && typeof item === 'object' ? redactFields(item as Record<string, unknown>) : item,
      );
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// --- Security event logging ---

export function logAuthFailure(details: {
  sourceIp: string;
  userAgent?: string;
  email?: string;
  reason: string;
}): void {
  logger.warn('Security event: authentication failure', {
    event_type: 'auth_failure',
    ...getTraceContext(),
    ...details,
  });
}

export function logAuthzFailure(details: {
  userId: string;
  resource: string;
  requiredRole: string;
  actualRole: string;
}): void {
  logger.warn('Security event: authorization failure', {
    event_type: 'authz_failure',
    ...getTraceContext(),
    ...details,
  });
}

export function logRateLimitHit(details: {
  sourceIp: string;
  endpoint: string;
  requestCount: number;
}): void {
  logger.warn('Security event: rate limit hit', {
    event_type: 'rate_limit_hit',
    ...getTraceContext(),
    ...details,
  });
}

export function logWebhookFailure(details: {
  sourceIp: string;
  endpoint: string;
  reason: string;
}): void {
  logger.warn('Security event: webhook failure', {
    event_type: 'webhook_failure',
    ...getTraceContext(),
    ...details,
  });
}
