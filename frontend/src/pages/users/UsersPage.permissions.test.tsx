import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UsersPage from './UsersPage';
import { useAuthStore } from '@/store/authStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/services', () => ({ svc: {
  users: { list: vi.fn().mockResolvedValue({ data: [{ id: 'employee', fullName: 'Test Employee', employeeId: 'EMP-1', windowsUsername: 'employee', userType: 'INTERNAL', isActive: true }], page: 1, pageSize: 50, total: 1 }) },
  departments: { list: vi.fn().mockResolvedValue({ data: [] }) }, locations: { list: vi.fn().mockResolvedValue({ data: [] }) },
  roles: { list: vi.fn().mockResolvedValue({ data: [] }) }, master: { listDesignations: vi.fn().mockResolvedValue({ data: [] }) },
}, downloadBlob: vi.fn(), filenameFromResponse: vi.fn() }));
let root: Root; let container: HTMLDivElement; let client: QueryClient;
const previous = useAuthStore.getState();
const setPermissions = (approve: boolean, requestApprove = true) => useAuthStore.setState({ user: {
  id: 'viewer', windowsUsername: 'viewer', fullName: 'Viewer', employeeId: 'EMP-0', sessionId: 'session', roleIds: ['role'], roleNames: ['Reviewer'],
  permissions: { userManagement: { view: true, read: true, edit: true, write: true, approve }, userRequests: { approve: requestApprove } },
} as any });
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); useAuthStore.setState(previous); vi.clearAllMocks(); });
async function show(approve: boolean, requestApprove = true) {
  setPermissions(approve, requestApprove);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><QueryClientProvider client={client}><UsersPage /></QueryClientProvider></MemoryRouter>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
const hasDeactivate = () => Array.from(container.querySelectorAll('button')).some((button) => button.textContent?.trim() === 'Deactivate');

describe('Users activation permission', () => {
  it('hides Deactivate when Users approval is false, despite request approval and edit/write rights', async () => {
    await show(false);
    expect(container.textContent).toContain('Test Employee');
    expect(hasDeactivate()).toBe(false);
  });
  it('shows Deactivate when Users approval is true, independently of request approval', async () => {
    await show(true, false);
    expect(hasDeactivate()).toBe(true);
  });
  it('hides Deactivate immediately when the loaded permissions are updated to false', async () => {
    await show(true);
    expect(hasDeactivate()).toBe(true);
    act(() => setPermissions(false));
    expect(hasDeactivate()).toBe(false);
  });
});
