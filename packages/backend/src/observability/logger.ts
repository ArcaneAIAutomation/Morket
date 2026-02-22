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
