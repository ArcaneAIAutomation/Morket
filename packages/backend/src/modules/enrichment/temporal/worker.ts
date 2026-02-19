/**
 * Temporal worker that registers enrichment workflows and activities.
 *
 * Connects to the Temporal server, registers the enrichment workflow
 * definitions and activity implementations, and polls the
 * `enrichment-tasks` task queue for work.
 *
 * Call `startWorker()` alongside the Express process at application startup.
 *
 * @dependency @temporalio/worker — installed via task 12
 *   (npm install @temporalio/worker)
 */

import { Worker, NativeConnection } from '@temporalio/worker';
import * as activities from './activities';
import { logger } from '../../../shared/logger';

const TASK_QUEUE = 'enrichment-tasks';

/**
 * Create and start a Temporal worker that processes enrichment workflows.
 *
 * The worker registers:
 * - Workflows from `./workflows` (bundled by Temporal's workflow bundler via `workflowsPath`)
 * - Activities: `enrichRecord`, `updateJobStatusActivity`, `deliverWebhookActivity`
 *
 * Connects to the address specified by the `TEMPORAL_ADDRESS` env var
 * (defaults to `localhost:7233`).
 *
 * This function blocks until the worker is shut down (e.g. via SIGTERM).
 */
export async function startWorker(): Promise<Worker> {
  const address = process.env.TEMPORAL_ADDRESS || 'localhost:7233';

  const connection = await NativeConnection.connect({ address });

  const worker = await Worker.create({
    connection,
    namespace: 'default',
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  logger.info('Temporal worker started', { taskQueue: TASK_QUEUE, address });

  // Run the worker — this blocks until the worker is shut down
  await worker.run();

  return worker;
}
