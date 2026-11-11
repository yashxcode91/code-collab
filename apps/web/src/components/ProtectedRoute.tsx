import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="font-mono text-xs text-muted-foreground">
        Verifying session…
      </p>
    </div>
  );
}

/** Requires a verified user session; redirects unauthenticated visitors to /login. */
export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullScreenLoader />;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

/** Prevents already-signed-in users from revisiting /login or /register. */
export function PublicOnlyRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullScreenLoader />;
  return user ? <Navigate to="/" replace /> : <Outlet />;
}

