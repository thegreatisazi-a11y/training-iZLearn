import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserRequestsPage from './UserRequestsPage';
import { useAuthStore } from '@/store/authStore';
import { svc } from '@/services';
import { toast } from '@/store/uiStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/services', () => ({ svc: { users: {
  listRequests: vi.fn(), checkRequestDecision: vi.fn(), decideRequest: vi.fn(),
} } }));
vi.mock('@/store/uiStore', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/common/ESignatureModal', () => ({ ESignatureModal: ({ open, title }: { open: boolean; title: string }) =>
  open ? <div role="dialog">{title}</div> : null }));

let root: Root; let container: HTMLDivElement; let client: QueryClient;
const previous = useAuthStore.getState();
beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ user: { permissions: { userRequests: { approve: true } } } as any });
  vi.mocked(svc.users.listRequests).mockResolvedValue({ data: [{ id: 'request', fullName: 'New Employee', employeeId: 'EMP-1', windowsUsername: 'employee', status: 'PENDING_APPROVAL' }], total: 1, page: 1, pageSize: 50 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); useAuthStore.setState(previous); });
async function show() {
  await act(async () => { root.render(<QueryClientProvider client={client}><UserRequestsPage /></QueryClientProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}
function button(label: string) {
  const result = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === label);
  if (!result) throw new Error(`Missing ${label} button`);
  return result;
}

describe('user request decision preflight', () => {
  it.each(['Approve', 'Reject'])('shows a permission error before opening e-sign for %s', async (label) => {
    vi.mocked(svc.users.checkRequestDecision).mockRejectedValue(new Error('Requested roles exceed your permissions.'));
    await show();
    await act(async () => { button(label).click(); });
    expect(svc.users.checkRequestDecision).toHaveBeenCalledWith('request', label.toUpperCase());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('Requested roles exceed your permissions.');
    expect(svc.users.decideRequest).not.toHaveBeenCalled();
  });

  it.each(['Approve', 'Reject'])('opens e-sign only after a successful %s check', async (label) => {
    vi.mocked(svc.users.checkRequestDecision).mockResolvedValue({ eligible: true });
    await show();
    await act(async () => { button(label).click(); });
    expect(container.querySelector('[role="dialog"]')?.textContent).toBe(`${label} Request — New Employee`);
    expect(svc.users.decideRequest).not.toHaveBeenCalled();
  });

  it('waits for the response, prevents repeat clicks and fails closed on network errors', async () => {
    let rejectCheck!: (reason: Error) => void;
    vi.mocked(svc.users.checkRequestDecision).mockImplementation(() => new Promise((_resolve, reject) => { rejectCheck = reject; }));
    await show();
    await act(async () => { button('Approve').click(); button('Reject').click(); });
    expect(svc.users.checkRequestDecision).toHaveBeenCalledTimes(1);
    expect(button('Approve').disabled).toBe(true);
    expect(button('Reject').disabled).toBe(true);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { rejectCheck(new Error('Network unavailable')); });
    expect(toast.error).toHaveBeenCalledWith('Network unavailable');
    expect(button('Approve').disabled).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
