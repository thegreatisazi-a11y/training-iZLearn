import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore, RoleSelectionRequiredError } from './authStore';
import { api, tokenStore } from '../lib/axios';
import { queryClient } from '../lib/queryClient';

const original = useAuthStore.getState();
const roleUser = (role: string) => ({ id: 'same-user', activeRoleId: role, activeRoleName: role, roleContext: `${role}-context`, permissions: {}, availableRoles: [{ id: role, name: role }] } as any);
beforeEach(() => { localStorage.clear(); queryClient.clear(); });
afterEach(() => { vi.restoreAllMocks(); useAuthStore.setState(original); queryClient.clear(); localStorage.clear(); });

it('clears the same-account cache when role context changes', () => {
  useAuthStore.getState().setUser(roleUser('trainer'));
  queryClient.setQueryData(['schedules'], ['trainer-only']);
  useAuthStore.getState().setUser(roleUser('supervisor'));
  expect(queryClient.getQueryData(['schedules'])).toBeUndefined();
});
it('does not install tokens or a user before role selection is complete', async () => {
  useAuthStore.setState({ user: null });
  vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { requiresRoleSelection: true, roles: [{ id: 'trainer', name: 'Trainer' }, { id: 'supervisor', name: 'Supervisor' }] } } });
  await expect(useAuthStore.getState().login('darshit', 'password')).rejects.toBeInstanceOf(RoleSelectionRequiredError);
  expect(tokenStore.getAccess()).toBeNull(); expect(useAuthStore.getState().user).toBeNull();
});
it('replaces tokens and cached data on a role switch, preserving the refresh token', async () => {
  useAuthStore.getState().setUser(roleUser('trainer'));
  tokenStore.set('old-access', 'refresh-token', 'trainer-context');
  queryClient.setQueryData(['courses'], ['trainer-only']);
  vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { user: roleUser('supervisor'), accessToken: 'new-access' } } });
  await useAuthStore.getState().switchRole('supervisor');
  expect(tokenStore.getRefresh()).toBe('refresh-token'); expect(tokenStore.getAccess()).toBe('new-access');
  expect(useAuthStore.getState().user?.activeRoleId).toBe('supervisor');
  expect(queryClient.getQueryData(['courses'])).toBeUndefined();
});
it('recovers the current role after receiving a stale-role response without replaying a mutation', async () => {
  useAuthStore.getState().setUser(roleUser('trainer')); tokenStore.set('old-access', 'refresh-token');
  const get = vi.spyOn(api, 'get').mockRejectedValueOnce({ response: { status: 409, data: { error: { code: 'ROLE_CHANGED' } } } }).mockResolvedValueOnce({ data: { data: roleUser('supervisor') } });
  const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { data: { accessToken: 'new-access', roleContext: 'supervisor-context' } } });
  await useAuthStore.getState().loadMe();
  expect(get).toHaveBeenCalledTimes(2); expect(post).toHaveBeenCalledWith('/auth/refresh', { refreshToken: 'refresh-token' });
  expect(useAuthStore.getState().user?.activeRoleName).toBe('supervisor');
});
