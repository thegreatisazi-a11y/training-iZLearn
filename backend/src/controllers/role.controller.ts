import { Request, Response } from 'express';
import { parseTableFormat, sendTableExport } from '../utils/exportTable';
import { getOrgInfo } from '../services/systemConfig.service';
import { recordEvent } from '../services/auditTrail.service';
import { asyncHandler, sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { paginationQuery } from '@izlearn/shared';
import * as svc from '../services/role.service';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const r = await svc.listRoles(q);
  sendPaginated(res, r.data, { page: r.page, pageSize: r.pageSize, total: r.total });
});

/** Export the roles list as CSV or Excel. */
export const exportRoles = asyncHandler(async (req: Request, res: Response) => {
  const q = paginationQuery.parse(req.query);
  const format = parseTableFormat(req.query.format);
  const table = await svc.buildRolesExport(q);
  await recordEvent({ action: 'EXPORT', entityType: 'Role', entityId: 'list', newValue: { format, count: table.rows.length } });
  await sendTableExport(res, table, 'roles', format, req.user!, await getOrgInfo());
});

/** Export ONE role's full permission matrix as CSV or Excel. */
export const exportPermissions = asyncHandler(async (req: Request, res: Response) => {
  const format = parseTableFormat(req.query.format);
  const table = await svc.buildRolePermissionsExport(req.params.id);
  await recordEvent({ action: 'EXPORT', entityType: 'Role', entityId: req.params.id, newValue: { matrix: true, format } });
  await sendTableExport(res, table, `role-permissions-${req.params.id}`, format, req.user!, await getOrgInfo());
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await svc.getRole(req.params.id));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const role = await svc.createRole(req.body, req);
  sendCreated(res, role, 'Role created');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const role = await svc.updateRole(req.params.id, req.body, req);
  sendSuccess(res, role, 'Role updated');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const role = await svc.deactivateRole(req.params.id, req);
  sendSuccess(res, role, 'Role deactivated');
});
