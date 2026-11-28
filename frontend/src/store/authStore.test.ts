import { afterEach, describe, expect, it } from 'vitest';
import { queryClient } from '../lib/queryClient';
import { useAuthStore, type AuthUser } from './authStore';

const user = (id: string): AuthUser => ({
  id, windowsUsername: id, fullName: id, employeeId: id, sessionId: id,
  roleIds: [], roleNames: [], permissions: {} as AuthUser['permissions'],
  activeRoleId: 'role', activeRoleName: 'Trainer', roleContext: id, availableRoles: [{ id: 'role', name: 'Trainer' }],
});

afterEach(() => {
  useAuthStore.getState().setUser(null);
  queryClient.clear();
});

describe('account-scoped query cache', () => {
  it('clears records when the account changes or signs out', () => {
    useAuthStore.getState().setUser(user('admin'));
    queryClient.setQueryData(['schedules', 1], ['admin-only record']);
    useAuthStore.getState().setUser(user('trainee'));
    expect(queryClient.getQueryData(['schedules', 1])).toBeUndefined();

    queryClient.setQueryData(['ojt-records', 1], ['trainee record']);
    useAuthStore.getState().setUser(null);
    expect(queryClient.getQueryData(['ojt-records', 1])).toBeUndefined();
  });
});
