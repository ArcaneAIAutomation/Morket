import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { requireRole, ROLE_HIERARCHY } from './rbac';
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
});
