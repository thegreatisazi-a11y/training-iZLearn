/**
 * Restore role permission matrices (and descriptions) from a snapshot produced by
 * atlas-backup.cjs. Use only if the seed's role overwrite needs to be reverted.
 * Restores by roleName (does NOT touch user↔role assignments, users, or any other data).
 *
 * Usage (DATABASE_URL must point at Atlas):
 *   DATABASE_URL="<atlas>" node scripts/atlas-restore-roles.cjs <snapshot.json>
 */
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node atlas-restore-roles.cjs <snapshot.json>');
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(snap.roles) || !snap.roles.length) throw new Error('snapshot has no roles');
  const url = process.env.DATABASE_URL || '';
  if (!/mongodb\+srv|mongodb:\/\//.test(url)) throw new Error('DATABASE_URL not set');

  const prisma = new PrismaClient();
  try {
    for (const r of snap.roles) {
      await prisma.role.update({
        where: { roleName: r.roleName },
        data: { permissions: r.permissions, description: r.description },
      });
      console.log('restored role: ' + r.roleName);
    }
    console.log('ROLE RESTORE OK (' + snap.roles.length + ' roles)');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => { console.error('RESTORE FAILED:', e.message); process.exit(1); });
