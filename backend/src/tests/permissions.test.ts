import { mergePermissions, hasPermission } from '../utils/permissions';
import type { PermissionMatrix } from '@izlearn/shared';

describe('RBAC permission union (Module 3 / §11.10(g))', () => {
  it('grants access if ANY role allows the module+action', () => {
    const roleA = { assessments: { read: true, write: false, approve: false, print: false, export: false } } as unknown as PermissionMatrix;
    const roleB = { assessments: { read: false, write: true, approve: false, print: false, export: false } } as unknown as PermissionMatrix;
    const merged = mergePermissions([roleA, roleB]);
    expect(hasPermission(merged, 'assessments', 'read')).toBe(true);
    expect(hasPermission(merged, 'assessments', 'write')).toBe(true);
    expect(hasPermission(merged, 'assessments', 'approve')).toBe(false);
  });

  it('denies unknown modules and empty role sets', () => {
    const merged = mergePermissions([]);
    expect(hasPermission(merged, 'userManagement', 'write')).toBe(false);
    expect(hasPermission(undefined, 'reports', 'read')).toBe(false);
  });
});
