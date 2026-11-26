import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MyTrainingsPage from './MyTrainingsPage';
import { svc } from '@/services';

vi.mock('@/services', () => ({ svc: { assignments: { mine: vi.fn() }, retake: { mine: vi.fn().mockResolvedValue([]), create: vi.fn() } } }));
let root: Root; let container: HTMLDivElement; let client: QueryClient;
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.clearAllMocks(); });

async function show(cached?: unknown[]) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30000, gcTime: 0 } } });
  if (cached) client.setQueryData(['my-trainings'], cached);
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><QueryClientProvider client={client}><MyTrainingsPage /></QueryClientProvider></MemoryRouter>);
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

describe('personal assigned trainings', () => {
  it('refreshes a cached empty list when another user has assigned a course', async () => {
    vi.mocked(svc.assignments.mine).mockResolvedValue([{
      id: 'assignment', topicId: 'course', status: 'PENDING', result: null,
      topic: { id: 'course', title: 'Newly Assigned SOP', topicCode: 'SOP-1', currentVersion: 1, trainingType: 'SOP', status: 'PUBLISHED' },
    }] as never);
    await show([]);
    expect(svc.assignments.mine).toHaveBeenCalled();
    expect(container.textContent).toContain('Newly Assigned SOP');
    expect(container.textContent).toContain('Start Training');
  });

  it('shows a loading failure instead of claiming there are no assigned trainings', async () => {
    vi.mocked(svc.assignments.mine).mockRejectedValue(new Error('Server unavailable'));
    await show();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load your assigned trainings');
    expect(container.textContent).not.toContain('You have no assigned trainings.');
  });
});
