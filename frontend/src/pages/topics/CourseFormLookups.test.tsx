import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TopicsPage from './TopicsPage';
import TopicDetailPage from './TopicDetailPage';
import { svc } from '@/services';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/components/common/InlineFileViewer', () => ({ InlineFileViewer: () => null }));
vi.mock('@/store/authStore', () => ({ useAuthStore: (select: any) => select({
  user: { id: 'employee', windowsUsername: 'trainer', roleNames: ['Trainee', 'Trainer'] },
  hasPermission: (module: string) => module === 'courseManagement',
}) }));
vi.mock('@/services', () => ({ svc: {
  topics: { list: vi.fn().mockResolvedValue({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }), get: vi.fn().mockResolvedValue({
    id: 'course', title: 'Course to edit', topicCode: 'SOP-1', status: 'DRAFT', trainingType: 'CUSTOM', trainingTypes: ['CUSTOM'],
    currentVersion: 1, designationIds: ['operator'], randomizeQuestions: true, requiresAssessment: true, maxAttempts: 3, passingScorePercent: 80,
  }), formLookups: vi.fn().mockResolvedValue({
    functionalRoles: [{ id: 'operator', displayName: 'Production Operator' }],
    trainingTypes: [{ code: 'CUSTOM', displayName: 'Company Custom Type' }],
    signatories: [{ id: 'reviewer', fullName: 'Quality Reviewer', employeeId: 'EMP-2' }],
  }) },
  users: { list: vi.fn().mockResolvedValue({ data: [] }) }, roles: { list: vi.fn().mockResolvedValue({ data: [] }) },
  materials: { list: vi.fn().mockResolvedValue({ data: [] }) }, questions: { list: vi.fn().mockResolvedValue({ data: [] }) },
  master: { listDesignations: vi.fn(), listTrainingTypes: vi.fn() },
} }));

let root: Root; let container: HTMLDivElement; let client: QueryClient;
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.clearAllMocks(); });
async function settle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }
async function show(edit: boolean) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[edit ? '/courses/course' : '/courses']}><QueryClientProvider client={client}>
      <Routes><Route path="/courses" element={<TopicsPage />} /><Route path="/courses/:id" element={<TopicDetailPage />} /></Routes>
    </QueryClientProvider></MemoryRouter>);
  });
  await settle();
  const label = edit ? 'Edit details' : 'New Topic';
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
  expect(button).toBeTruthy();
  act(() => button!.click());
  await settle();
}

describe('course picker permissions', () => {
  it.each([false, true])('loads functional roles and custom training types for a trainee/trainer (editing=%s)', async (edit) => {
    await show(edit);
    expect(svc.topics.formLookups).toHaveBeenCalled();
    expect(container.textContent).toContain('Production Operator');
    expect(container.textContent).toContain('Company Custom Type');
    expect(svc.master.listDesignations).not.toHaveBeenCalled();
    expect(svc.master.listTrainingTypes).not.toHaveBeenCalled();
    expect(svc.users.list).not.toHaveBeenCalled();
    expect(svc.roles.list).not.toHaveBeenCalled();
    const addSignatory = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Add signatory'));
    expect(addSignatory).toBeTruthy();
    act(() => addSignatory!.click());
    const picker = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-haspopup="listbox"]')).find((button) => button.textContent?.includes('Select user…'));
    expect(picker).toBeTruthy();
    act(() => picker!.click());
    const signatoryOption = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((option) => option.textContent === 'Quality Reviewer (EMP-2)');
    expect(signatoryOption?.textContent).toBe('Quality Reviewer (EMP-2)');
    act(() => signatoryOption!.click());
    expect(picker!.textContent).toContain('Quality Reviewer (EMP-2)');
    const roleLabel = Array.from(container.querySelectorAll('label')).find((label) => label.textContent?.includes('Production Operator'));
    const roleCheckbox = roleLabel!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    if (edit) {
      // The existing course role is retained in the form, even without Master Setup permission.
      expect(roleCheckbox.checked).toBe(true);
    } else {
      expect(roleCheckbox.checked).toBe(false);
      act(() => roleCheckbox.click());
      expect(roleCheckbox.checked).toBe(true);
    }
  });
});
