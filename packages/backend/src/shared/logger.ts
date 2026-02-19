export interface RequestLogEntry {
  method: string;
  path: string;
  statusCode: number;
  responseTime: number;
}

/**
 * Writes a structured JSON log line for an HTTP request to stdout.
 */
export function log(entry: RequestLogEntry): void {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    method: entry.method,
    path: entry.path,
    statusCode: entry.statusCode,
    responseTime: entry.responseTime,
  });
  process.stdout.write(line + '\n');
}

/**
 * General-purpose structured logger with info/warn/error levels.
 */
export const logger = {
  info(message: string, data?: Record<string, unknown>): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      ...data,
    });
    process.stdout.write(line + '\n');
  },

  warn(message: string, data?: Record<string, unknown>): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      ...data,
    });
    process.stdout.write(line + '\n');
  },

  error(message: string, data?: Record<string, unknown>): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      ...data,
    });
    process.stderr.write(line + '\n');
  },
};
