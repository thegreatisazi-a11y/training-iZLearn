import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './store/authStore';
import { queryClient } from './lib/queryClient';
import { ROLE_CONTEXT_KEY } from './lib/axios';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('./components/layout/ViewportGuard', () => ({ ViewportGuard: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./routes/AppRoutes', () => ({ AppRoutes: () => {
  const role = useAuthStore((state) => state.user?.activeRoleName);
  const [draft, setDraft] = useState('');
  return <div>{role}<input aria-label="Unsaved form" value={draft} onChange={(event) => setDraft(event.target.value)} /></div>;
} }));
const initial = useAuthStore.getState();
let root: Root; let element: HTMLDivElement;
const loadMe = vi.fn();
const user = (name: string) => ({ id: 'user', activeRoleId: name, activeRoleName: name, roleContext: `${name}-context`, permissions: {}, availableRoles: [] } as any);
beforeEach(() => {
  loadMe.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({ user: user('Trainer'), initializing: false, loadMe });
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); queryClient.clear(); useAuthStore.setState(initial); });
async function show() { await act(async () => { root.render(<MemoryRouter initialEntries={['/courses']}><App /></MemoryRouter>); }); }

it('synchronizes a role switched in another tab, clears records and remounts unsaved forms', async () => {
  await show(); queryClient.setQueryData(['courses'], ['Trainer-only data']);
  await act(async () => {
    const input = element.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Old role draft');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(element.querySelector('input')!.value).toBe('Old role draft');
  loadMe.mockImplementation(async () => { useAuthStore.getState().setUser(user('Supervisor')); useAuthStore.setState({ initializing: false }); });
  await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: ROLE_CONTEXT_KEY, newValue: 'Supervisor-context' })); });
  expect(element.textContent).toContain('Supervisor');
  expect(element.querySelector('input')!.value).toBe('');
  expect(queryClient.getQueryData(['courses'])).toBeUndefined();
  expect(loadMe).toHaveBeenCalledTimes(2);
});

it('clears the current account and data when another tab signs out', async () => {
  await show(); queryClient.setQueryData(['courses'], ['Trainer-only data']);
  await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: ROLE_CONTEXT_KEY, newValue: null })); });
  expect(useAuthStore.getState().user).toBeNull();
  expect(queryClient.getQueryData(['courses'])).toBeUndefined();
});
