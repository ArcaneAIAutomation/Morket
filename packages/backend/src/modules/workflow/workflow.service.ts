import * as workflowRepo from './workflow.repository';
import { NotFoundError, ValidationError } from '../../shared/errors';
import type { GraphDefinition } from './workflow.schemas';

// --- Helpers ---

function requireWorkflow(workflow: workflowRepo.Workflow | null): workflowRepo.Workflow {
  if (!workflow) throw new NotFoundError('Workflow not found');
  return workflow;
}

// --- CRUD ---

export async function listWorkflows(workspaceId: string) {
  return workflowRepo.listWorkflows(workspaceId);
}

export async function createWorkflow(
  workspaceId: string,
  createdBy: string,
  data: { name: string; description?: string; graph: GraphDefinition },
) {
  const workflow = await workflowRepo.createWorkflow(workspaceId, createdBy, data.name, data.description ?? null);
  await workflowRepo.createVersion(workflow.id, 1, data.graph as unknown as Record<string, unknown>);
  return { ...workflow, graph: data.graph };
}

export async function getWorkflow(workspaceId: string, workflowId: string) {
  const workflow = requireWorkflow(await workflowRepo.getWorkflow(workspaceId, workflowId));
  const version = await workflowRepo.getLatestVersion(workflowId);
  return { ...workflow, graph: version?.graphDefinition ?? null };
}

export async function updateWorkflow(
  workspaceId: string,
  workflowId: string,
  data: { name?: string; description?: string; graph?: GraphDefinition },
) {
  const workflow = requireWorkflow(await workflowRepo.getWorkflow(workspaceId, workflowId));

  if (data.name || data.description !== undefined) {
    await workflowRepo.updateWorkflowMeta(workflowId, {
      name: data.name,
      description: data.description,
    });
  }

  if (data.graph) {
    const newVersion = await workflowRepo.incrementVersion(workflowId);
    await workflowRepo.createVersion(workflowId, newVersion, data.graph as unknown as Record<string, unknown>);
  }

  return getWorkflow(workspaceId, workflowId);
}

export async function deleteWorkflow(workspaceId: string, workflowId: string) {
  await workflowRepo.deleteWorkflow(workspaceId, workflowId);
}

// --- Versions ---

export async function listVersions(workspaceId: string, workflowId: string) {
  requireWorkflow(await workflowRepo.getWorkflow(workspaceId, workflowId));
  return workflowRepo.listVersions(workflowId);
}

export async function rollback(workspaceId: string, workflowId: string, targetVersion: number) {
  requireWorkflow(await workflowRepo.getWorkflow(workspaceId, workflowId));
  const version = await workflowRepo.getVersion(workflowId, targetVersion);
  if (!version) throw new ValidationError(`Version ${targetVersion} not found`);

  const newVersion = await workflowRepo.incrementVersion(workflowId);
  await workflowRepo.createVersion(workflowId, newVersion, version.graphDefinition);
  return { version: newVersion, rolledBackFrom: targetVersion };
}

// --- Execution ---

export async function executeWorkflow(workspaceId: string, workflowId: string) {
  const workflow = requireWorkflow(await workflowRepo.getWorkflow(workspaceId, workflowId));
  const version = await workflowRepo.getLatestVersion(workflowId);
  if (!version) throw new ValidationError('Workflow has no versions');

  const run = await workflowRepo.createRun(workflowId, workspaceId, workflow.currentVersion);

  // Async execution — in production this would be dispatched to Temporal
  // For now, mark as completed immediately with placeholder results
  setImmediate(async () => {
    try {
      const nodeResults: Record<string, unknown> = {};
      const graph = version.graphDefinition as { nodes?: Array<{ id: string; type: string }> };
      if (graph.nodes) {
        for (const node of graph.nodes) {
          nodeResults[node.id] = { status: 'completed', type: node.type };
        }
      }
      await workflowRepo.completeRun(run.id, 'completed', nodeResults);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await workflowRepo.completeRun(run.id, 'failed', {}, message);
    }
  });

  return { runId: run.id, status: 'running' };
}

export async function listRuns(workspaceId: string, workflowId: string, page: number, limit: number) {
  requireWorkflow(await workflowRepo.getWorkflow(workspaceId, workflowId));
  return workflowRepo.listRuns(workflowId, page, limit);
}

export async function getRun(workspaceId: string, workflowId: string, runId: string) {
  requireWorkflow(await workflowRepo.getWorkflow(workspaceId, workflowId));
  const run = await workflowRepo.getRun(workflowId, runId);
  if (!run) throw new NotFoundError('Workflow run not found');
  return run;
}

// --- Templates ---

export async function listTemplates() {
  return workflowRepo.listTemplates();
}

export async function cloneTemplate(workspaceId: string, templateId: string, createdBy: string) {
  const template = await workflowRepo.getTemplate(templateId);
  if (!template) throw new NotFoundError('Template not found');

  const version = await workflowRepo.getLatestVersion(templateId);
  if (!version) throw new ValidationError('Template has no graph definition');

  const workflow = await workflowRepo.createWorkflow(
    workspaceId,
    createdBy,
    `${template.name} (copy)`,
    template.description,
  );
  await workflowRepo.createVersion(workflow.id, 1, version.graphDefinition);
  return { ...workflow, graph: version.graphDefinition };
}

// --- Schedule ---

export async function updateSchedule(
  workspaceId: string,
  workflowId: string,
  cron: string | null,
  enabled: boolean,
) {
  requireWorkflow(await workflowRepo.getWorkflow(workspaceId, workflowId));
  await workflowRepo.updateSchedule(workflowId, cron, enabled);
  return { scheduleCron: cron, scheduleEnabled: enabled };
}
