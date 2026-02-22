const startTime = Date.now();

let totalRequests = 0;
let totalErrors = 0;
let totalResponseTimeMs = 0;

export function recordRequest(durationMs: number, isError: boolean): void {
  totalRequests++;
  totalResponseTimeMs += durationMs;
  if (isError) totalErrors++;
}

export function getMetrics() {
  const mem = process.memoryUsage();
  return {
    uptime: Math.floor((Date.now() - startTime) / 1000),
    requests: {
      total: totalRequests,
      errors: totalErrors,
      successRate: totalRequests > 0 ? Math.round(((totalRequests - totalErrors) / totalRequests) * 10000) / 100 : 100,
    },
    avgResponseTimeMs: totalRequests > 0 ? Math.round(totalResponseTimeMs / totalRequests) : 0,
    memory: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
    },
  };
}

export function resetMetrics(): void {
  totalRequests = 0;
  totalErrors = 0;
  totalResponseTimeMs = 0;
}
