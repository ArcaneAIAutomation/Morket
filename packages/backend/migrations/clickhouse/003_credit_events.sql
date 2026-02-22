CREATE TABLE IF NOT EXISTS credit_events (
  event_id UUID,
  workspace_id UUID,
  transaction_type LowCardinality(String),
  amount Int32,
  source LowCardinality(String),
  reference_id Nullable(UUID),
  provider_slug Nullable(LowCardinality(String)),
  created_at DateTime64(3, 'UTC')
) ENGINE = ReplacingMergeTree(event_id)
PARTITION BY toYYYYMM(created_at)
ORDER BY (workspace_id, created_at, event_id)
SETTINGS index_granularity = 8192;
