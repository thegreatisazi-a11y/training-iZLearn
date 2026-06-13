/**
 * Safe 8 -> 4 role reassignment migration (D6).
 *
 * Legacy roles:  SUPER_ADMIN, QA_ADMIN, DEPARTMENT_HEAD, TRAINING_COORDINATOR,
 *                TRAINER, TRAINEE, IT_ADMIN, AUDITOR
 * Target roles:  SUPER_ADMIN, SUPERVISOR, TRAINER, TRAINEE
 *
 * What it does (idempotent, dry-run by default):
 *   1. Verifies the 4 target roles exist (run `npm run seed` first — seed is
 *      additive and upserts the 4 targets; it never deletes the legacy roles).
 *   2. For every active UserRole pointing at a legacy role, ensures the user has
 *      the MAPPED target role (creates/reactivates a UserRole), then deactivates
 *      the legacy UserRole. Users are never left without an active role, so login
 *      access is preserved throughout.
 *   3. Soft-deactivates the obsolete legacy Role records (isActive=false,
 *      isDeleted=true) so they disappear from pickers but remain for audit.
 *
 * SAFETY:
 *   - Nothing is hard-deleted. UserRole rows are deactivated, not removed.
 *   - Runs as a DRY RUN unless `--apply` is passed. Always take an Atlas backup
 *     (see docs/MIGRATION_2026-06-13.md) before running with --apply.
 *
 * Usage:
 *   npx ts-node backend/scripts/migrate-roles-8-to-4.ts          # dry run
 *   npx ts-node backend/scripts/migrate-roles-8-to-4.ts --apply  # write
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const SYSTEM = 'ROLE_MIGRATION';

/** Legacy role name -> target role name. SUPER_ADMIN/TRAINER/TRAINEE are unchanged. */
const ROLE_MAP: Record<string, string> = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  IT_ADMIN: 'SUPERVISOR', // remapped to SUPERVISOR (no new full-access admins)
  QA_ADMIN: 'SUPERVISOR',
  DEPARTMENT_HEAD: 'SUPERVISOR',
  TRAINING_COORDINATOR: 'SUPERVISOR',
  AUDITOR: 'SUPERVISOR', // audit/report visibility lives on SUPERVISOR
  TRAINER: 'TRAINER',
  TRAINEE: 'TRAINEE',
};

const TARGET_NAMES = Array.from(new Set(Object.values(ROLE_MAP)));

async function main() {
  console.log(`\n=== 8->4 role migration (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const roles = await prisma.role.findMany();
  const byName = new Map(roles.map((r) => [r.roleName, r]));

  // 1. Verify targets exist.
  const missing = TARGET_NAMES.filter((n) => !byName.has(n));
  if (missing.length) {
    console.error(`Target roles missing: ${missing.join(', ')}. Run \`npm run seed\` first, then re-run.`);
    process.exit(1);
  }

  let reassigned = 0;
  let skipped = 0;

  // 2. Reassign user-role memberships.
  for (const legacyName of Object.keys(ROLE_MAP)) {
    const targetName = ROLE_MAP[legacyName];
    if (legacyName === targetName) continue; // identity mapping — nothing to move
    const legacy = byName.get(legacyName);
    const target = byName.get(targetName)!;
    if (!legacy) continue;

    const memberships = await prisma.userRole.findMany({
      where: { roleId: legacy.id, isActive: true },
    });
    console.log(`${legacyName} -> ${targetName}: ${memberships.length} active membership(s)`);

    for (const m of memberships) {
      const existingTarget = await prisma.userRole.findFirst({
        where: { userId: m.userId, roleId: target.id },
      });
      if (APPLY) {
        if (existingTarget) {
          if (!existingTarget.isActive) {
            await prisma.userRole.update({ where: { id: existingTarget.id }, data: { isActive: true } });
          }
        } else {
          await prisma.userRole.create({
            data: { userId: m.userId, roleId: target.id, assignedBy: SYSTEM },
          });
        }
        await prisma.userRole.update({ where: { id: m.id }, data: { isActive: false } });
      }
      existingTarget && existingTarget.isActive ? skipped++ : reassigned++;
    }
  }

  // 3. Soft-deactivate obsolete legacy roles.
  const obsolete = roles.filter((r) => !TARGET_NAMES.includes(r.roleName) && ROLE_MAP[r.roleName]);
  for (const r of obsolete) {
    console.log(`deactivate legacy role: ${r.roleName}`);
    if (APPLY) {
      await prisma.role.update({ where: { id: r.id }, data: { isActive: false, isDeleted: true } });
    }
  }

  // 4. Safety net — confirm no active user lost all roles.
  const orphans = await prisma.user.findMany({
    where: { isActive: true, isDeleted: false },
    select: { id: true, windowsUsername: true },
  });
  let orphanCount = 0;
  for (const u of orphans) {
    const active = await prisma.userRole.count({ where: { userId: u.id, isActive: true } });
    if (active === 0) {
      orphanCount++;
      console.warn(`  ⚠ user ${u.windowsUsername} has NO active role after migration`);
    }
  }

  console.log(`\nSummary: ${reassigned} reassigned, ${skipped} already-had-target, ${obsolete.length} legacy roles deactivated, ${orphanCount} orphaned users.`);
  console.log(APPLY ? '\n✅ Applied.\n' : '\nDry run only — re-run with --apply to write changes.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
