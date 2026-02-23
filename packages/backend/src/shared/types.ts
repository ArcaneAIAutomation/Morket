import 'express';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer' | 'billing_admin';

declare module 'express' {
  interface Request {
    id: string;
    user?: { userId: string; role?: WorkspaceRole; workspaceId?: string };
  }
}
