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
import {
  DEFAULT_SYSTEM_CONFIG,
  PERMISSION_MODULES,
  deriveLegacyFlags,
  type PermissionModule,
  type PermissionVerb,
} from '@izlearn/shared';

const prisma = new PrismaClient();

const BCRYPT_COST = 12;
const SYSTEM = 'SYSTEM';

type Flags = Record<string, boolean>;

/**
 * Build a module's flag set from an explicit list of the 10 granular verbs, then
 * append the derived legacy keys (read/write/approve/print/export) so older route
 * guards that still check the legacy aliases keep working. (D6 keeps the full
 * 10-verb matrix internally; the seeded role set is the 4-role model.)
 */
function granular(verbs: PermissionVerb[]): Flags {
  const flags: Flags = {
    view: false,
    create: false,
    edit: false,
    archive: false,
    revise: false,
    assign: false,
    review: false,
    approve: false,
    print: false,
    export: false,
  };
  for (const v of verbs) flags[v] = true;
  return { ...flags, ...deriveLegacyFlags(flags) };
}

const ALL_VERBS = [...new Set<PermissionVerb>(['view', 'create', 'edit', 'archive', 'revise', 'assign', 'review', 'approve', 'print', 'export'])];

/** Build a full permission matrix from a per-module granular-verb map (omitted modules → no access). */
function buildGranular(overrides: Partial<Record<PermissionModule, PermissionVerb[]>>): Record<string, Flags> {
  const all: Record<string, Flags> = {};
  for (const mod of PERMISSION_MODULES) all[mod] = granular(overrides[mod] ?? []);
  return all;
}

/** SUPER_ADMIN — every module, every verb. */
function allFull(): Record<string, Flags> {
  const all: Record<string, Flags> = {};
  for (const mod of PERMISSION_MODULES) all[mod] = granular(ALL_VERBS);
  return all;
}

/**
 * D6 — the 4-role model. Super Admin (everything), Supervisor (user management,
 * JD/TNI assignment & approval, reports), Trainer (course/question/material
 * authoring), Trainee (takes training, acknowledges JD, owns CV).
 */
const ROLE_DEFINITIONS: { roleName: string; description: string; permissions: Record<string, Flags> }[] = [
  {
    roleName: 'SUPER_ADMIN',
    description: 'Full, unrestricted access to every module.',
    permissions: allFull(),
  },
  {
    roleName: 'SUPERVISOR',
    description: 'User management, JD/TNI assignment & approval, training oversight and reports.',
    permissions: buildGranular({
      dashboard: ['view'],
      userManagement: ['view', 'create', 'edit', 'approve', 'assign', 'print', 'export'],
      roleManagement: ['view'],
      masterSetup: ['view'],
      courseManagement: ['view'],
      topicVersionHistory: ['view'],
      trainingAssignment: ['view', 'assign', 'approve'],
      materialManagement: ['view'],
      jobDescription: ['view', 'assign', 'approve', 'print', 'export'],
      tni: ['view', 'create', 'edit', 'assign', 'approve'],
      cv: ['view', 'create', 'edit'],
      team: ['view', 'review', 'approve', 'export', 'print'],
      scheduling: ['view', 'create', 'edit', 'assign'],
      attendance: ['view', 'create', 'edit'],
      assessments: ['view'],
      questionBank: ['view'],
      certificates: ['view', 'print', 'export'],
      feedback: ['view'],
      announcements: ['view', 'create'],
      reports: ['view', 'print', 'export'],
      auditTrail: ['view', 'print', 'export'],
    }),
  },
  {
    roleName: 'TRAINER',
    description: 'Creates courses, question banks and materials; handles TNI/course authoring.',
    permissions: buildGranular({
      dashboard: ['view'],
      courseManagement: ['view', 'create', 'edit', 'archive', 'revise', 'approve', 'print', 'export'],
      topicVersionHistory: ['view', 'export'],
      materialManagement: ['view', 'create', 'edit', 'archive', 'revise'],
      questionBank: ['view', 'create', 'edit', 'archive'],
      tni: ['view', 'create', 'edit'],
      trainingAssignment: ['view', 'assign'],
      scheduling: ['view', 'create', 'edit'],
      attendance: ['view', 'create', 'edit'],
      assessments: ['view', 'create', 'edit'],
      certificates: ['view'],
      jobDescription: ['view'],
      cv: ['view', 'create', 'edit'],
      feedback: ['view', 'create'],
      announcements: ['view'],
      reports: ['view', 'print', 'export'],
    }),
  },
  {
    roleName: 'TRAINEE',
    description: 'Takes assigned training & assessments, acknowledges JD, owns CV.',
    permissions: buildGranular({
      dashboard: ['view'],
      courseManagement: ['view'],
      topicVersionHistory: ['view'],
      materialManagement: ['view'],
      assessments: ['view', 'create'],
      certificates: ['view', 'print'],
      jobDescription: ['view'],
      cv: ['view', 'create', 'edit'],
      tni: ['view'],
      feedback: ['view', 'create'],
      announcements: ['view'],
    }),
  },
];

