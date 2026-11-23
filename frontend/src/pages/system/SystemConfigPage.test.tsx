import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NotificationSettingsTab } from './SystemConfigPage';

vi.mock('@/services', () => ({ svc: { systemConfig: {
  listNotifications: vi.fn().mockResolvedValue([]), updateNotification: vi.fn(),
} } }));
vi.mock('@/components/common/RichTextEditor', () => ({ RichTextEditor: ({ value, onChange }: any) =>
  <textarea aria-label="Email body" value={value} onChange={(e) => onChange(e.target.value)} /> }));

let container: HTMLDivElement;
let root: Root;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);
  expect(button).toBeTruthy();
  act(() => button!.click());
}

const setting = {
  type: 'accountCreated', module: 'userManagement', moduleLabel: 'Users', label: 'New User Account Created',
  description: 'Welcome message', enabled: true, subject: null, bodyHtml: null,
  defaultSubject: 'Welcome {{username}}', defaultBodyHtml: '<p>Hello {{username}}</p>', variables: ['username'],
};

function show(overrides = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['notif-settings'], [{ ...setting, ...overrides }]);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<QueryClientProvider client={client}><NotificationSettingsTab canWrite /></QueryClientProvider>));
  return client;
}

describe('email template viewing and editing', () => {
  it('shows the built-in content in preview and prefills the editor', () => {
    const client = show();
    click('View template');
    expect(container.textContent).toContain('Hello {{username}}');
    click('Close');
    click('Edit template');
    expect(container.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!.value).toBe('Welcome {{username}}');
    expect(container.querySelector('textarea')!.value).toBe(setting.defaultBodyHtml);
    client.clear();
  });

  it('opens saved custom content rather than the default', () => {
    const client = show({ subject: 'Saved subject', bodyHtml: '<p>Saved message</p>' });
    click('Edit template');
    expect(container.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!.value).toBe('Saved subject');
    expect(container.querySelector('textarea')!.value).toBe('<p>Saved message</p>');
    client.clear();
  });
});
