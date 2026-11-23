import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BackupsPage from './BackupsPage';
import { svc } from '@/services';

const permissions = vi.hoisted(() => ({ restore: true }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.mock('@/store/authStore', () => ({ useAuthStore: (selector: any) => selector({ hasPermission: (_module: string, action: string) => action === 'approve' && permissions.restore }) }));
vi.mock('@/services', () => ({ svc: { admin: {
  backups: vi.fn(), uploadBackup: vi.fn(), triggerBackup: vi.fn(), verifyBackup: vi.fn(), restoreBackup: vi.fn(),
  inspectBackup: vi.fn().mockResolvedValue({ compatible: true,
    manifest: { createdAt: '2026-11-23T00:00:00Z', appVersion: 'test-release', storageDriver: 'local', filesCount: 3 } }),
} } }));
vi.mock('@/components/common/ESignatureModal', () => ({ ESignatureModal: () => null }));

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); });

function show(canRestore: boolean) {
  permissions.restore = canRestore;
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['backups'], { items: [{ file: 'backup.tar.gz', sizeBytes: 10, createdAt: '2026-11-23T00:00:00Z', destination: 'local' }],
    jobs: [], fileStorage: 'local', backupStorage: 'local', restoreEnabled: false });
  container = document.createElement('div'); document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<QueryClientProvider client={client}><BackupsPage /></QueryClientProvider>));
}

describe('backup recovery controls', () => {
  it('shows upload and restore based on permission, regardless of the obsolete environment flag', () => {
    show(true);
    const buttons = [...container.querySelectorAll('button')].map((button) => button.textContent?.trim());
    expect(buttons).toContain('Upload backup');
    expect(buttons).toContain('Restore');
    expect(container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe('.tar.gz');
  });

  it('hides recovery actions from users without the permission', () => {
    show(false);
    const buttons = [...container.querySelectorAll('button')].map((button) => button.textContent?.trim());
    expect(buttons).not.toContain('Upload backup');
    expect(buttons).not.toContain('Restore');
    expect(container.querySelector('input[type="file"]')).toBeNull();
  });

  it('allows selecting a backup larger than the previous 2 GB cap', async () => {
    show(true);
    const file = new File(['test'], 'large-backup.tar.gz', { type: 'application/gzip' });
    Object.defineProperty(file, 'size', { value: 3 * 1024 ** 3 });
    vi.mocked(svc.admin.uploadBackup).mockResolvedValue({ valid: true });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(svc.admin.uploadBackup).toHaveBeenCalledWith(file, expect.any(Function));
  });
});
