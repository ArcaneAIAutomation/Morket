import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireRole, requireObjectOwnership, ROLE_HIERARCHY } from './rbac';
import { AuthenticationError, AuthorizationError } from '../shared/errors';

vi.mock('../shared/db', () => ({
  query: vi.fn(),
}));

import { query } from '../shared/db';

const mockQuery = vi.mocked(query);

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    user: { userId: 'user-1' },
    params: { id: 'workspace-1' },
    baseUrl: '/api/v1/workspaces/workspace-1',
    path: '/data',
    ...overrides,
  } as unknown as Request;
}

const mockRes = {} as Response;
const mockNext: NextFunction = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ROLE_HIERARCHY', () => {
  it('defines correct ordering: viewer < member < admin < owner', () => {
    expect(ROLE_HIERARCHY.viewer).toBeLessThan(ROLE_HIERARCHY.member);
    expect(ROLE_HIERARCHY.member).toBeLessThan(ROLE_HIERARCHY.admin);
    expect(ROLE_HIERARCHY.admin).toBeLessThan(ROLE_HIERARCHY.owner);
  });

  it('includes billing_admin role', () => {
    expect(ROLE_HIERARCHY.billing_admin).toBeDefined();
  });
});

describe('requireRole', () => {
  it('calls next with AuthenticationError when req.user is missing', async () => {
    const middleware = requireRole('member');
    const req = createMockReq({ user: undefined });

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it('calls next with AuthorizationError when user has no membership', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    const middleware = requireRole('member');
    const req = createMockReq();

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthorizationError));
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT role FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2',
      ['user-1', 'workspace-1'],
    );
  });

  it('calls next with AuthorizationError when user role is below minimum', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'viewer' }], rowCount: 1 } as any);
    const middleware = requireRole('admin');
    const req = createMockReq();

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthorizationError));
  });

  it('calls next and sets role/workspaceId when user role meets minimum', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'admin' }], rowCount: 1 } as any);
    const middleware = requireRole('admin');
    const req = createMockReq();

    await middleware(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(req.user!.role).toBe('admin');
    expect(req.user!.workspaceId).toBe('workspace-1');
  });

  it('allows access when user role exceeds minimum', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'owner' }], rowCount: 1 } as any);
    const middleware = requireRole('member');
    const req = createMockReq();

    await middleware(req, mockRes, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(req.user!.role).toBe('owner');
  });

  it('uses workspace ID from req.params.id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 } as any);
    const middleware = requireRole('viewer');
    const req = createMockReq({ params: { id: 'ws-abc' } } as any);

    await middleware(req, mockRes, mockNext);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ['user-1', 'ws-abc'],
    );
    expect(req.user!.workspaceId).toBe('ws-abc');
  });

  it('uses workspace ID from req.params.workspaceId when id is not present', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 } as any);
    const middleware = requireRole('viewer');
    const req = createMockReq({ params: { workspaceId: 'ws-xyz' } } as any);

    await middleware(req, mockRes, mockNext);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      ['user-1', 'ws-xyz'],
    );
    expect(req.user!.workspaceId).toBe('ws-xyz');
  });
});

describe('requireRole - workspace ID cross-check', () => {
  it('rejects when JWT workspaceId does not match URL workspace ID', async () => {
    const middleware = requireRole('member');
    const req = createMockReq({
      user: { userId: 'user-1', workspaceId: 'ws-jwt' },
      params: { id: 'ws-different' },
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthorizationError));
    const error = (mockNext as any).mock.calls[0][0];
    expect(error.message).toBe('Workspace ID mismatch');
  });

  it('allows when JWT workspaceId matches URL workspace ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 } as any);
    const middleware = requireRole('viewer');
    const req = createMockReq({
      user: { userId: 'user-1', workspaceId: 'workspace-1' },
      params: { id: 'workspace-1' },
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    const error = (mockNext as any).mock.calls[0][0];
    expect(error).toBeUndefined();
  });

  it('allows when JWT has no workspaceId (first request before RBAC sets it)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 } as any);
    const middleware = requireRole('viewer');
    const req = createMockReq({
      user: { userId: 'user-1' },
      params: { id: 'workspace-1' },
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    const error = (mockNext as any).mock.calls[0][0];
    expect(error).toBeUndefined();
  });
});

describe('requireRole - billing_admin restriction', () => {
  it('rejects billing_admin on non-billing endpoints', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'billing_admin' }], rowCount: 1 } as any);
    const middleware = requireRole('member');
    const req = createMockReq({
      baseUrl: '/api/v1/workspaces/workspace-1',
      path: '/enrichment',
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthorizationError));
    const error = (mockNext as any).mock.calls[0][0];
    expect(error.message).toContain('billing_admin');
  });

  it('allows billing_admin on billing endpoints', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'billing_admin' }], rowCount: 1 } as any);
    const middleware = requireRole('member');
    const req = createMockReq({
      baseUrl: '/api/v1/workspaces/workspace-1/billing',
      path: '/invoices',
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    const error = (mockNext as any).mock.calls[0][0];
    expect(error).toBeUndefined();
    expect(req.user!.role).toBe('billing_admin');
  });

  it('allows billing_admin on checkout endpoint', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ role: 'billing_admin' }], rowCount: 1 } as any);
    const middleware = requireRole('owner');
    const req = createMockReq({
      baseUrl: '/api/v1/workspaces/workspace-1/billing',
      path: '/checkout',
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    const error = (mockNext as any).mock.calls[0][0];
    expect(error).toBeUndefined();
  });
});

describe('requireObjectOwnership', () => {
  it('calls next with AuthenticationError when req.user is missing', async () => {
    const middleware = requireObjectOwnership(async () => 'workspace-1');
    const req = createMockReq({ user: undefined });

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthenticationError));
  });

  it('calls next with AuthorizationError when no workspace context', async () => {
    const middleware = requireObjectOwnership(async () => 'workspace-1');
    const req = createMockReq({
      user: { userId: 'user-1' },
      params: {},
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthorizationError));
    const error = (mockNext as any).mock.calls[0][0];
    expect(error.message).toBe('Workspace context required');
  });

  it('calls next with AuthorizationError when resource not found', async () => {
    const middleware = requireObjectOwnership(async () => null);
    const req = createMockReq({
      user: { userId: 'user-1', workspaceId: 'workspace-1' },
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthorizationError));
    const error = (mockNext as any).mock.calls[0][0];
    expect(error.message).toBe('Resource not found or access denied');
  });

  it('calls next with AuthorizationError when resource belongs to different workspace', async () => {
    const middleware = requireObjectOwnership(async () => 'other-workspace');
    const req = createMockReq({
      user: { userId: 'user-1', workspaceId: 'workspace-1' },
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.any(AuthorizationError));
    const error = (mockNext as any).mock.calls[0][0];
    expect(error.message).toBe('Resource does not belong to your workspace');
  });

  it('calls next without error when resource belongs to user workspace', async () => {
    const middleware = requireObjectOwnership(async () => 'workspace-1');
    const req = createMockReq({
      user: { userId: 'user-1', workspaceId: 'workspace-1' },
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    const error = (mockNext as any).mock.calls[0][0];
    expect(error).toBeUndefined();
  });

  it('uses workspace ID from params when user workspaceId is not set', async () => {
    const middleware = requireObjectOwnership(async () => 'workspace-1');
    const req = createMockReq({
      user: { userId: 'user-1' },
      params: { id: 'workspace-1' },
    } as any);

    await middleware(req, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    const error = (mockNext as any).mock.calls[0][0];
    expect(error).toBeUndefined();
  });
});
