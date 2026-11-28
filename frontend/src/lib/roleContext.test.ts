import axios, { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, expect, it, vi } from 'vitest';
import { api, setRequestRoleContext, tokenStore } from './axios';

const original = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = original; tokenStore.clear(); setRequestRoleContext(null); vi.restoreAllMocks(); });

it('binds requests to the displayed role even if another tab replaces the stored token', async () => {
  setRequestRoleContext('trainer-context');
  tokenStore.set('supervisor-token', 'refresh', 'supervisor-context');
  let sent: InternalAxiosRequestConfig | undefined;
  api.defaults.adapter = (async (config) => { sent = config; return { data: {}, status: 200, statusText: 'OK', headers: {}, config }; }) as AxiosAdapter;
  await api.post('/topics', { title: 'Old Trainer form' });
  expect(sent?.headers['X-Role-Context']).toBe('trainer-context');
  expect(sent?.headers.Authorization).toBe('Bearer supervisor-token');
});

it('does not relabel an old action after automatic token refresh', async () => {
  setRequestRoleContext('trainer-context'); tokenStore.set('expired-token', 'refresh');
  vi.spyOn(axios, 'post').mockResolvedValue({ data: { data: { accessToken: 'supervisor-token', roleContext: 'supervisor-context' } } });
  const headers: string[] = []; let attempts = 0;
  api.defaults.adapter = (async (config) => {
    headers.push(String(config.headers['X-Role-Context'])); attempts++;
    const status = attempts === 1 ? 401 : 409;
    const response = { data: { error: { code: attempts === 1 ? 'UNAUTHORIZED' : 'ROLE_CHANGED' } }, status, statusText: 'Rejected', headers: new AxiosHeaders(), config };
    throw new AxiosError('Rejected', 'ERR_BAD_REQUEST', config, undefined, response);
  }) as AxiosAdapter;
  await expect(api.post('/topics', { title: 'Old Trainer form' })).rejects.toMatchObject({ response: { status: 409 } });
  expect(headers).toEqual(['trainer-context', 'trainer-context']);
});

it('refreshes an expired access token when switching roles without asking for credentials again', async () => {
  setRequestRoleContext('trainer-context'); tokenStore.set('expired-token', 'refresh');
  const refresh = vi.spyOn(axios, 'post').mockResolvedValue({ data: { data: { accessToken: 'refreshed-trainer-token' } } });
  let attempts = 0;
  api.defaults.adapter = (async (config) => {
    attempts++;
    expect(config.headers['X-Role-Context']).toBe('trainer-context');
    if (attempts === 1) throw new AxiosError('Expired', 'ERR_BAD_REQUEST', config, undefined, { data: {}, status: 401, statusText: 'Expired', headers: {}, config });
    expect(config.headers.Authorization).toBe('Bearer refreshed-trainer-token');
    return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
  }) as AxiosAdapter;
  await expect(api.post('/auth/switch-role', { activeRoleId: 'supervisor' })).resolves.toMatchObject({ status: 200 });
  expect(refresh).toHaveBeenCalledWith(expect.stringContaining('/auth/refresh'), { refreshToken: 'refresh' });
  expect(attempts).toBe(2);
});
