import { type Client } from 'pg';

export async function up(client: Client): Promise<void> {
  await client.query(`
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
  `);

  await client.query(`
    CREATE TABLE workflow_versions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      graph_definition JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(workflow_id, version)
    );
  `);

  await client.query(`
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
  `);

  await client.query(`CREATE INDEX idx_workflows_workspace ON workflows(workspace_id);`);
  await client.query(`CREATE INDEX idx_workflow_versions_workflow ON workflow_versions(workflow_id);`);
  await client.query(`CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);`);
  await client.query(`CREATE INDEX idx_workflow_runs_workspace ON workflow_runs(workspace_id);`);
}

export async function down(client: Client): Promise<void> {
  await client.query(`DROP TABLE IF EXISTS workflow_runs;`);
  await client.query(`DROP TABLE IF EXISTS workflow_versions;`);
  await client.query(`DROP TABLE IF EXISTS workflows;`);
}
