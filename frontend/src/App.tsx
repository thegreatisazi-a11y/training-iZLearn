import { useEffect } from 'react';
import { ViewportGuard } from './components/layout/ViewportGuard';
import { AppRoutes } from './routes/AppRoutes';
import { PageLoader } from './components/ui/spinner';
import { useAuthStore } from './store/authStore';
import { useSessionStore } from './store/sessionStore';
import { ROLE_CONTEXT_KEY } from './lib/axios';
import { queryClient } from './lib/queryClient';
import { useNavigate } from 'react-router-dom';

export default function App() {
  const loadMe = useAuthStore((s) => s.loadMe);
  const initializing = useAuthStore((s) => s.initializing);
  const setUser = useAuthStore((s) => s.setUser);
  const setLocked = useSessionStore((s) => s.setLocked);
  const roleContext = useAuthStore((s) => s.user?.roleContext);
  const navigate = useNavigate();

  useEffect(() => {
    let syncing = false;
    const onRoleChanged = async () => {
      if (syncing) return;
      syncing = true;
      useAuthStore.setState({ initializing: true });
      await queryClient.cancelQueries();
      queryClient.clear();
      await loadMe();
      navigate('/', { replace: true });
      syncing = false;
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === ROLE_CONTEXT_KEY && event.newValue && event.newValue !== useAuthStore.getState().user?.roleContext) void onRoleChanged();
      if (event.key === ROLE_CONTEXT_KEY && !event.newValue) setUser(null);
    };
    window.addEventListener('izlearn:role-changed', onRoleChanged);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('izlearn:role-changed', onRoleChanged);
      window.removeEventListener('storage', onStorage);
    };
  }, [loadMe, navigate, setUser]);

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

  return <ViewportGuard>{initializing ? <PageLoader /> : <AppRoutes key={roleContext} />}</ViewportGuard>;
}
