/**
 * Targeted Atlas backup before a live db push + seed.
 *
 * The seed (prisma/seed.ts) only ever MODIFIES these collections (all via upsert):
 *   - Role                 (permission matrices get overwritten → the real risk)
 *   - DesignationMaster    (functional roles; upsert by code)
 *   - TrainingTypeMaster   (upsert by code)
 *   - SystemConfig         (create-only update {})
 * `prisma db push` on MongoDB is additive (no data dropped). So a full snapshot of
 * these four collections is a complete, restorable backup for this operation.
 *
 * Also records counts of User / UserRole so we can prove no users were lost.
 *
 * Usage (DATABASE_URL must point at Atlas):
 *   DATABASE_URL="<atlas>" node scripts/atlas-backup.cjs <outfile.json>
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: node atlas-backup.cjs <outfile.json>');
  const url = process.env.DATABASE_URL || '';
  const host = (url.match(/@([^/?]+)/) || [])[1] || '(unknown)';
  if (!/mongodb\+srv|mongodb:\/\//.test(url)) throw new Error('DATABASE_URL not set');
  if (/localhost|127\.0\.0\.1/.test(url)) throw new Error('refusing to "backup" localhost — point DATABASE_URL at Atlas');

  const prisma = new PrismaClient();
  try {
    const [roles, designations, trainingTypes, systemConfig, userCount, userRoleCount] = await Promise.all([
      prisma.role.findMany(),
      prisma.designationMaster.findMany(),
      prisma.trainingTypeMaster.findMany(),
      prisma.systemConfig.findMany(),
      prisma.user.count(),
      prisma.userRole.count(),
    ]);
    const snapshot = {
      takenAtHost: host,
      counts: { roles: roles.length, designations: designations.length, trainingTypes: trainingTypes.length, systemConfig: systemConfig.length, users: userCount, userRoles: userRoleCount },
      roles,
      designations,
      trainingTypes,
      systemConfig,
    };
    fs.writeFileSync(out, JSON.stringify(snapshot, null, 2));
    console.log('BACKUP OK host=' + host);
    console.log(JSON.stringify(snapshot.counts));
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error('BACKUP FAILED:', e.message); process.exit(1); });
