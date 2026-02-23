import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from '@/components/shared/ErrorBoundary';
import ToastContainer from '@/components/shared/Toast';
import OfflineBanner from '@/components/shared/OfflineBanner';
import NotFoundPage from '@/components/shared/NotFoundPage';
import LoginForm from '@/components/auth/LoginForm';
import RegisterForm from '@/components/auth/RegisterForm';
import AuthGuard from '@/components/layout/AuthGuard';
import ValidatedWorkspaceRoute from '@/components/layout/ValidatedWorkspaceRoute';
import AppShell from '@/components/layout/AppShell';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

const SpreadsheetView = lazy(() => import('@/components/spreadsheet/SpreadsheetView'));
const JobMonitorView = lazy(() => import('@/components/jobs/JobMonitorView'));
const AnalyticsDashboard = lazy(() => import('@/components/analytics/AnalyticsDashboard'));
const SearchResultsView = lazy(() => import('@/components/search/SearchResultsView'));
const SettingsLayout = lazy(() => import('@/components/settings/SettingsLayout'));
const WorkspaceSettings = lazy(() => import('@/components/settings/WorkspaceSettings'));
const MemberSettings = lazy(() => import('@/components/settings/MemberSettings'));
const CredentialSettings = lazy(() => import('@/components/settings/CredentialSettings'));
const BillingSettings = lazy(() => import('@/components/settings/BillingSettings'));

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
          <Route path="/workspaces/:workspaceId/*" element={<ValidatedWorkspaceRoute />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="spreadsheet" replace />} />
              <Route
                path="spreadsheet"
                element={
                  <Suspense fallback={<LoadingFallback />}>
                    <SpreadsheetView />
                  </Suspense>
                }
              />
              <Route
                path="jobs"
                element={
                  <Suspense fallback={<LoadingFallback />}>
                    <JobMonitorView />
                  </Suspense>
                }
              />
              <Route
                path="analytics"
                element={
                  <Suspense fallback={<LoadingFallback />}>
                    <AnalyticsDashboard />
                  </Suspense>
                }
              />
              <Route
                path="search"
                element={
                  <Suspense fallback={<LoadingFallback />}>
                    <SearchResultsView />
                  </Suspense>
                }
              />
              <Route
                path="settings"
                element={
                  <Suspense fallback={<LoadingFallback />}>
                    <SettingsLayout />
                  </Suspense>
                }
              >
                <Route index element={<Navigate to="workspace" replace />} />
                <Route
                  path="workspace"
                  element={
                    <Suspense fallback={<LoadingFallback />}>
                      <WorkspaceSettings />
                    </Suspense>
                  }
                />
                <Route
                  path="members"
                  element={
                    <Suspense fallback={<LoadingFallback />}>
                      <MemberSettings />
                    </Suspense>
                  }
                />
                <Route
                  path="credentials"
                  element={
                    <Suspense fallback={<LoadingFallback />}>
                      <CredentialSettings />
                    </Suspense>
                  }
                />
                <Route
                  path="billing"
                  element={
                    <Suspense fallback={<LoadingFallback />}>
                      <BillingSettings />
                    </Suspense>
                  }
                />
              </Route>
            </Route>
          </Route>
          {/* Redirect bare /workspaces to AuthGuard which handles workspace selection */}
          <Route path="/workspaces" element={<WorkspaceRedirect />} />
        </Route>

        {/* 404 page for invalid deep link parameters */}
        <Route path="/404" element={<NotFoundPage />} />

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

/**
 * Shared loading spinner for lazy-loaded route Suspense fallbacks.
 */
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    </div>
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
