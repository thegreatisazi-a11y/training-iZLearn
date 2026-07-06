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
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';

// Load backend/.env if present, else fall back to the monorepo-root .env (same
// resolution as src/config/env.ts) so `npm run seed` works from the backend workspace.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import { DEFAULT_SYSTEM_CONFIG, PERMISSION_CATALOG, deriveLegacyFlags } from '@izlearn/shared';

const prisma = new PrismaClient();

const BCRYPT_COST = 12;
const SYSTEM = 'SYSTEM';

type Flags = Record<string, boolean>;

/** Build one module's flags from its granted action keys + derived legacy flags. */
function moduleFlags(actionKeys: string[], granted: string[]): Flags {
  const f: Flags = {};
  for (const a of actionKeys) f[a] = granted.includes(a);
  return { ...f, ...deriveLegacyFlags(f) };
}

/**
 * Build a full permission matrix from a per-module grant map over the permission
 * catalog. A module mapped to 'all' grants every action; an omitted module grants
 * nothing. Only real (catalog) actions are ever stored.
 */
function buildMatrix(grants: Record<string, string[] | 'all'>): Record<string, Flags> {
  const out: Record<string, Flags> = {};
  for (const def of PERMISSION_CATALOG) {
    const keys = def.actions.map((a) => a.key);
    const g = grants[def.module];
    out[def.module] = moduleFlags(keys, g === 'all' ? keys : g ?? []);
  }
  return out;
}

/** SUPER_ADMIN — every catalog action on every module. */
function allFull(): Record<string, Flags> {
  const grants: Record<string, 'all'> = {};
  for (const def of PERMISSION_CATALOG) grants[def.module] = 'all';
  return buildMatrix(grants);
}

/**
 * D6 — the 4-role model, expressed over the per-module permission catalog (only
 * real actions per module). Super Admin (everything), Supervisor (user/team mgmt,
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
    description: 'User & team management, JD/TNI assignment & approval, training oversight and reports.',
    permissions: buildMatrix({
      dashboard: ['view'],
      userManagement: ['view', 'create', 'edit', 'approve', 'assign', 'reset_password', 'print', 'export'],
      userRequests: ['view', 'approve'],
      team: 'all',
      roleManagement: ['view'],
      masterSetup: ['view'],
      courseManagement: ['view'],
      materialManagement: ['view'],
      topicVersionHistory: ['view'],
      trainingAssignment: ['view', 'assign', 'approve', 'print', 'export'],
      scheduling: ['view', 'create', 'edit', 'assign'],
      attendance: ['view', 'create', 'edit'],
      tni: ['view', 'create', 'edit', 'assign', 'approve', 'print', 'export'],
      jobDescription: ['view', 'assign', 'approve', 'print', 'export'],
      cv: ['view'],
      assessments: ['view'],
      certificates: ['view', 'print', 'export'],
      reports: ['view', 'print', 'export'],
      auditTrail: ['view', 'print', 'export'],
      feedback: ['view'],
      announcements: ['view', 'create'],
    }),
  },
  {
    roleName: 'TRAINER',
    description: 'Creates courses, question banks and materials; handles TNI/course authoring.',
    permissions: buildMatrix({
      dashboard: ['view'],
      courseManagement: ['view', 'create', 'edit', 'revise', 'archive', 'approve', 'assign', 'print', 'export'],
      materialManagement: ['view', 'create', 'edit', 'archive'],
      topicVersionHistory: ['view', 'export'],
      questionBank: 'all',
      bundleManagement: ['view'],
      trainingAssignment: ['view', 'assign'],
      scheduling: ['view', 'create', 'edit'],
      attendance: ['view', 'create', 'edit'],
      tni: ['view', 'create', 'edit'],
      assessments: ['view', 'create', 'edit', 'archive', 'approve'],
      certificates: ['view'],
      jobDescription: ['view', 'acknowledge'],
      cv: ['view', 'edit'],
      feedback: ['view', 'create'],
      announcements: ['view'],
      reports: ['view', 'print', 'export'],
    }),
  },
  {
    roleName: 'TRAINEE',
    description: 'Takes assigned training & assessments, acknowledges JD, owns CV.',
    permissions: buildMatrix({
      dashboard: ['view'],
      courseManagement: ['view'],
      topicVersionHistory: ['view'],
      materialManagement: ['view'],
      assessments: ['view', 'take'],
      certificates: ['view', 'print'],
      jobDescription: ['view', 'acknowledge'],
      cv: ['view', 'edit'],
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

  // 2a. Back-fill split permissions so no CUSTOM role loses access when a module is split.
  // "User Requests" was split from Users; "Certificate Templates" from Certificates. For
  // any role missing the new module, mirror the parent module's flags. Idempotent — only
  // fills a new module when it is entirely absent (never overrides an admin's choice).
  {
    const roles = await prisma.role.findMany();
    let migrated = 0;
    for (const role of roles) {
      const p = (role.permissions ?? {}) as Record<string, Record<string, boolean>>;
      let changed = false;
      if (!p.userRequests && p.userManagement) {
        const ur = { view: !!(p.userManagement.view || p.userManagement.read), approve: !!p.userManagement.approve };
        p.userRequests = { ...ur, ...deriveLegacyFlags(ur) };
        changed = true;
      }
      // The old "Certificate Templates" menu required certificates:write, so only roles
      // that could MANAGE templates should get the new module (view-only cert roles never
      // saw it). Preserves prior access exactly without over-granting.
      if (!p.certificateTemplates && p.certificates && (p.certificates.edit || p.certificates.write)) {
        const ct = { view: true, create: true, edit: true };
        p.certificateTemplates = { ...ct, ...deriveLegacyFlags(ct) };
        changed = true;
      }
      if (changed) {
        await prisma.role.update({ where: { id: role.id }, data: { permissions: p as Prisma.InputJsonValue } });
        migrated += 1;
      }
    }
    if (migrated) console.log(`   ✓ back-filled split permissions for ${migrated} role(s)`);
  }

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
