import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/context/AuthContext';
import { ThemeProvider } from '@/context/ThemeContext';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/ProtectedRoute';
import { DashboardPage } from '@/pages/DashboardPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { StudioPlaceholderPage } from '@/pages/StudioPlaceholderPage';

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
                  element={<StudioPlaceholderPage />}
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
