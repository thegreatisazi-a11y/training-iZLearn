import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeRoleName } from '../src/utils/roleIdentity';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
const prisma = new PrismaClient();

async function main() {
  const roles = await prisma.role.findMany({ where: { isDeleted: false } });
  const groups = new Map<string, typeof roles>();
  for (const role of roles) {
    const key = normalizeRoleName(role.roleName);
    groups.set(key, [...(groups.get(key) ?? []), role]);
  }
  for (const [name, group] of groups) {
    if (group.length > 1) console.error(`Duplicate role identity '${name}': ${group.map((r) => `${r.id} (${r.roleName})`).join(', ')}`);
  }
  const systemRoles = roles.filter((r) => r.isSystem);
  const legacyAdminCollision = systemRoles.length === 1 && roles.some((r) =>
    r.id !== systemRoles[0].id && normalizeRoleName(r.roleName) === normalizeRoleName('Super Admin'));
  if (legacyAdminCollision) console.error('A non-system role uses the legacy Super Admin name; review its assignments explicitly.');
  console.log('System roles:', systemRoles.map((r) => ({ id: r.id, name: r.roleName, active: r.isActive })));
  for (const role of roles) {
    const activeAssignments = await prisma.userRole.count({ where: { roleId: role.id, isActive: true } });
    console.log(`Role ${role.id} (${role.roleName}): ${activeAssignments} active assignment(s)`);
  }
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const admin = await prisma.user.findUnique({ where: { windowsUsername: username } });
  if (admin) {
    const links = await prisma.userRole.findMany({ where: { userId: admin.id } });
    console.log('Bootstrap username:', username, 'userId:', admin.id, 'createdBy:', admin.createdBy,
      'active system-role links:', links.filter((l) => l.isActive && systemRoles.some((r) => r.id === l.roleId)).map((l) => l.id));
  } else console.log('Bootstrap username not found:', username);
  if ([...groups.values()].some((g) => g.length > 1) || legacyAdminCollision || systemRoles.length !== 1 || !systemRoles[0].isActive ||
      (admin && !(await prisma.userRole.findFirst({ where: { userId: admin.id, roleId: systemRoles[0].id, isActive: true } })))) {
    throw new Error('Role audit needs operator review; no data was changed.');
  }
  console.log('Role audit passed; no data was changed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
