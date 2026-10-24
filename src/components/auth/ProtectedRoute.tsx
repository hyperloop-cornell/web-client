import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, sessionChecked, isLoading, checkAuth } = useAuthStore();
  const location = useLocation();

  // A token from an earlier visit is only trusted once /auth/me accepts it and says who it belongs to
  useEffect(() => {
    if (!sessionChecked) checkAuth();
  }, [sessionChecked, checkAuth]);

  if (!sessionChecked || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-2 border-line border-t-fg" />
          <p className="text-sm text-fg-3">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;

  return <>{children}</>;
}
