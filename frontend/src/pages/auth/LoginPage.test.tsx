import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { useAuthStore, RoleSelectionRequiredError } from '@/store/authStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let element: HTMLDivElement;
const initial = useAuthStore.getState();
const login = vi.fn();
beforeEach(() => {
  login.mockReset(); useAuthStore.setState({ login });
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(() => { act(() => root.unmount()); element.remove(); useAuthStore.setState(initial); });
async function show() {
  await act(async () => { root.render(<MemoryRouter><LoginPage /></MemoryRouter>); });
  const inputs = element.querySelectorAll('input');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(inputs[0], 'darshit'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], 'password'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() { await act(async () => { element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }

describe('active-role login', () => {
  it('shows no role picker before validating credentials or for single-role login', async () => {
    login.mockResolvedValue(undefined); await show();
    expect(element.querySelector('select')).toBeNull(); await submit();
    expect(login).toHaveBeenCalledWith('darshit', 'password', false, undefined);
    expect(element.querySelector('select')).toBeNull();
  });
  it('displays role choices after credentials pass and submits the selected role', async () => {
    login.mockRejectedValueOnce(new RoleSelectionRequiredError([{ id: 'trainer', name: 'Trainer' }, { id: 'supervisor', name: 'Supervisor' }])).mockResolvedValue(undefined);
    await show(); await submit();
    const select = element.querySelector('select')!;
    expect(select.textContent).toContain('Trainer'); expect(select.textContent).toContain('Supervisor');
    expect(element.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    await act(async () => { select.value = 'supervisor'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await submit();
    expect(login).toHaveBeenLastCalledWith('darshit', 'password', false, 'supervisor');
  });
  it('does not expose role choices on bad credentials', async () => {
    login.mockRejectedValue(new Error('Invalid credentials')); await show(); await submit();
    expect(element.textContent).toContain('Invalid credentials'); expect(element.querySelector('select')).toBeNull();
  });
});
