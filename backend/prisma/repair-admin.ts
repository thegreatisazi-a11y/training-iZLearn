import dotenv from 'dotenv';
import path from 'path';
import { prisma } from '../src/config/prisma';
import { repairBootstrapAdmin } from './repairAdmin';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function main() {
  const id = process.env.REPAIR_BOOTSTRAP_ADMIN_ID;
  if (!id) throw new Error('Set REPAIR_BOOTSTRAP_ADMIN_ID to the exact user ID from setup:audit. No change was made.');
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  await repairBootstrapAdmin(id, username);
  console.log(`Repaired system-role assignment for audited bootstrap account ${id}. Password unchanged.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
