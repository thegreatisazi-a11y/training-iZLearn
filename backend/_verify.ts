import { prisma } from './src/config/prisma';
import * as userSvc from './src/services/user.service';

async function main() {
  const HASH_KEYS = ['passwordHash', 'signaturePasswordHash', 'refreshToken'];
  const hasHash = (o: any) => HASH_KEYS.filter((k) => k in (o ?? {}));

  // AUTH-1: listUsers
  const list: any = await userSvc.listUsers({ page: 1, pageSize: 5, sortDir: 'asc' } as any, {} as any);
  const leakList = list.data.flatMap((u: any) => hasHash(u));
  console.log(`AUTH-1 listUsers  → rows=${list.data.length}, leaked hash fields: ${leakList.length ? leakList.join(',') : 'NONE ✅'}`);
  console.log(`         hasSignaturePassword present: ${'hasSignaturePassword' in (list.data[0] ?? {})}`);

  // AUTH-1: getUser
  const firstId = list.data[0]?.id;
  if (firstId) {
    const one: any = await userSvc.getUser(firstId);
    console.log(`AUTH-1 getUser    → leaked: ${hasHash(one).length ? hasHash(one).join(',') : 'NONE ✅'}`);
    const prof: any = await userSvc.getMyProfile(firstId);
    console.log(`AUTH-1 getMyProfile → leaked: ${hasHash(prof).length ? hasHash(prof).join(',') : 'NONE ✅'}, hasSignaturePassword=${prof.hasSignaturePassword}`);
  }

  // ASMT-1: are there non-PUBLISHED topics that the new guard now blocks?
  const byStatus = await prisma.trainingTopic.groupBy({ by: ['status'], _count: true } as any).catch(() => null);
  console.log('ASMT-1 topic status distribution:', JSON.stringify(byStatus));

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
