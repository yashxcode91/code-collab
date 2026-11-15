import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/ProtectedRoute';
import { StudioBackdrop } from '@/components/studio-ui/StudioBackdrop';
import { DashboardPage } from '@/pages/DashboardPage';
import { LandingPage } from '@/pages/LandingPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { RoadmapPage } from '@/pages/RoadmapPage';

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
 * Adaptive Root Route:
 * - Unauthenticated visitors landing on `/` view the public marketing website (`LandingPage`).
 * - Authenticated developers landing on `/` smoothly view their workspace hub (`DashboardPage`).
 */
function AdaptiveRootRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-foreground">
        <StudioBackdrop />
        <div className="glass-mirror relative z-10 flex items-center gap-3 rounded-3xl px-7 py-5 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <span>Verifying session…</span>
        </div>
      </div>
    );
  }
  return user ? <DashboardPage /> : <LandingPage />;
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
 * Splits public marketing & auth screens from protected workspace routes (`/dashboard`,
 * `/studio/:projectId`) using React Router `<Outlet />` guard layouts.
 */
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <Routes>
              {/* Adaptive root route & explicit marketing route */}
              <Route path="/" element={<AdaptiveRootRoute />} />
              <Route path="/landing" element={<LandingPage />} />

              {/* Publicly accessible Roadmap & Architecture portal */}
              <Route path="/roadmap" element={<RoadmapPage />} />

              {/* Public-only authentication gates */}
              <Route element={<PublicOnlyRoute />}>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
              </Route>

              {/* Protected developer workspace routes */}
              <Route element={<ProtectedRoute />}>
                <Route path="/dashboard" element={<DashboardPage />} />
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