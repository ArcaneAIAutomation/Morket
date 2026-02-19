import { query } from '../../shared/db';

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

function toRefreshToken(row: RefreshTokenRow): RefreshToken {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

export async function createToken(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<RefreshToken> {
  const result = await query<RefreshTokenRow>(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, token_hash, expires_at, revoked_at, created_at`,
    [userId, tokenHash, expiresAt],
  );
  return toRefreshToken(result.rows[0]);
}

export async function findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
  const result = await query<RefreshTokenRow>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at, created_at
     FROM refresh_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
    [tokenHash],
  );
  return result.rows[0] ? toRefreshToken(result.rows[0]) : null;
}

export async function revokeById(id: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
