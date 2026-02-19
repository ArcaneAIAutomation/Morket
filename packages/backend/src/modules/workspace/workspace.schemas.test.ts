import { describe, it, expect } from 'vitest';
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
  addMemberSchema,
  updateRoleSchema,
  workspaceParamsSchema,
  memberParamsSchema,
} from './workspace.schemas';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('createWorkspaceSchema', () => {
  it('accepts valid name', () => {
    const result = createWorkspaceSchema.safeParse({ name: 'My Workspace' });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = createWorkspaceSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 100 characters', () => {
    const result = createWorkspaceSchema.safeParse({ name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('accepts name at max length (100)', () => {
    const result = createWorkspaceSchema.safeParse({ name: 'a'.repeat(100) });
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = createWorkspaceSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('updateWorkspaceSchema', () => {
  it('accepts valid name', () => {
    const result = updateWorkspaceSchema.safeParse({ name: 'Updated Name' });
    expect(result.success).toBe(true);
  });

  it('accepts empty body (name is optional)', () => {
    const result = updateWorkspaceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects empty string name', () => {
    const result = updateWorkspaceSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name exceeding 100 characters', () => {
    const result = updateWorkspaceSchema.safeParse({ name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe('addMemberSchema', () => {
  it('accepts valid email and role', () => {
    const result = addMemberSchema.safeParse({ email: 'user@example.com', role: 'member' });
    expect(result.success).toBe(true);
  });

  it('accepts admin role', () => {
    const result = addMemberSchema.safeParse({ email: 'user@example.com', role: 'admin' });
    expect(result.success).toBe(true);
  });

  it('accepts viewer role', () => {
    const result = addMemberSchema.safeParse({ email: 'user@example.com', role: 'viewer' });
    expect(result.success).toBe(true);
  });

  it('rejects owner role', () => {
    const result = addMemberSchema.safeParse({ email: 'user@example.com', role: 'owner' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = addMemberSchema.safeParse({ email: 'not-an-email', role: 'member' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid role', () => {
    const result = addMemberSchema.safeParse({ email: 'user@example.com', role: 'superadmin' });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = addMemberSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('updateRoleSchema', () => {
  it.each(['owner', 'admin', 'member', 'viewer'] as const)('accepts %s role', (role) => {
    const result = updateRoleSchema.safeParse({ role });
    expect(result.success).toBe(true);
  });

  it('rejects invalid role', () => {
    const result = updateRoleSchema.safeParse({ role: 'superadmin' });
    expect(result.success).toBe(false);
  });

  it('rejects missing role', () => {
    const result = updateRoleSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('workspaceParamsSchema', () => {
  it('accepts valid UUID', () => {
    const result = workspaceParamsSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID string', () => {
    const result = workspaceParamsSchema.safeParse({ id: 'not-a-uuid' });
    expect(result.success).toBe(false);
  });

  it('rejects missing id', () => {
    const result = workspaceParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('memberParamsSchema', () => {
  it('accepts valid UUIDs for id and userId', () => {
    const result = memberParamsSchema.safeParse({ id: VALID_UUID, userId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID id', () => {
    const result = memberParamsSchema.safeParse({ id: 'bad', userId: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID userId', () => {
    const result = memberParamsSchema.safeParse({ id: VALID_UUID, userId: 'bad' });
    expect(result.success).toBe(false);
  });

  it('rejects missing fields', () => {
    const result = memberParamsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
