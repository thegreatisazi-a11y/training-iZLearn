/**
 * izLearn database seed — bootstraps the baseline GMP data set:
 *   - System configuration defaults
 *   - The 8 default RBAC roles with permission matrices
 *   - A default Location + Department
 *   - The first SUPER_ADMIN user
 *
 * Run with: npm run seed  (or: npx prisma db seed)
 *
 * NOTE: the seed intentionally uses a bare PrismaClient (no audit middleware)
 * because it is a one-time bootstrap that runs before any user exists. Every
 * record is stamped createdBy = 'SYSTEM'.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { DEFAULT_SYSTEM_CONFIG, PERMISSION_MODULES, deriveLegacyFlags, type PermissionModule } from '@izlearn/shared';

const prisma = new PrismaClient();

const BCRYPT_COST = 12;
const SYSTEM = 'SYSTEM';

/** Legacy-style override authored per role; expanded to the 10 granular verbs below. */
type LegacyOverride = { read?: boolean; write?: boolean; approve?: boolean; print?: boolean; export?: boolean };
type Flags = Record<string, boolean>;

/**
 * Expand a legacy override into the full 10-verb set, then append the derived
 * legacy keys. write → create/edit/archive/revise/assign; approve → review/approve.
 */
function expand(o: LegacyOverride): Flags {
  const w = !!o.write;
  const a = !!o.approve;
  const flags: Flags = {
    view: !!o.read,
    create: w,
    edit: w,
    archive: w,
    revise: w,
    assign: w,
    review: a,
    approve: a,
    print: !!o.print,
    export: !!o.export,
  };
  return { ...flags, ...deriveLegacyFlags(flags) };
}

/** Build a permission matrix: every module all-false, then overrides applied + expanded. */
function buildPermissions(overrides: Partial<Record<PermissionModule, LegacyOverride>>): Record<string, Flags> {
  const o = { ...overrides } as Partial<Record<PermissionModule, LegacyOverride>>;
  // New modules default from their closest functional sibling unless explicitly set.
  if (o.topicVersionHistory === undefined && o.courseManagement) {
    o.topicVersionHistory = { read: o.courseManagement.read, print: o.courseManagement.print, export: o.courseManagement.export, approve: o.courseManagement.approve };
  }
  if (o.trainingAssignment === undefined && o.scheduling) o.trainingAssignment = o.scheduling;
  const all: Record<string, Flags> = {};
  for (const mod of PERMISSION_MODULES) all[mod] = expand(o[mod] ?? {});
  return all;
}

const FULL: LegacyOverride = { read: true, write: true, approve: true, print: true, export: true };
const RWPE: LegacyOverride = { read: true, write: true, print: true, export: true };
const READ: LegacyOverride = { read: true };
const READ_PRINT_EXPORT: LegacyOverride = { read: true, print: true, export: true };

function allFull(): Record<string, Flags> {
  const all: Record<string, Flags> = {};
  for (const mod of PERMISSION_MODULES) all[mod] = expand(FULL);
  return all;
}

