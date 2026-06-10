import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';
import { useAuthStore } from '@/store/authStore';
import { Button } from '../ui/button';
import { Input, Field } from '../ui/input';
import { apiError } from '@/lib/axios';

/** Lock screen requiring re-authentication (does NOT log the user out). */
export function InactivityLockOverlay() {
  const locked = useSessionStore((s) => s.locked);
  const unlock = useSessionStore((s) => s.unlock);
  const expectedUser = useAuthStore((s) => s.user?.windowsUsername ?? '');
  const [username, setUsername] = useState(expectedUser);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (locked) {
      setUsername(expectedUser);
      setPassword('');
      setError('');
    }
  }, [locked, expectedUser]);

  if (!locked) return null;

  async function submit() {
    setLoading(true);
    setError('');
    try {
      await unlock(username, password);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/85 p-4">
      <div className="iz-card w-full max-w-sm p-6">
        <div className="mb-4 flex items-center gap-2 text-primary">
          <Lock className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-slate-800">Session Locked</h2>
        </div>
        <p className="mb-4 text-sm text-slate-600">Your session was locked due to inactivity. Re-enter your credentials to continue.</p>
        <Field label="User ID">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} autoComplete="off" />
        </Field>
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <Button className="w-full" onClick={submit} disabled={loading || !username || !password}>
          {loading ? 'Unlocking…' : 'Unlock'}
        </Button>
      </div>
    </div>
  );
}
