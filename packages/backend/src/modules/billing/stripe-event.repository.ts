import { query } from '../../shared/db';

/**
 * Checks if a Stripe event has already been processed (idempotency).
 */
export async function exists(eventId: string): Promise<boolean> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM stripe_events WHERE event_id = $1`,
    [eventId],
  );
  return parseInt(result.rows[0].count, 10) > 0;
}

/**
 * Records a processed Stripe event.
 */
export async function markProcessed(eventId: string, eventType: string): Promise<void> {
  await query(
    `INSERT INTO stripe_events (event_id, event_type, processed_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType],
  );
}
