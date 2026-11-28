import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditTrailPage from './AuditTrailPage';
import { useAuthStore } from '@/store/authStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('@/services', () => {
  const list = vi.fn(async () => ({ data: [] }));
  const base = { timestamp: '2026-11-27T09:00:00Z', userUsername: 'darshit', userFullName: 'Darshit Shah', action: 'LOGIN', entityType: 'User', entityId: null, reasonForChange: null };
  return { svc: {
    users: { list }, departments: { list }, locations: { list }, topics: { list }, roles: { list }, master: { listDesignations: list },
    audit: { list: vi.fn(async () => ({ data: [{ ...base, id: 'new', activeRoleName: 'Trainer', entityLabel: 'A long course record name that should wrap onto multiple lines instead of being truncated' }, { ...base, id: 'old', activeRoleName: null }], total: 2, page: 1, pageSize: 50 })) },
  }, downloadBlob: vi.fn(), filenameFromResponse: vi.fn() };
});
const initial = useAuthStore.getState();
let cleanup = () => {};
afterEach(() => { cleanup(); useAuthStore.setState(initial); });
it('displays the role beneath the username in one column, including the unavailable label for old rows', async () => {
  useAuthStore.setState({ user: { permissions: { auditTrail: { view: true } } } as any });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = document.createElement('div'); document.body.append(element); const root = createRoot(element);
  cleanup = () => { act(() => root.unmount()); element.remove(); client.clear(); };
  await act(async () => { root.render(<QueryClientProvider client={client}><AuditTrailPage /></QueryClientProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  const headers = Array.from(element.querySelectorAll('th')).map((header) => header.textContent);
  expect(headers).toContain('User / Active Role');
  expect(headers).not.toContain('Active Role');
  const userCells = Array.from(element.querySelectorAll('tbody tr')).map((row) => row.querySelectorAll('td')[1]);
  expect(userCells[0].textContent).toBe('darshitAs Trainer');
  expect(userCells[0].querySelector('.text-xs')?.textContent).toBe('As Trainer');
  expect(userCells[1].textContent).toBe('darshitRole context unavailable');
});