/**
 * D-JD1 — the 15 Functional Roles. "Functional Role" is the employee's job function
 * (drives JD assignment) and is stored in the DesignationMaster table (the old
 * "Designation" concept, repurposed). Separate from the RBAC login roles above.
 */
const FUNCTIONAL_ROLES = [
  'QA Auditor',
  'Apprentice',
  'Jr. Analyst',
  'Analyst',
  'Sr. Analyst',
  'Group Leader',
  'QC Personnel',
  'Operation Head',
  'QA Head',
  'IT Personnel',
  'HR Personnel',
  'Quality Compliance Personnel',
  'Corporate Personnel',
  'Project Management Personnel',
  'Admin Personnel',
];

function functionalRoleCode(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * CR-58: editable Training Type master. `code` matches the TrainingType enum where
 * one exists so topics referencing the enum stay consistent; the master is the
 * admin-editable source for the picker. All seeded as built-in.
 */
const TRAINING_TYPES: { code: string; displayName: string }[] = [
  { code: 'SELF_READ', displayName: 'Self-read' },
  { code: 'SELF_READ_EVALUATION', displayName: 'Self-read with evaluation' },
  { code: 'QUIZ', displayName: 'Quiz' },
  { code: 'VIDEO', displayName: 'Video' },
  { code: 'REMOTE', displayName: 'Remote' },
  { code: 'SOP', displayName: 'SOP' },
  { code: 'ONLINE', displayName: 'Online' },
  { code: 'CLASSROOM', displayName: 'Classroom' },
  { code: 'OJT', displayName: 'OJT' },
  { code: 'INDUCTION', displayName: 'Induction' },
  { code: 'REFRESHER', displayName: 'Refresher' },
  { code: 'OFFLINE', displayName: 'Offline' },
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

  // 2b. Functional Roles (D-JD1) — stored in DesignationMaster ----------------
  for (const name of FUNCTIONAL_ROLES) {
    const code = functionalRoleCode(name);
    await prisma.designationMaster.upsert({
      where: { code },
      update: { displayName: name },
      create: { code, displayName: name, description: 'Functional Role', createdBy: SYSTEM },
    });
  }
  console.log(`   ✓ ${FUNCTIONAL_ROLES.length} functional roles`);

  // 2c. Training Type master (CR-58) -----------------------------------------
  for (const t of TRAINING_TYPES) {
    await prisma.trainingTypeMaster.upsert({
      where: { code: t.code },
      update: { displayName: t.displayName, isBuiltIn: true },
      create: { code: t.code, displayName: t.displayName, isBuiltIn: true, createdBy: SYSTEM },
    });
  }
  console.log(`   ✓ ${TRAINING_TYPES.length} training types`);

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
