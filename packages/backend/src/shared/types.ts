export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer' | 'billing_admin';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: { userId: string; role?: WorkspaceRole; workspaceId?: string };
    }
  }
}
