/**
 * Temporal client connection factory for enrichment workflows.
 *
 * Provides a singleton Temporal Client and convenience functions to start
 * and cancel enrichment workflows. Implements the {@link TemporalClient}
 * interface expected by enrichment.service.ts.
 *
 * @dependency @temporalio/client — installed via task 12
 *   (npm install @temporalio/client)
 */

import { Connection, Client } from '@temporalio/client';
import type { TemporalClient } from '../enrichment.service';

const TASK_QUEUE = 'enrichment-tasks';

let client: Client | null = null;

/**
 * Return a singleton Temporal Client, creating the connection on first call.
 * Connects to the address specified by TEMPORAL_ADDRESS env var (default localhost:7233).
 */
export async function getTemporalClient(): Promise<Client> {
  if (!client) {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    });
    client = new Client({ connection });
  }
  return client;
}

/**
 * Start an enrichment workflow on the `enrichment-tasks` task queue.
 * Workflow ID is `enrichment-job-{jobId}` to guarantee uniqueness per job.
 */
export async function startEnrichmentWorkflow(jobId: string, input: unknown): Promise<void> {
  const c = await getTemporalClient();
  await c.workflow.start('enrichmentWorkflow', {
    workflowId: `enrichment-job-${jobId}`,
    taskQueue: TASK_QUEUE,
    args: [input],
  });
}

/**
 * Send a cancellation signal to a running enrichment workflow.
 */
export async function cancelEnrichmentWorkflow(jobId: string): Promise<void> {
  const c = await getTemporalClient();
  const handle = c.workflow.getHandle(`enrichment-job-${jobId}`);
  await handle.cancel();
}

/**
 * Object implementing the TemporalClient interface from enrichment.service.ts.
 * Pass this to `setTemporalClient()` at application startup.
 */
export const temporalClient: TemporalClient = {
  startEnrichmentWorkflow,
  cancelEnrichmentWorkflow,
};
