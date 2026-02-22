import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import ToastContainer from '@/components/shared/Toast';
import OfflineBanner from '@/components/shared/OfflineBanner';
import LoginForm from '@/components/auth/LoginForm';
import RegisterForm from '@/components/auth/RegisterForm';
import AuthGuard from '@/components/layout/AuthGuard';
import AppShell from '@/components/layout/AppShell';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

const AnalyticsDashboard = lazy(() => import('@/components/analytics/AnalyticsDashboard'));
const SearchResultsView = lazy(() => import('@/components/search/SearchResultsView'));

function AppContent() {
  useOnlineStatus();

  return (
    <>
      <OfflineBanner />
      <ToastContainer />
      <Routes>
        <Route path="/login" element={<LoginForm />} />
        <Route path="/register" element={<RegisterForm />} />

        {/* Protected routes */}
        <Route element={<AuthGuard />}>
          <Route path="/workspaces/:workspaceId/*" element={<AppShell />}>
            {/* Nested workspace routes will be added in later tasks */}
            <Route index element={<Navigate to="spreadsheet" replace />} />
            <Route
              path="analytics"
              element={
                <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>}>
                  <AnalyticsDashboard />
                </Suspense>
              }
            />
            <Route
              path="search"
              element={
                <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" /></div>}>
                  <SearchResultsView />
                </Suspense>
              }
            />
          </Route>
          {/* Redirect bare /workspaces to AuthGuard which handles workspace selection */}
          <Route path="/workspaces" element={<WorkspaceRedirect />} />
        </Route>

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

/**
 * Redirects to the last active workspace or shows the AuthGuard workspace creation prompt.
 */
function WorkspaceRedirect() {
  const lastId = localStorage.getItem('morket_lastWorkspaceId');
  if (lastId) {
    return <Navigate to={`/workspaces/${lastId}/spreadsheet`} replace />;
  }
  // AuthGuard will handle the "no workspaces" case
  return <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppContent />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
