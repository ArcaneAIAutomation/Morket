CREATE TABLE IF NOT EXISTS enrichment_events (
  event_id UUID,
  workspace_id UUID,
  job_id UUID,
  record_id UUID,
  provider_slug LowCardinality(String),
  enrichment_field LowCardinality(String),
  status LowCardinality(String),
  credits_consumed UInt32,
  duration_ms UInt32,
  error_category Nullable(String),
  created_at DateTime64(3, 'UTC'),
  job_created_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(event_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (workspace_id, created_at, event_id)
SETTINGS index_granularity = 8192;
