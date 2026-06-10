import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';

export function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const { pathname } = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  if (mustChangePassword && pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  return <Outlet />;
}
