import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUser, findByEmail, findById } from './user.repository';

const mockQuery = vi.fn();
vi.mock('../../shared/db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

const now = new Date('2024-01-01T00:00:00Z');

const sampleRow = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  email: 'test@example.com',
  password_hash: '$2b$12$hashedpassword',
  name: 'Test User',
  avatar_url: null,
  created_at: now,
  updated_at: now,
};

const expectedUser = {
  id: sampleRow.id,
  email: sampleRow.email,
  passwordHash: sampleRow.password_hash,
  name: sampleRow.name,
  avatarUrl: null,
  createdAt: now,
  updatedAt: now,
};

describe('user.repository', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('createUser', () => {
    it('inserts a user with parameterized query and returns mapped User', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const user = await createUser('test@example.com', '$2b$12$hashedpassword', 'Test User');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO users');
      expect(sql).toContain('$1');
      expect(sql).toContain('$2');
      expect(sql).toContain('$3');
      expect(params).toEqual(['test@example.com', '$2b$12$hashedpassword', 'Test User']);
      expect(user).toEqual(expectedUser);
    });
  });

  describe('findByEmail', () => {
    it('returns mapped User when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const user = await findByEmail('test@example.com');

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE email = $1');
      expect(params).toEqual(['test@example.com']);
      expect(user).toEqual(expectedUser);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const user = await findByEmail('nobody@example.com');

      expect(user).toBeNull();
    });
  });

  describe('findById', () => {
    it('returns mapped User when found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [sampleRow] });

      const user = await findById(sampleRow.id);

      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('SELECT');
      expect(sql).toContain('WHERE id = $1');
      expect(params).toEqual([sampleRow.id]);
      expect(user).toEqual(expectedUser);
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const user = await findById('nonexistent-id');

      expect(user).toBeNull();
    });
  });
});
