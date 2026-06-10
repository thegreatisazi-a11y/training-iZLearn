import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useAuthStore, SessionConflictError } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { SessionConflictDialog } from '@/components/auth/SessionConflictDialog';
import { apiError } from '@/lib/axios';

export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState({ open: false, device: '' });

  async function doLogin(terminateExisting = false) {
    setLoading(true);
    setError('');
    try {
      await login(username, password, terminateExisting);
      navigate('/');
    } catch (e) {
      if (e instanceof SessionConflictError) {
        setConflict({ open: true, device: e.deviceInfo });
      } else {
        setError(apiError(e));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-teal-50 p-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center gap-1 text-primary">
          <GraduationCap className="h-10 w-10" />
          <h1 className="text-2xl font-bold">izLearn</h1>
          <p className="text-xs text-slate-500">GxP-Compliant Learning Management System</p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            doLogin(false);
          }}
        >
          {/* onPaste is blocked on both fields — a 21 CFR Part 11 security requirement (Module 1). */}
          <Field label="Windows Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} onPaste={(e) => e.preventDefault()} autoComplete="off" />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onPaste={(e) => e.preventDefault()}
              autoComplete="off"
            />
          </Field>
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading || !username || !password}>
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
      </Card>

      <SessionConflictDialog
        open={conflict.open}
        deviceInfo={conflict.device}
        loading={loading}
        onCancel={() => setConflict({ open: false, device: '' })}
        onConfirm={() => {
          setConflict({ open: false, device: '' });
          doLogin(true);
        }}
      />
    </div>
  );
}
