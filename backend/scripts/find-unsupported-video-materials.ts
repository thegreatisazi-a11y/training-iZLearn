/**
 * Report any training material stored in a video format that is no longer accepted (.avi/.mov).
 *
 * READ-ONLY — this script never writes. Removing those formats from
 * ALLOWED_MATERIAL_EXTENSIONS only blocks NEW uploads; files stored beforehand are still attached
 * to courses, and neither can be shown in the locked in-app viewer, so a trainee assigned one sees
 * the "preview unavailable" panel while the reading clock runs. Anything listed here needs
 * replacing with an .mp4 (via Replace on the material, so the version history is kept).
 *
 * Usage:
 *   npx tsx backend/scripts/find-unsupported-video-materials.ts
 */
import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Same lookup as src/config/env.ts: backend/.env first, then the repo-root .env.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const prisma = new PrismaClient();
const DROPPED = ['avi', 'mov'];

async function main() {
  console.log('\nMaterials in a no-longer-accepted video format (read-only report)\n');

  const materials = await prisma.trainingMaterial.findMany({
    where: { fileType: { in: DROPPED }, isDeleted: false },
    select: {
      id: true,
      originalFileName: true,
      fileType: true,
      topicId: true,
      version: true,
      isCurrentVersion: true,
      isObsolete: true,
    },
  });

  if (!materials.length) {
    console.log('None found — no migration needed.\n');
    return;
  }

  // Name the course each one belongs to; a library file has no topicId.
  const topicIds = [...new Set(materials.map((m) => m.topicId).filter(Boolean))];
  const topics = await prisma.trainingTopic.findMany({
    where: { id: { in: topicIds } },
    select: { id: true, topicCode: true, topicNumber: true, title: true, status: true },
  });
  const byId = new Map(topics.map((t) => [t.id, t]));

  console.log(`${materials.length} found:\n`);
  for (const m of materials) {
    const t = m.topicId ? byId.get(m.topicId) : undefined;
    const where = t ? `${t.topicNumber ?? t.topicCode} – ${t.title} [${t.status}]` : 'Material Library (not attached to a course)';
    const flags = [m.isCurrentVersion ? 'current' : 'superseded', m.isObsolete ? 'obsolete' : null].filter(Boolean).join(', ');
    console.log(`  .${m.fileType}  ${m.originalFileName}  (v${m.version}, ${flags})\n      ${where}`);
  }
  console.log(
    '\nOnly rows marked "current" and not obsolete are still served to trainees; replace those with an .mp4.\n',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
