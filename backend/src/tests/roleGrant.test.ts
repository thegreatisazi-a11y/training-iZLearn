import type { PermissionMatrix } from '@izlearn/shared';
import { canDecideUserRequest, canGrantRolePermissions } from '../utils/roleGrant';

const matrix = (scheduling: Record<string, boolean>, other: Record<string, unknown> = {}) =>
  ({ scheduling, ...other }) as PermissionMatrix;

describe('role grant scheduling scope comparison', () => {
  const supervisor = matrix({ view: true, read: true, view_team: true });

  it('allows an all-record administrator to grant team scope without a redundant team flag', () => {
    expect(canGrantRolePermissions(matrix({ view: true, read: true, view_all: true }), [supervisor])).toBe(true);
  });

  it('recognizes all-record scope even when the narrower scope flag is false', () => {
    expect(canGrantRolePermissions(matrix({ view: true, read: true, view_all: true, view_team: false }), [supervisor])).toBe(true);
  });

  it('does not let own-record access grant team scope', () => {
    expect(canGrantRolePermissions(matrix({ view: true, read: true, view_all: false }), [supervisor])).toBe(false);
  });

  it('does not let team scope grant all-record access', () => {
    expect(canGrantRolePermissions(supervisor, [matrix({ view: true, read: true, view_all: true })])).toBe(false);
  });

  it('does not infer unrelated write or module permissions from all-record scope', () => {
    const actor = matrix({ view: true, read: true, view_all: true });
    expect(canGrantRolePermissions(actor, [matrix({ view_team: true, edit: true })])).toBe(false);
    expect(canGrantRolePermissions(actor, [matrix({ view_team: true }, { userManagement: { approve: true } })])).toBe(false);
  });

  it('uses the same scope comparison for eligible request decisions without bypassing approval permission', () => {
    const actor = matrix({ view: true, read: true, view_all: true }, { userRequests: { approve: true } });
    expect(canDecideUserRequest(actor, [supervisor])).toBe(true);
    expect(canDecideUserRequest({ ...actor, userRequests: { approve: false } } as PermissionMatrix, [supervisor])).toBe(false);
  });
});
