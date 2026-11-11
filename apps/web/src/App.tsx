import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/ProtectedRoute';
import { StudioBackdrop } from '@/components/studio-ui/StudioBackdrop';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';

// Lazy-load Monaco + Studio IDE workers ONLY when navigating into `/studio/:projectId`
const StudioPage = lazy(() => import('@/pages/StudioPage'));

function StudioRouteFallback() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-background text-foreground">
      <StudioBackdrop />
      <div className="glass-mirror relative z-10 flex items-center gap-3 rounded-3xl px-7 py-5 font-mono text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
        <span>Loading Studio IDE & Monaco Engine…</span>
      </div>
    </div>
  );
}

/**
 * Global React Query client shared across authenticated workspace views.
 * - `staleTime: 30_000` avoids redundant network bursts during rapid navigation.
 * - `retry: 1` retries transient blips once without stalling error UI states.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/**
 * Top-level client router & global providers (`QueryClientProvider`, `ThemeProvider`, `AuthProvider`).
 * Splits public auth screens (`/login`, `/register`) from authenticated workspace routes (`/`,
 * `/studio/:projectId`) using React Router `<Outlet />` guard layouts.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <Routes>
              <Route element={<PublicOnlyRoute />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
              </Route>

              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<DashboardPage />} />
                <Route
                  path="/studio/:projectId"
                  element={
                    <Suspense fallback={<StudioRouteFallback />}>
                      <StudioPage />
                    </Suspense>
                  }
                />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}