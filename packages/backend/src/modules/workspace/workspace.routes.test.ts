import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { createWorkspaceRoutes } from './workspace.routes';
import {
  NotFoundError,
  AuthorizationError,
  ConflictError,
  AppError,
} from '../../shared/errors';

// Mock the workspace service
vi.mock('./workspace.service', () => ({
  create: vi.fn(),
  list: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
  deleteWorkspace: vi.fn(),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  updateMemberRole: vi.fn(),
}));

// Mock RBAC — uses next(err) instead of throw so Express 4 catches it
vi.mock('../../middleware/rbac', () => {
  const H: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
  return {
    requireRole: (min: string) => (req: any, _res: any, next: any) => {
      if (!req.user) return next(Object.assign(new Error('Authentication required'), { statusCode: 401, code: 'AUTHENTICATION_ERROR' }));
      const r: string = req.user.role || 'member';
      if (H[r] < H[min]) return next(Object.assign(new Error('Insufficient permissions'), { statusCode: 403, code: 'AUTHORIZATION_ERROR' }));
      req.user.workspaceId = req.params.id;
      next();
    },
  };
});

import * as workspaceService from './workspace.service';

const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const VALID_USER_UUID = '223e4567-e89b-12d3-a456-426614174001';

function buildApp(userOverride?: { userId: string; role?: string } | null) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (userOverride !== null) {
      req.user = userOverride ?? { userId: VALID_USER_UUID, role: 'owner' };
    }
    next();
  });
  app.use('/api/v1/workspaces', createWorkspaceRoutes());
  // Error handler that handles AppError, mock errors, and unknown errors
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof AppError ? err.statusCode : (err.statusCode || 500);
    const code = err instanceof AppError ? err.code : (err.code || 'INTERNAL_ERROR');
    const msg = err.message || 'An unexpected error occurred';
    res.status(status).json({ success: false, data: null, error: { code, message: msg } });
  });
  return app;
}

