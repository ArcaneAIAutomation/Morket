import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createToken, findByTokenHash, revokeById, revokeAllForUser } from './token.repository';

const mockQuery = vi.fn();
vi.mock('../../shared/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const now = new Date('2024-01-15T00:00:00Z');
const expiresAt = new Date('2024-01-22T00:00:00Z');

const sampleRow = {
  id: 'tok-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  user_id: 'usr-a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  token_hash: 'sha256hashvalue',
  expires_at: expiresAt,
  revoked_at: null,
  created_at: now,
};

const expectedToken = {
  id: sampleRow.id,
  userId: sampleRow.user_id,
  tokenHash: sampleRow.token_hash,
  expiresAt: expiresAt,
  revokedAt: null,
  createdAt: now,
};

describe('token.repository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('createToken', () => {
    it('inserts a refresh token with parameterized query and returns mapped RefreshToken', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const token = await createToken(sampleRow.user_id, sampleRow.token_hash, expiresAt);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO refresh_tokens');
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(params).toEqual([sampleRow.user_id, sampleRow.token_hash, expiresAt]);
      expect(token).toEqual(expectedToken);
    });
  });

  describe('findByTokenHash', () => {
    it('returns mapped RefreshToken when found (non-revoked, non-expired)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const token = await findByTokenHash('sha256hashvalue');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('WHERE token_hash = $1');
      expect(sql).toContain('revoked_at IS NULL');
      expect(sql).toContain('expires_at > NOW()');
      expect(params).toEqual(['sha256hashvalue']);
      expect(token).toEqual(expectedToken);
    });

    it('returns null when no matching token found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const token = await findByTokenHash('nonexistent');

      expect(token).toBeNull();
    });
  });

  describe('revokeById', () => {
    it('sets revoked_at on the token with parameterized query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await revokeById(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('UPDATE refresh_tokens');
      expect(sql).toContain('SET revoked_at = NOW()');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes all non-revoked tokens for the user', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

      await revokeAllForUser(sampleRow.user_id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('UPDATE refresh_tokens');
      expect(sql).toContain('SET revoked_at = NOW()');
      expect(sql).toContain('WHERE user_id = $1');
      expect(sql).toContain('revoked_at IS NULL');
      expect(params).toEqual([sampleRow.user_id]);
    });
  });
});
