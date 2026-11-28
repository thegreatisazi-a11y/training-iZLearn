import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Topbar } from './Topbar';
import { useAuthStore } from '@/store/authStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let element: HTMLDivElement;
const initial = useAuthStore.getState(); const switchRole = vi.fn();
beforeEach(() => {
  switchRole.mockReset().mockResolvedValue(undefined);
  useAuthStore.setState({ user: { fullName: 'Darshit Shah', activeRoleId: 'trainer', activeRoleName: 'Trainer', availableRoles: [{ id: 'trainer', name: 'Trainer' }, { id: 'supervisor', name: 'Supervisor' }] } as any, switchRole });
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); useAuthStore.setState(initial); });
async function show() { await act(async () => { root.render(<MemoryRouter><Topbar /></MemoryRouter>); }); }
it('shows the active role and offers only the other assigned role', async () => {
  await show();
  expect(element.textContent).toContain('Trainer');
  await act(async () => { element.querySelector<HTMLButtonElement>('[aria-label="Switch active role"]')!.click(); });
  const menu = element.querySelector('[aria-label="Available roles"]')!;
  expect(menu.textContent).toBe('Supervisor');
  await act(async () => { menu.querySelector('button')!.click(); });
  expect(switchRole).toHaveBeenCalledWith('supervisor');
});
it('does not offer switching for a single-role account', async () => {
  const user = useAuthStore.getState().user!;
  useAuthStore.setState({ user: { ...user, availableRoles: [user.availableRoles[0]] } });
  await show();
  expect(element.querySelector<HTMLButtonElement>('[aria-label="Switch active role"]')!.disabled).toBe(true);
});