describe('Workspace Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/workspaces', () => {
    it('returns 201 with created workspace', async () => {
      const ws = { id: VALID_UUID, name: 'My Workspace', slug: 'my-workspace', ownerId: VALID_USER_UUID, planType: 'free', createdAt: new Date(), updatedAt: new Date() };
      vi.mocked(workspaceService.create).mockResolvedValue(ws);
      const res = await request(buildApp()).post('/api/v1/workspaces').send({ name: 'My Workspace' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('My Workspace');
      expect(workspaceService.create).toHaveBeenCalledWith('My Workspace', VALID_USER_UUID);
    });

    it('returns 400 for missing name', async () => {
      const res = await request(buildApp()).post('/api/v1/workspaces').send({});
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 for empty name', async () => {
      const res = await request(buildApp()).post('/api/v1/workspaces').send({ name: '' });
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/workspaces', () => {
    it('returns 200 with list of workspaces', async () => {
      const list = [{ id: VALID_UUID, name: 'WS', slug: 'ws', ownerId: VALID_USER_UUID, planType: 'free' as const, createdAt: new Date(), updatedAt: new Date() }];
      vi.mocked(workspaceService.list).mockResolvedValue(list);
      const res = await request(buildApp()).get('/api/v1/workspaces');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(workspaceService.list).toHaveBeenCalledWith(VALID_USER_UUID);
    });
  });

  describe('GET /api/v1/workspaces/:id', () => {
    it('returns 200 for member+', async () => {
      const ws = { id: VALID_UUID, name: 'WS', slug: 'ws', ownerId: VALID_USER_UUID, planType: 'free' as const, createdAt: new Date(), updatedAt: new Date() };
      vi.mocked(workspaceService.getById).mockResolvedValue(ws);
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'member' })).get(`/api/v1/workspaces/${VALID_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(VALID_UUID);
    });

    it('returns 400 for invalid UUID param', async () => {
      const res = await request(buildApp()).get('/api/v1/workspaces/not-a-uuid');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 403 for viewer role', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'viewer' })).get(`/api/v1/workspaces/${VALID_UUID}`);
      expect(res.status).toBe(403);
    });

    it('returns 404 when not found', async () => {
      vi.mocked(workspaceService.getById).mockRejectedValue(new NotFoundError('Workspace not found'));
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'member' })).get(`/api/v1/workspaces/${VALID_UUID}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/v1/workspaces/:id', () => {
    it('returns 200 for admin+', async () => {
      const ws = { id: VALID_UUID, name: 'Updated', slug: 'ws', ownerId: VALID_USER_UUID, planType: 'free' as const, createdAt: new Date(), updatedAt: new Date() };
      vi.mocked(workspaceService.update).mockResolvedValue(ws);
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).put(`/api/v1/workspaces/${VALID_UUID}`).send({ name: 'Updated' });
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated');
    });

    it('returns 403 for member role', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'member' })).put(`/api/v1/workspaces/${VALID_UUID}`).send({ name: 'X' });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/workspaces/:id', () => {
    it('returns 200 for owner', async () => {
      vi.mocked(workspaceService.deleteWorkspace).mockResolvedValue(undefined);
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'owner' })).delete(`/api/v1/workspaces/${VALID_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Workspace deleted');
    });

    it('returns 403 for admin role', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).delete(`/api/v1/workspaces/${VALID_UUID}`);
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/workspaces/:id/members', () => {
    it('returns 201 for admin+', async () => {
      const m = { userId: '333e4567-e89b-12d3-a456-426614174002', workspaceId: VALID_UUID, role: 'member' as const, invitedAt: new Date(), acceptedAt: null };
      vi.mocked(workspaceService.addMember).mockResolvedValue(m);
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).post(`/api/v1/workspaces/${VALID_UUID}/members`).send({ email: 'new@example.com', role: 'member' });
      expect(res.status).toBe(201);
      expect(res.body.data.role).toBe('member');
    });

    it('returns 400 for invalid email', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).post(`/api/v1/workspaces/${VALID_UUID}/members`).send({ email: 'bad', role: 'member' });
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid role', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).post(`/api/v1/workspaces/${VALID_UUID}/members`).send({ email: 'a@b.com', role: 'superadmin' });
      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate member', async () => {
      vi.mocked(workspaceService.addMember).mockRejectedValue(new ConflictError('Already a member'));
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).post(`/api/v1/workspaces/${VALID_UUID}/members`).send({ email: 'a@b.com', role: 'member' });
      expect(res.status).toBe(409);
    });

    it('returns 403 for member role', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'member' })).post(`/api/v1/workspaces/${VALID_UUID}/members`).send({ email: 'a@b.com', role: 'member' });
      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/v1/workspaces/:id/members/:userId', () => {
    it('returns 200 for admin+', async () => {
      vi.mocked(workspaceService.removeMember).mockResolvedValue(undefined);
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).delete(`/api/v1/workspaces/${VALID_UUID}/members/${VALID_USER_UUID}`);
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Member removed');
    });

    it('returns 400 for invalid userId param', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).delete(`/api/v1/workspaces/${VALID_UUID}/members/not-a-uuid`);
      expect(res.status).toBe(400);
    });

    it('returns 403 for last owner removal', async () => {
      vi.mocked(workspaceService.removeMember).mockRejectedValue(new AuthorizationError('Cannot remove last owner'));
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'owner' })).delete(`/api/v1/workspaces/${VALID_UUID}/members/${VALID_USER_UUID}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /api/v1/workspaces/:id/members/:userId/role', () => {
    it('returns 200 for admin+', async () => {
      vi.mocked(workspaceService.updateMemberRole).mockResolvedValue(undefined);
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).put(`/api/v1/workspaces/${VALID_UUID}/members/${VALID_USER_UUID}/role`).send({ role: 'admin' });
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Role updated');
    });

    it('returns 400 for invalid role', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'admin' })).put(`/api/v1/workspaces/${VALID_UUID}/members/${VALID_USER_UUID}/role`).send({ role: 'superadmin' });
      expect(res.status).toBe(400);
    });

    it('returns 403 for member role', async () => {
      const res = await request(buildApp({ userId: VALID_USER_UUID, role: 'member' })).put(`/api/v1/workspaces/${VALID_UUID}/members/${VALID_USER_UUID}/role`).send({ role: 'admin' });
      expect(res.status).toBe(403);
    });
  });

  describe('Authentication enforcement', () => {
    it('returns 401 when no user is set on RBAC-protected routes', async () => {
      const res = await request(buildApp(null)).get(`/api/v1/workspaces/${VALID_UUID}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });
});
