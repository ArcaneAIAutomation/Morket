# Design — Module 8.2: Visual Workflow Builder (Backend)

## Architecture

```
src/modules/workflow/
├── workflow.routes.ts        # Route factory
├── workflow.controller.ts    # HTTP handlers
├── workflow.service.ts       # Business logic
├── workflow.schemas.ts       # Zod validation
├── workflow.repository.ts    # DB: workflows, workflow_versions, workflow_runs
```

## Database (Migration 020)

```sql
CREATE TABLE workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  schedule_cron VARCHAR(100),
  schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  is_template BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  graph_definition JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_id, version)
);

CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  node_results JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);
CREATE INDEX idx_workflow_versions_workflow ON workflow_versions(workflow_id);
CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_workspace ON workflow_runs(workspace_id);
```

## API Endpoints

All under `/api/v1/workspaces/:id/workflows`

| Method | Path | Description | Role |
|--------|------|-------------|------|
| GET | / | List workflows | member |
| POST | / | Create workflow | owner |
| GET | /:workflowId | Get workflow + current version | member |
| PUT | /:workflowId | Update workflow (creates new version) | owner |
| DELETE | /:workflowId | Delete workflow | owner |
| GET | /:workflowId/versions | List versions | member |
| POST | /:workflowId/rollback | Rollback to version | owner |
| POST | /:workflowId/execute | Execute workflow | member |
| GET | /:workflowId/runs | List runs | member |
| GET | /:workflowId/runs/:runId | Get run details | member |
| GET | /templates | List templates | member |
| POST | /templates/:templateId/clone | Clone template | owner |
| PUT | /:workflowId/schedule | Update schedule | owner |
