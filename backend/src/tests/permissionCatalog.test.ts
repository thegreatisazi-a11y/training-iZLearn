import { deriveLegacyFlags, PERMISSION_CATALOG, CATALOG_BY_MODULE, actionsForModule } from '@izlearn/shared';
import { hasPermission, mergePermissions } from '../utils/permissions';

/** Build a stored module flag set (catalog actions + derived legacy flags). */
function moduleFlags(granted: string[]): Record<string, boolean> {
  const f: Record<string, boolean> = {};
  for (const k of granted) f[k] = true;
  return { ...f, ...deriveLegacyFlags(f) };
}

describe('permission catalog model', () => {
  it('buckets catalog actions into the correct legacy flags', () => {
    expect(deriveLegacyFlags({ view: true })).toMatchObject({ read: true, write: false, approve: false });
    expect(deriveLegacyFlags({ edit: true })).toMatchObject({ read: false, write: true, approve: false });
    expect(deriveLegacyFlags({ approve: true })).toMatchObject({ approve: true, write: false });
    expect(deriveLegacyFlags({ take: true })).toMatchObject({ write: true }); // taking an assessment ⇒ write
    expect(deriveLegacyFlags({ reset_password: true })).toMatchObject({ write: true });
    expect(deriveLegacyFlags({ print: true })).toMatchObject({ print: true, write: false });
    expect(deriveLegacyFlags({ export: true })).toMatchObject({ export: true, write: false });
  });

  it('treats self/display actions as neutral (no privilege escalation)', () => {
    // Acknowledging your own JD must not grant approve or write on the module.
    expect(deriveLegacyFlags({ view: true, acknowledge: true })).toMatchObject({ read: true, write: false, approve: false });
    expect(deriveLegacyFlags({ view: true, configure_widgets: true })).toMatchObject({ read: true, write: false, approve: false });
  });

  it('exposes only real actions per module (no uniform verb grid)', () => {
    // Audit Trail: view/print/export only — never create/edit/archive.
    const audit = actionsForModule('auditTrail');
    expect(audit).toEqual(expect.arrayContaining(['view', 'export']));
    expect(audit).not.toContain('create');
    expect(audit).not.toContain('edit');
    expect(audit).not.toContain('archive');
    // Dashboard: no archive/revise.
    const dash = actionsForModule('dashboard');
    expect(dash).not.toContain('archive');
    expect(dash).not.toContain('revise');
    // Reports: no delete/archive.
    expect(actionsForModule('reports')).not.toContain('archive');
    // Every catalog module belongs to a defined category and has ≥1 action.
    for (const def of PERMISSION_CATALOG) {
      expect(def.actions.length).toBeGreaterThan(0);
      expect(def.category).toBeTruthy();
    }
    expect(CATALOG_BY_MODULE.auditTrail.label).toBe('Audit Trail');
  });

  it('enforces a limited "Audit viewer" role: view yes, export no', () => {
    const perms = { auditTrail: moduleFlags(['view']) } as Record<string, Record<string, boolean>>;
    expect(hasPermission(perms, 'auditTrail', 'view')).toBe(true);
    expect(hasPermission(perms, 'auditTrail', 'read')).toBe(true);
    expect(hasPermission(perms, 'auditTrail', 'export')).toBe(false);
    // No access to a module that was not granted at all.
    expect(hasPermission(perms, 'userManagement', 'view')).toBe(false);
  });

  it('a "Users view, no edit" role can read but not write', () => {
    const perms = { userManagement: moduleFlags(['view']) } as Record<string, Record<string, boolean>>;
    expect(hasPermission(perms, 'userManagement', 'view')).toBe(true);
    expect(hasPermission(perms, 'userManagement', 'write')).toBe(false);
    expect(hasPermission(perms, 'userManagement', 'edit')).toBe(false);
    expect(hasPermission(perms, 'userManagement', 'approve')).toBe(false);
  });

  it('merges permissions across roles (OR of granted actions)', () => {
    const merged = mergePermissions([
      { courseManagement: moduleFlags(['view']) } as never,
      { courseManagement: moduleFlags(['edit']) } as never,
    ]);
    expect(hasPermission(merged, 'courseManagement', 'view')).toBe(true);
    expect(hasPermission(merged, 'courseManagement', 'write')).toBe(true);
  });
});
