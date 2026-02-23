import { query } from '../../shared/db';

// --- Quality Scores ---

export interface QualityScore {
  id: string;
  workspaceId: string;
  recordId: string;
  confidenceScore: number;
  freshnessDays: number;
  fieldScores: Record<string, unknown>;
  computedAt: Date;
}

interface QualityScoreRow {
  id: string;
  workspace_id: string;
  record_id: string;
  confidence_score: number;
  freshness_days: number;
  field_scores: Record<string, unknown>;
  computed_at: Date;
}

function toQualityScore(row: QualityScoreRow): QualityScore {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    recordId: row.record_id,
    confidenceScore: row.confidence_score,
    freshnessDays: row.freshness_days,
    fieldScores: row.field_scores,
    computedAt: row.computed_at,
  };
}

export async function upsertQualityScore(
  workspaceId: string,
  recordId: string,
  confidenceScore: number,
  freshnessDays: number,
  fieldScores: Record<string, unknown>,
): Promise<QualityScore> {
  const result = await query<QualityScoreRow>(
    `INSERT INTO quality_scores (workspace_id, record_id, confidence_score, freshness_days, field_scores)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, record_id)
     DO UPDATE SET confidence_score = $3, freshness_days = $4, field_scores = $5, computed_at = NOW()
     RETURNING *`,
    [workspaceId, recordId, confidenceScore, freshnessDays, JSON.stringify(fieldScores)],
  );
  return toQualityScore(result.rows[0]);
}

export async function getQualityScore(
  workspaceId: string,
  recordId: string,
): Promise<QualityScore | null> {
  const result = await query<QualityScoreRow>(
    `SELECT * FROM quality_scores WHERE workspace_id = $1 AND record_id = $2`,
    [workspaceId, recordId],
  );
  return result.rows[0] ? toQualityScore(result.rows[0]) : null;
}

export async function getQualitySummary(workspaceId: string): Promise<{
  totalScored: number;
  avgConfidence: number;
  avgFreshnessDays: number;
  highQuality: number;
  mediumQuality: number;
  lowQuality: number;
}> {
  const result = await query<{
    total: string;
    avg_confidence: string;
    avg_freshness: string;
    high: string;
    medium: string;
    low: string;
  }>(
    `SELECT
       COUNT(*) AS total,
       COALESCE(AVG(confidence_score), 0) AS avg_confidence,
       COALESCE(AVG(freshness_days), 0) AS avg_freshness,
       COUNT(*) FILTER (WHERE confidence_score >= 80) AS high,
       COUNT(*) FILTER (WHERE confidence_score >= 50 AND confidence_score < 80) AS medium,
       COUNT(*) FILTER (WHERE confidence_score < 50) AS low
     FROM quality_scores WHERE workspace_id = $1`,
    [workspaceId],
  );
  const r = result.rows[0];
  return {
    totalScored: parseInt(r.total, 10),
    avgConfidence: Math.round(parseFloat(r.avg_confidence)),
    avgFreshnessDays: Math.round(parseFloat(r.avg_freshness)),
    highQuality: parseInt(r.high, 10),
    mediumQuality: parseInt(r.medium, 10),
    lowQuality: parseInt(r.low, 10),
  };
}

// --- Fuzzy duplicate detection (reads from enrichment_records) ---

export async function fetchRecordsForDuplicateDetection(
  workspaceId: string,
  fields: string[],
  limit: number,
): Promise<Array<{ id: string; values: Record<string, string> }>> {
  // Validate field names to prevent SQL injection — only allow alphanumeric, underscore, hyphen
  const SAFE_FIELD_NAME = /^[a-zA-Z0-9_-]+$/;
  for (const f of fields) {
    if (!SAFE_FIELD_NAME.test(f)) {
      throw new Error(`Invalid field name: ${f}`);
    }
  }

  // Build JSON extraction for requested fields from input_data
  const fieldExpressions = fields
    .map((f) => `'${f}', COALESCE(input_data->>'${f}', '')`)
    .join(', ');

  const result = await query<{ id: string; field_values: Record<string, string> }>(
    `SELECT id, jsonb_build_object(${fieldExpressions}) AS field_values
     FROM enrichment_records
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [workspaceId, limit],
  );

  return result.rows.map((r) => ({ id: r.id, values: r.field_values }));
}

// --- Quality computation helper (reads enrichment_records) ---

export async function fetchRecordsForQualityScoring(
  workspaceId: string,
  limit: number,
): Promise<Array<{ id: string; outputData: Record<string, unknown> | null; updatedAt: Date }>> {
  const result = await query<{ id: string; output_data: Record<string, unknown> | null; updated_at: Date }>(
    `SELECT id, output_data, updated_at FROM enrichment_records WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [workspaceId, limit],
  );
  return result.rows.map((r) => ({ id: r.id, outputData: r.output_data, updatedAt: r.updated_at }));
}
