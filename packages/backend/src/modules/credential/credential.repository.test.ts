import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  create,
  findById,
  findAllByWorkspace,
  deleteCredential,
  updateLastUsed,
} from './credential.repository';

const mockQuery = vi.fn();
vi.mock('../../shared/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const now = new Date('2024-01-15T10:00:00Z');

const sampleRow = {
  id: 'cred-1111-2222-3333-444444444444',
  workspace_id: 'ws-aaaa-bbbb-cccc-dddddddddddd',
  provider_name: 'openai',
  encrypted_key: 'base64encryptedkey==',
  encrypted_secret: 'base64encryptedsecret==',
  iv: 'base64iv==',
  auth_tag: 'base64authtag==',
  created_by: 'user-aaaa-bbbb-cccc-dddddddddddd',
  created_at: now,
  last_used_at: null,
};

const expectedCredential = {
  id: sampleRow.id,
  workspaceId: sampleRow.workspace_id,
  providerName: sampleRow.provider_name,
  encryptedKey: sampleRow.encrypted_key,
  encryptedSecret: sampleRow.encrypted_secret,
  iv: sampleRow.iv,
  authTag: sampleRow.auth_tag,
  createdBy: sampleRow.created_by,
  createdAt: now,
  lastUsedAt: null,
};

describe('credential.repository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('create', () => {
    it('inserts with parameterized query and returns mapped ApiCredential', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const cred = await create({
        workspaceId: sampleRow.workspace_id,
        providerName: 'openai',
        encryptedKey: sampleRow.encrypted_key,
        encryptedSecret: sampleRow.encrypted_secret,
        iv: sampleRow.iv,
        authTag: sampleRow.auth_tag,
        createdBy: sampleRow.created_by,
      });

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO api_credentials');
      expect(sql).toContain('$1');
      expect(sql).toContain('$7');
      expect(params).toEqual([
        sampleRow.workspace_id,
        'openai',
        sampleRow.encrypted_key,
        sampleRow.encrypted_secret,
        sampleRow.iv,
        sampleRow.auth_tag,
        sampleRow.created_by,
      ]);
      expect(cred).toEqual(expectedCredential);
    });
  });

  describe('findById', () => {
    it('returns mapped ApiCredential when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const cred = await findById(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
      expect(cred).toEqual(expectedCredential);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const cred = await findById('nonexistent-id');

      expect(cred).toBeNull();
    });
  });

  describe('findAllByWorkspace', () => {
    it('returns all credentials for a workspace', async () => {
      const secondRow = { ...sampleRow, id: 'cred-5555-6666-7777-888888888888', provider_name: 'clearbit' };
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow, secondRow] });

      const creds = await findAllByWorkspace(sampleRow.workspace_id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE workspace_id = $1');
      expect(params).toEqual([sampleRow.workspace_id]);
      expect(creds).toHaveLength(2);
      expect(creds[0]).toEqual(expectedCredential);
      expect(creds[1].providerName).toBe('clearbit');
    });

    it('returns empty array when workspace has no credentials', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const creds = await findAllByWorkspace('empty-workspace-id');

      expect(creds).toEqual([]);
    });
  });

  describe('deleteCredential', () => {
    it('deletes with parameterized query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await deleteCredential(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('DELETE FROM api_credentials');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
    });
  });

  describe('updateLastUsed', () => {
    it('updates last_used_at with NOW() using parameterized query', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await updateLastUsed(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('UPDATE api_credentials');
      expect(sql).toContain('SET last_used_at = NOW()');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
    });
  });
});