const ROLE_DEFINITIONS: { roleName: string; description: string; permissions: Record<string, Flags> }[] = [
  {
    roleName: 'SUPER_ADMIN',
    description: 'Full, unrestricted access to every module.',
    permissions: allFull(),
  },
  {
    roleName: 'QA_ADMIN',
    description: 'Quality Assurance administrator — approvals, audit trail, reports.',
    permissions: buildPermissions({
      dashboard: READ,
      userManagement: { read: true, write: true, approve: true },
      roleManagement: READ,
      masterSetup: { read: true, write: true },
      courseManagement: { ...RWPE, approve: true },
      bundleManagement: { ...RWPE, approve: true },
      materialManagement: RWPE,
      jobDescription: { ...RWPE, approve: true },
      tni: { ...RWPE, approve: true },
      scheduling: RWPE,
      attendance: RWPE,
      assessments: { ...RWPE, approve: true },
      questionBank: RWPE,
      certificates: READ_PRINT_EXPORT,
      feedback: READ_PRINT_EXPORT,
      announcements: { read: true, write: true },
      reports: READ_PRINT_EXPORT,
      auditTrail: READ_PRINT_EXPORT,
      systemConfig: { read: true, write: true },
    }),
  },
  {
    roleName: 'DEPARTMENT_HEAD',
    description: 'Departmental oversight — approves TNI/JD, reviews training status.',
    permissions: buildPermissions({
      dashboard: READ,
      userManagement: READ,
      jobDescription: { read: true, write: true, approve: true, print: true },
      tni: { read: true, write: true, approve: true },
      scheduling: { read: true, write: true },
      attendance: { read: true, write: true },
      assessments: READ,
      certificates: READ_PRINT_EXPORT,
      feedback: READ_PRINT_EXPORT,
      announcements: READ,
      reports: READ_PRINT_EXPORT,
    }),
  },
  {
    roleName: 'TRAINING_COORDINATOR',
    description: 'Plans schedules, manages assignments and attendance.',
    permissions: buildPermissions({
      dashboard: READ,
      userManagement: READ,
      courseManagement: { read: true, write: true, print: true },
      bundleManagement: { read: true, write: true, print: true },
      materialManagement: { read: true, write: true },
      tni: { read: true, write: true },
      scheduling: RWPE,
      attendance: RWPE,
      assessments: { read: true, write: true },
      questionBank: { read: true, write: true },
      certificates: READ_PRINT_EXPORT,
      feedback: { read: true, write: true, print: true, export: true },
      announcements: { read: true, write: true },
      reports: READ_PRINT_EXPORT,
    }),
  },
  {
    roleName: 'TRAINER',
    description: 'Delivers training, marks attendance, manages question bank.',
    permissions: buildPermissions({
      dashboard: READ,
      courseManagement: READ,
      bundleManagement: READ,
      materialManagement: READ,
      scheduling: READ,
      attendance: { read: true, write: true },
      assessments: READ,
      questionBank: { read: true, write: true },
      certificates: READ,
      feedback: READ,
      announcements: READ,
      reports: { read: true, print: true },
    }),
  },
  {
    roleName: 'TRAINEE',
    description: 'Takes assigned training and assessments.',
    permissions: buildPermissions({
      dashboard: READ,
      courseManagement: READ,
      bundleManagement: READ,
      materialManagement: READ,
      assessments: { read: true, write: true },
      certificates: { read: true, print: true },
      feedback: { read: true, write: true },
      announcements: READ,
    }),
  },
  {
    roleName: 'IT_ADMIN',
    description: 'Technical administration — users, roles, configuration, backups.',
    permissions: buildPermissions({
      dashboard: READ,
      userManagement: FULL,
      roleManagement: { read: true, write: true },
      masterSetup: { read: true, write: true },
      systemConfig: { read: true, write: true },
      backup: { read: true, write: true },
      announcements: { read: true, write: true },
      auditTrail: READ_PRINT_EXPORT,
    }),
  },
  {
    roleName: 'AUDITOR',
    description: 'Read-only access to records, audit trail and reports (with print/export).',
    permissions: buildPermissions({
      dashboard: READ,
      userManagement: READ,
      roleManagement: READ,
      courseManagement: READ,
      bundleManagement: READ,
      jobDescription: READ_PRINT_EXPORT,
      tni: READ,
      scheduling: READ,
      attendance: READ,
      assessments: READ,
      certificates: READ_PRINT_EXPORT,
      feedback: READ_PRINT_EXPORT,
      reports: READ_PRINT_EXPORT,
      auditTrail: READ_PRINT_EXPORT,
      systemConfig: READ,
    }),
  },
];

async function main() {
  console.log('🌱 Seeding izLearn baseline data...');

  // 1. System configuration -------------------------------------------------
  for (const [key, { value, description }] of Object.entries(DEFAULT_SYSTEM_CONFIG)) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: {},
      create: { key, value, description, updatedBy: SYSTEM },
    });
  }
  console.log(`   ✓ ${Object.keys(DEFAULT_SYSTEM_CONFIG).length} system config keys`);

  // 2. Roles -----------------------------------------------------------------
  const roleIdByName = new Map<string, string>();
  for (const def of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { roleName: def.roleName },
      update: { description: def.description, permissions: def.permissions as Prisma.InputJsonValue },
      create: {
        roleName: def.roleName,
        description: def.description,
        permissions: def.permissions as Prisma.InputJsonValue,
        createdBy: SYSTEM,
      },
    });
    roleIdByName.set(def.roleName, role.id);
  }
  console.log(`   ✓ ${ROLE_DEFINITIONS.length} roles`);

  // 3. Default location & department ----------------------------------------
  let location = await prisma.location.findFirst({ where: { name: 'Head Office' } });
  if (!location) {
    location = await prisma.location.create({
      data: { name: 'Head Office', description: 'Primary manufacturing & QA site', createdBy: SYSTEM },
    });
  }
  let department = await prisma.department.findFirst({ where: { name: 'Quality Assurance', locationId: location.id } });
  if (!department) {
    department = await prisma.department.create({
      data: { name: 'Quality Assurance', locationId: location.id, createdBy: SYSTEM },
    });
  }
  console.log('   ✓ Default location & department');

  // 4. First SUPER_ADMIN -----------------------------------------------------
  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe@123';
  const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
  const signaturePasswordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);

  const existing = await prisma.user.findUnique({ where: { windowsUsername: adminUsername } });
  if (!existing) {
    const admin = await prisma.user.create({
      data: {
        employeeId: 'EMP-0001',
        fullName: 'System Administrator',
        windowsUsername: adminUsername,
        email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
        passwordHash,
        signaturePasswordHash,
        userType: 'INTERNAL',
        departmentId: department.id,
        locationId: location.id,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
        createdBy: SYSTEM,
      },
    });
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: roleIdByName.get('SUPER_ADMIN')!, assignedBy: SYSTEM },
    });
    await prisma.passwordHistory.create({ data: { userId: admin.id, passwordHash } });
    console.log('   ✓ First SUPER_ADMIN created');
    console.log('   ----------------------------------------------------------');
    console.log(`   Login username : ${adminUsername}`);
    console.log(`   Login password : ${adminPassword}  (must be changed on first login)`);
    console.log('   ----------------------------------------------------------');
  } else {
    console.log('   • SUPER_ADMIN already exists — skipped');
  }

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
