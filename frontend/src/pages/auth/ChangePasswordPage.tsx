import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { apiError } from '@/lib/axios';
import { toast } from '@/store/uiStore';

export default function ChangePasswordPage() {
  const user = useAuthStore((s) => s.user);
  const mustChangePassword = useAuthStore((s) => s.mustChangePassword);
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // If the user is logged in and doesn't need to change their password, send them home.
  if (user && !mustChangePassword) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) return setError('New passwords do not match.');
    setLoading(true);
    setError('');
    try {
      await svc.auth.changePassword({ currentPassword, newPassword, confirmPassword });
      useAuthStore.setState({ mustChangePassword: false });
      toast.success('Password changed successfully.');
      // Full-page redirect avoids the lazy-Suspense blank flash and resets all state.
      window.location.replace('/');
    } catch (err) {
      setError(apiError(err));
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-slate-500">
            Your password must be changed before continuing. It must contain upper- and lower-case letters, a digit and a special character.
          </p>
          <form onSubmit={submit}>
            <Field label="Current Password">
              <Input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="New Password">
              <Input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Confirm New Password">
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </Field>
            {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
            <Button className="w-full" type="submit" disabled={loading}>
              {loading ? 'Updating…' : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
