import { query } from '../../shared/db';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  planType: 'free' | 'pro' | 'enterprise';
  createdAt: Date;
  updatedAt: Date;
}

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan_type: 'free' | 'pro' | 'enterprise';
  created_at: Date;
  updated_at: Date;
}

function toWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ownerId: row.owner_id,
    planType: row.plan_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Generates a URL-safe slug from a workspace name.
 * Lowercases, replaces spaces/non-alphanumeric with hyphens,
 * collapses consecutive hyphens, trims hyphens, and appends a random suffix.
 */
export function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).substring(2, 8);
  return `${base}-${suffix}`;
}

const WORKSPACE_COLUMNS = 'id, name, slug, owner_id, plan_type, created_at, updated_at';

export async function createWorkspace(
  name: string,
  ownerId: string,
): Promise<Workspace> {
  const slug = generateSlug(name);
  const result = await query<WorkspaceRow>(
    `INSERT INTO workspaces (name, slug, owner_id)
     VALUES ($1, $2, $3)
     RETURNING ${WORKSPACE_COLUMNS}`,
    [name, slug, ownerId],
  );
  return toWorkspace(result.rows[0]);
}

export async function findById(id: string): Promise<Workspace | null> {
  const result = await query<WorkspaceRow>(
    `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = $1`,
    [id],
  );
  return result.rows[0] ? toWorkspace(result.rows[0]) : null;
}

export async function findAllForUser(userId: string): Promise<Workspace[]> {
  const result = await query<WorkspaceRow>(
    `SELECT w.id, w.name, w.slug, w.owner_id, w.plan_type, w.created_at, w.updated_at
     FROM workspaces w
     INNER JOIN workspace_memberships wm ON wm.workspace_id = w.id
     WHERE wm.user_id = $1`,
    [userId],
  );
  return result.rows.map(toWorkspace);
}

export async function updateWorkspace(
  id: string,
  data: { name?: string },
): Promise<Workspace> {
  const result = await query<WorkspaceRow>(
    `UPDATE workspaces SET name = COALESCE($2, name), updated_at = NOW()
     WHERE id = $1
     RETURNING ${WORKSPACE_COLUMNS}`,
    [id, data.name ?? null],
  );
  return toWorkspace(result.rows[0]);
}

export async function deleteWorkspace(id: string): Promise<void> {
  await query('DELETE FROM workspaces WHERE id = $1', [id]);
}
