# Design — Module 8.8: Observability & Operations

## Architecture

```
src/observability/
├── logger.ts         # Structured JSON logger
├── metrics.ts        # In-memory metrics counters
```

## Structured Log Format

```json
{
  "timestamp": "2026-02-22T12:00:00.000Z",
  "level": "info",
  "message": "Request completed",
  "service": "morket-backend",
  "requestId": "abc-123",
  "method": "GET",
  "path": "/api/v1/health",
  "statusCode": 200,
  "durationMs": 12
}
```

## Metrics Response

```json
{
  "uptime": 3600,
  "requests": { "total": 1500, "errors": 12 },
  "avgResponseTimeMs": 45,
  "activeConnections": 3,
  "memory": { "heapUsed": 52428800, "heapTotal": 67108864, "rss": 89128960 }
}
```
