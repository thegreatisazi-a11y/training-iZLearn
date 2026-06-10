import { useEffect } from 'react';
import { ViewportGuard } from './components/layout/ViewportGuard';
import { AppRoutes } from './routes/AppRoutes';
import { PageLoader } from './components/ui/spinner';
import { useAuthStore } from './store/authStore';
import { useSessionStore } from './store/sessionStore';

export default function App() {
  const loadMe = useAuthStore((s) => s.loadMe);
  const initializing = useAuthStore((s) => s.initializing);
  const setUser = useAuthStore((s) => s.setUser);
  const setLocked = useSessionStore((s) => s.setLocked);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    const onLocked = () => setLocked(true);
    window.addEventListener('izlearn:unauthorized', onUnauthorized);
    window.addEventListener('izlearn:locked', onLocked);
    return () => {
      window.removeEventListener('izlearn:unauthorized', onUnauthorized);
      window.removeEventListener('izlearn:locked', onLocked);
    };
  }, [setUser, setLocked]);

  return <ViewportGuard>{initializing ? <PageLoader /> : <AppRoutes />}</ViewportGuard>;
}
