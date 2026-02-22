# Design — Module 8.1: AI/ML Intelligence (Backend)

## Architecture

```
src/modules/ai/
├── ai.routes.ts          # Route factory
├── ai.controller.ts      # HTTP handlers
├── ai.service.ts         # Business logic + algorithms
├── ai.schemas.ts         # Zod validation
├── ai.repository.ts      # DB: quality_scores
├── field-mapper.ts       # Smart field mapping algorithm
├── similarity.ts         # String similarity utilities (Levenshtein)
```

## Database (Migration 021)

```sql
CREATE TABLE quality_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  record_id UUID NOT NULL,
  confidence_score INTEGER NOT NULL DEFAULT 0,
  freshness_days INTEGER NOT NULL DEFAULT 0,
  field_scores JSONB NOT NULL DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, record_id)
);

CREATE INDEX idx_quality_scores_workspace ON quality_scores(workspace_id);
CREATE INDEX idx_quality_scores_record ON quality_scores(record_id);
```

## API Endpoints

All under `/api/v1/workspaces/:id/ai/`

| Method | Path | Description | Role |
|--------|------|-------------|------|
| POST | /quality/compute | Trigger quality score computation | member |
| GET | /quality/summary | Get workspace quality summary | member |
| GET | /quality/:recordId | Get record quality score | member |
| POST | /field-mapping/suggest | Suggest field mappings for headers | member |
| POST | /duplicates/detect | Fuzzy duplicate detection | member |
| POST | /query | Natural language query → filters | member |
