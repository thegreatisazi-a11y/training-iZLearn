import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { GraduationCap } from 'lucide-react';
import { useAuthStore, SessionConflictError, RoleSelectionRequiredError } from '@/store/authStore';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { SessionConflictDialog } from '@/components/auth/SessionConflictDialog';
import { apiError } from '@/lib/axios';

export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const location = useLocation();
  const sessionMessage = (location.state as { message?: string } | null)?.message;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [conflict, setConflict] = useState({ open: false, device: '' });
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [activeRoleId, setActiveRoleId] = useState('');

  async function doLogin(terminateExisting = false) {
    setLoading(true);
    setError('');
    try {
      await login(username, password, terminateExisting, activeRoleId || undefined);
      setPassword('');
      navigate('/');
    } catch (e) {
      if (e instanceof RoleSelectionRequiredError) {
        setRoles(e.roles);
        setActiveRoleId('');
      } else if (e instanceof SessionConflictError) {
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
        {sessionMessage && <p className="mb-4 text-sm text-amber-700">{sessionMessage}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            doLogin(false);
          }}
        >
          {/* onPaste is blocked on both fields — a 21 CFR Part 11 security requirement (Module 1). */}
          <Field label="Username" required>
            <Input value={username} onChange={(e) => { setUsername(e.target.value); setRoles([]); setActiveRoleId(''); }} onPaste={(e) => e.preventDefault()} autoComplete="off" />
          </Field>
          <Field label="Password" required>
            <Input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setRoles([]); setActiveRoleId(''); }}
              onPaste={(e) => e.preventDefault()}
              autoComplete="off"
            />
          </Field>
          {roles.length > 1 && <Field label="Sign in as" required>
            <select aria-label="Sign in as" className="mb-3 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm" value={activeRoleId} onChange={(event) => setActiveRoleId(event.target.value)}>
              <option value="">Select your role</option>
              {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select>
          </Field>}
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <Button className="w-full" type="submit" disabled={loading || !username || !password || (roles.length > 1 && !activeRoleId)}>
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
