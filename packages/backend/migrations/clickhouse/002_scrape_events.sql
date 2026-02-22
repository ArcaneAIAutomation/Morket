CREATE TABLE IF NOT EXISTS scrape_events (
  event_id UUID,
  workspace_id UUID,
  job_id UUID,
  task_id UUID,
  target_domain LowCardinality(String),
  target_type LowCardinality(String),
  status LowCardinality(String),
  duration_ms UInt32,
  proxy_used Nullable(String),
  error_category Nullable(String),
  created_at DateTime64(3, 'UTC'),
  job_created_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(event_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (workspace_id, created_at, event_id)
SETTINGS index_granularity = 8192;
