import { query } from '../../shared/db';

export interface WebhookSubscription {
  id: string;
  workspaceId: string;
  callbackUrl: string;
  eventTypes: string[];
  secretKey: string;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

interface WebhookSubscriptionRow {
  id: string;
  workspace_id: string;
  callback_url: string;
  event_types: string[];
  secret_key: string;
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

function toWebhookSubscription(row: WebhookSubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    callbackUrl: row.callback_url,
    eventTypes: row.event_types,
    secretKey: row.secret_key,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SUBSCRIPTION_COLUMNS =
  'id, workspace_id, callback_url, event_types, secret_key, is_active, created_by, created_at, updated_at';

export async function createSubscription(data: {
  workspaceId: string;
  callbackUrl: string;
  eventTypes: string[];
  secretKey: string;
  createdBy: string;
}): Promise<WebhookSubscription> {
  const result = await query<WebhookSubscriptionRow>(
    `INSERT INTO webhook_subscriptions (workspace_id, callback_url, event_types, secret_key, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${SUBSCRIPTION_COLUMNS}`,
    [data.workspaceId, data.callbackUrl, JSON.stringify(data.eventTypes), data.secretKey, data.createdBy],
  );
  return toWebhookSubscription(result.rows[0]);
}

export async function listSubscriptions(workspaceId: string): Promise<WebhookSubscription[]> {
  const result = await query<WebhookSubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM webhook_subscriptions WHERE workspace_id = $1 AND is_active = true`,
    [workspaceId],
  );
  return result.rows.map(toWebhookSubscription);
}

export async function getSubscriptionById(
  webhookId: string,
  workspaceId: string,
): Promise<WebhookSubscription | null> {
  const result = await query<WebhookSubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM webhook_subscriptions WHERE id = $1 AND workspace_id = $2`,
    [webhookId, workspaceId],
  );
  return result.rows[0] ? toWebhookSubscription(result.rows[0]) : null;
}

export async function deleteSubscription(webhookId: string, workspaceId: string): Promise<boolean> {
  const result = await query(
    `DELETE FROM webhook_subscriptions WHERE id = $1 AND workspace_id = $2`,
    [webhookId, workspaceId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getSubscriptionsByEventType(
  workspaceId: string,
  eventType: string,
): Promise<WebhookSubscription[]> {
  const result = await query<WebhookSubscriptionRow>(
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM webhook_subscriptions WHERE workspace_id = $1 AND is_active = true AND event_types @> $2::jsonb`,
    [workspaceId, JSON.stringify([eventType])],
  );
  return result.rows.map(toWebhookSubscription);
}
