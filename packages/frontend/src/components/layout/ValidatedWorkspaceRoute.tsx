import { Navigate, Outlet, useParams } from 'react-router-dom';
import { isValidUUID } from '@/utils/validateParams';

/**
 * Validates the workspaceId route parameter before rendering child routes.
 * Redirects to /404 if the parameter is not a valid UUID v4.
 */
export default function ValidatedWorkspaceRoute() {
  const { workspaceId } = useParams<{ workspaceId: string }>();

  if (!workspaceId || !isValidUUID(workspaceId)) {
    return <Navigate to="/404" replace />;
  }

  return <Outlet />;
}
