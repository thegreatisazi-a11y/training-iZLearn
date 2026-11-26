import { prisma } from '../config/prisma';

/** Read-only picker data for course authors; does not grant master/user management access. */
export async function getCourseFormLookups() {
  const [functionalRoles, trainingTypes, signatories] = await Promise.all([
    prisma.designationMaster.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
    prisma.trainingTypeMaster.findMany({
      where: { isActive: true, isDeleted: false },
      select: { code: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
    prisma.user.findMany({
      where: { isActive: true, isDeleted: false },
      select: { id: true, fullName: true, employeeId: true },
      orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    }),
  ]);
  return { functionalRoles, trainingTypes, signatories };
}
