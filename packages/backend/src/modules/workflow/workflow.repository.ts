import { query } from '../../shared/db';
import { NotFoundError } from '../../shared/errors';

// --- Workflows ---

export interface Workflow {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  currentVersion: number;
  scheduleCron: string | null;
  scheduleEnabled: boolean;
  isTemplate: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface WorkflowRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  current_version: number;
  schedule_cron: string | null;
  schedule_enabled: boolean;
  is_template: boolean;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

function toWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    currentVersion: row.current_version,
    scheduleCron: row.schedule_cron,
    scheduleEnabled: row.schedule_enabled,
    isTemplate: row.is_template,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listWorkflows(workspaceId: string): Promise<Workflow[]> {
  const result = await query<WorkflowRow>(
    `SELECT * FROM workflows WHERE workspace_id = $1 AND is_template = false ORDER BY updated_at DESC`,
    [workspaceId],
  );
  return result.rows.map(toWorkflow);
}

export async function createWorkflow(
  workspaceId: string,
  createdBy: string,
  name: string,
  description: string | null,
): Promise<Workflow> {
  const result = await query<WorkflowRow>(
    `INSERT INTO workflows (workspace_id, created_by, name, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [workspaceId, createdBy, name, description ?? null],
  );
  return toWorkflow(result.rows[0]);
}

export async function getWorkflow(workspaceId: string, workflowId: string): Promise<Workflow | null> {
  const result = await query<WorkflowRow>(
    `SELECT * FROM workflows WHERE id = $1 AND workspace_id = $2`,
    [workflowId, workspaceId],
  );
  return result.rows[0] ? toWorkflow(result.rows[0]) : null;
}

export async function updateWorkflowMeta(
  workflowId: string,
  data: { name?: string; description?: string },
): Promise<void> {
  const sets: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [workflowId];
  let idx = 2;
  if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
  if (data.description !== undefined) { sets.push(`description = $${idx++}`); values.push(data.description); }
  await query(`UPDATE workflows SET ${sets.join(', ')} WHERE id = $1`, values);
}

export async function incrementVersion(workflowId: string): Promise<number> {
  const result = await query<{ current_version: number }>(
    `UPDATE workflows SET current_version = current_version + 1, updated_at = NOW() WHERE id = $1 RETURNING current_version`,
    [workflowId],
  );
  return result.rows[0].current_version;
}

export async function deleteWorkflow(workspaceId: string, workflowId: string): Promise<void> {
  const result = await query(
    `DELETE FROM workflows WHERE id = $1 AND workspace_id = $2`,
    [workflowId, workspaceId],
  );
  if (result.rowCount === 0) throw new NotFoundError('Workflow not found');
}

export async function updateSchedule(
  workflowId: string,
  cron: string | null,
  enabled: boolean,
): Promise<void> {
  await query(
    `UPDATE workflows SET schedule_cron = $2, schedule_enabled = $3, updated_at = NOW() WHERE id = $1`,
    [workflowId, cron, enabled],
  );
}

// --- Templates ---

export async function listTemplates(): Promise<Workflow[]> {
  const result = await query<WorkflowRow>(
    `SELECT * FROM workflows WHERE is_template = true ORDER BY name ASC`,
  );
  return result.rows.map(toWorkflow);
}

export async function getTemplate(templateId: string): Promise<Workflow | null> {
  const result = await query<WorkflowRow>(
    `SELECT * FROM workflows WHERE id = $1 AND is_template = true`,
    [templateId],
  );
  return result.rows[0] ? toWorkflow(result.rows[0]) : null;
}

// --- Versions ---

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  graphDefinition: Record<string, unknown>;
  createdAt: Date;
}

interface VersionRow {
  id: string;
  workflow_id: string;
  version: number;
  graph_definition: Record<string, unknown>;
  created_at: Date;
}

function toVersion(row: VersionRow): WorkflowVersion {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    version: row.version,
    graphDefinition: row.graph_definition,
    createdAt: row.created_at,
  };
}

export async function createVersion(
  workflowId: string,
  version: number,
  graphDefinition: Record<string, unknown>,
): Promise<WorkflowVersion> {
  const result = await query<VersionRow>(
    `INSERT INTO workflow_versions (workflow_id, version, graph_definition)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [workflowId, version, JSON.stringify(graphDefinition)],
  );
  return toVersion(result.rows[0]);
}

export async function listVersions(workflowId: string): Promise<WorkflowVersion[]> {
  const result = await query<VersionRow>(
    `SELECT * FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC`,
    [workflowId],
  );
  return result.rows.map(toVersion);
}

export async function getVersion(workflowId: string, version: number): Promise<WorkflowVersion | null> {
  const result = await query<VersionRow>(
    `SELECT * FROM workflow_versions WHERE workflow_id = $1 AND version = $2`,
    [workflowId, version],
  );
  return result.rows[0] ? toVersion(result.rows[0]) : null;
}

export async function getLatestVersion(workflowId: string): Promise<WorkflowVersion | null> {
  const result = await query<VersionRow>(
    `SELECT * FROM workflow_versions WHERE workflow_id = $1 ORDER BY version DESC LIMIT 1`,
    [workflowId],
  );
  return result.rows[0] ? toVersion(result.rows[0]) : null;
}

// --- Runs ---

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workspaceId: string;
  version: number;
  status: string;
  nodeResults: Record<string, unknown>;
  startedAt: Date;
  completedAt: Date | null;
  errorMessage: string | null;
}

interface RunRow {
  id: string;
  workflow_id: string;
  workspace_id: string;
  version: number;
  status: string;
  node_results: Record<string, unknown>;
  started_at: Date;
  completed_at: Date | null;
  error_message: string | null;
}

function toRun(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workspaceId: row.workspace_id,
    version: row.version,
    status: row.status,
    nodeResults: row.node_results,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorMessage: row.error_message,
  };
}

export async function createRun(
  workflowId: string,
  workspaceId: string,
  version: number,
): Promise<WorkflowRun> {
  const result = await query<RunRow>(
    `INSERT INTO workflow_runs (workflow_id, workspace_id, version, status)
     VALUES ($1, $2, $3, 'running')
     RETURNING *`,
    [workflowId, workspaceId, version],
  );
  return toRun(result.rows[0]);
}

export async function completeRun(
  runId: string,
  status: string,
  nodeResults: Record<string, unknown>,
  errorMessage?: string,
): Promise<void> {
  await query(
    `UPDATE workflow_runs SET status = $2, node_results = $3, error_message = $4, completed_at = NOW() WHERE id = $1`,
    [runId, status, JSON.stringify(nodeResults), errorMessage ?? null],
  );
}

export async function listRuns(
  workflowId: string,
  page: number,
  limit: number,
): Promise<{ runs: WorkflowRun[]; total: number }> {
  const offset = (page - 1) * limit;
  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM workflow_runs WHERE workflow_id = $1`,
    [workflowId],
  );
  const total = parseInt(countResult.rows[0].count, 10);
  const result = await query<RunRow>(
    `SELECT * FROM workflow_runs WHERE workflow_id = $1 ORDER BY started_at DESC LIMIT $2 OFFSET $3`,
    [workflowId, limit, offset],
  );
  return { runs: result.rows.map(toRun), total };
}

export async function getRun(workflowId: string, runId: string): Promise<WorkflowRun | null> {
  const result = await query<RunRow>(
    `SELECT * FROM workflow_runs WHERE id = $1 AND workflow_id = $2`,
    [runId, workflowId],
  );
  return result.rows[0] ? toRun(result.rows[0]) : null;
}
