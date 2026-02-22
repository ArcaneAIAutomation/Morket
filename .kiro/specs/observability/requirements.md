# Requirements — Module 8.8: Observability & Operations

## Overview
Structured logging standardization, metrics endpoint, and operational health monitoring.

## Functional Requirements

### 8.8.1 Structured Logger
- JSON-formatted log output with consistent fields: timestamp, level, message, requestId, service
- Log levels: debug, info, warn, error
- Correlation ID propagation (from requestId middleware)
- Never log credentials, tokens, or PII

### 8.8.2 Metrics Endpoint
- GET /api/v1/metrics — returns operational metrics
- Metrics: request count, error count, avg response time, active connections, uptime
- In-memory counters (no external dependency)

### 8.8.3 Readiness Endpoint
- GET /api/v1/readiness — checks all dependencies (DB, ClickHouse, OpenSearch, Redis)
- Returns per-dependency status
- Used by container orchestrators for readiness probes

## Non-Functional Requirements
- Logger is a drop-in replacement for console.log usage
- Metrics endpoint is public (no auth) for monitoring systems
- No external dependencies (no Prometheus client, no OpenTelemetry SDK yet)
