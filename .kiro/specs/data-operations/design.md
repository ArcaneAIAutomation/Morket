# Design — Module 8.5: Advanced Data Operations

## Architecture

```
src/modules/data-ops/
├── data-ops.routes.ts        # Route factory
├── data-ops.controller.ts    # HTTP handlers
├── data-ops.service.ts       # Business logic
├── data-ops.schemas.ts       # Zod validation
├── data-ops.repository.ts    # DB: saved_views, record_activity_log
```

## Database (Migration 019)

```sql
CREATE TABLE saved_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  sort_config JSONB NOT NULL DEFAULT '{}',
  column_visibility JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, name)
);

CREATE TABLE record_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  record_id UUID NOT NULL,
  action VARCHAR(50) NOT NULL,
  provider_slug VARCHAR(50),
  fields_changed JSONB,
  performed_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_record_activity_log_record ON record_activity_log(record_id);
CREATE INDEX idx_record_activity_log_workspace ON record_activity_log(workspace_id);
CREATE INDEX idx_saved_views_workspace ON saved_views(workspace_id);
```

## API Endpoints

All under `/api/v1/workspaces/:id/data-ops/`

| Method | Path | Description | Role |
|--------|------|-------------|------|
| POST | /import/preview | Upload CSV, return validation preview | owner |
| POST | /import/commit | Commit previewed import | owner |
| POST | /export | Export records as CSV/JSON | member |
| POST | /dedup/scan | Scan for duplicates | owner |
| POST | /dedup/merge | Merge duplicate groups | owner |
| GET | /hygiene | Data hygiene stats | member |
| POST | /bulk/delete | Bulk delete records | owner |
| POST | /bulk/re-enrich | Bulk re-enrich records | owner |
| GET | /views | List saved views | member |
| POST | /views | Create saved view | member |
| PUT | /views/:viewId | Update saved view | member |
| DELETE | /views/:viewId | Delete saved view | member |
| GET | /activity/:recordId | Get record activity log | member |

## Key Design Decisions

1. Import is two-phase: preview then commit. Preview returns validation results without persisting. Commit uses the same parsed data (stored in-memory with a short TTL keyed by import session ID).

2. Export streams CSV rows to avoid buffering large datasets. JSON export builds array in chunks.

3. Dedup scan returns groups but doesn't auto-merge. The client must explicitly call merge with chosen strategy.

4. Hygiene stats are computed via aggregate SQL queries, not materialized. Acceptable for workspace-scoped data volumes.

5. Activity log is append-only. No updates or deletes on log entries.
