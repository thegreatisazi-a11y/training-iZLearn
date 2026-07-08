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
      // S4: the Supervisor is VIEW-ONLY in the Users module (sees all users + dept filter,
      // but no create/edit/deactivate there). Team members are managed from My Team via the
      // team:* permissions instead.
      userManagement: ['view', 'print', 'export'],
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
      assessments: ['view', 'view_others'],
      certificates: ['view', 'view_others', 'print', 'export'],
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
  // Match existing roles CASE-INSENSITIVELY so a role renamed via the UI (e.g.
  // 'SUPERVISOR' → 'Supervisor') is never duplicated on re-seed. Previously the seed
  // upserted by exact roleName, so after such a rename each seed run re-created the
  // UPPERCASE role — leaving two 'Trainee'/'Supervisor' entries. A live role's
  // permissions are PRESERVED (never clobbered); defaults are only applied on create.
  const roleIdByName = new Map<string, string>();
  const allRoles = await prisma.role.findMany();
  const activeLinks = (roleId: string) => prisma.userRole.count({ where: { roleId, isActive: true } });

  for (const def of ROLE_DEFINITIONS) {
    const matches = allRoles.filter((r) => r.roleName.trim().toLowerCase() === def.roleName.toLowerCase());
    if (matches.length === 0) {
      const created = await prisma.role.create({
        data: {
          roleName: def.roleName,
          description: def.description,
          permissions: def.permissions as Prisma.InputJsonValue,
          createdBy: SYSTEM,
        },
      });
      roleIdByName.set(def.roleName, created.id);
      continue;
    }
    // Canonical = the surviving role: prefer non-deleted, then most active user links,
    // so the live role that actually carries users always wins the merge.
    const ranked: { r: (typeof matches)[number]; links: number }[] = [];
    for (const r of matches) ranked.push({ r, links: await activeLinks(r.id) });
    // Non-deleted first, then the one with the most active user links.
    ranked.sort((a, b) => Number(!b.r.isDeleted) - Number(!a.r.isDeleted) || b.links - a.links);
    const canonical = ranked[0].r;
    roleIdByName.set(def.roleName, canonical.id);

    // Merge & retire duplicate case-variants: reassign their users to the canonical
    // role (skipping any the user already has), then soft-delete the duplicate. No
    // permissions or user assignments are lost.
    for (const { r: dupRole } of ranked.slice(1)) {
      const links = await prisma.userRole.findMany({ where: { roleId: dupRole.id } });
      for (const link of links) {
        const already = await prisma.userRole.findFirst({ where: { userId: link.userId, roleId: canonical.id } });
        if (already) await prisma.userRole.delete({ where: { id: link.id } });
        else await prisma.userRole.update({ where: { id: link.id }, data: { roleId: canonical.id } });
      }
      if (!dupRole.isDeleted) {
        await prisma.role.update({ where: { id: dupRole.id }, data: { isDeleted: true, isActive: false } });
        console.log(`   ✓ merged duplicate role '${dupRole.roleName}' → '${canonical.roleName}'`);
      }
    }
  }
  console.log(`   ✓ ${ROLE_DEFINITIONS.length} roles ensured`);

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
      // "Bulk Upload" is now its own granular action + route guard. Roles that could
      // already bulk-upload (had userManagement write/create) keep the ability so the
      // new gate doesn't silently remove it; the toggle then meaningfully controls it.
      // Only fills when the flag is entirely absent — never overrides an admin's choice.
      if (p.userManagement && p.userManagement.bulk_upload === undefined && (p.userManagement.write || p.userManagement.create)) {
        p.userManagement.bulk_upload = true;
        changed = true;
      }
      // "Add Team Member" (team:create) split from the Users create permission. Roles that
      // could already add a member (had userManagement create/write) keep the ability so
      // the new gate doesn't silently remove it; it can then be toggled independently.
      if (p.team && p.team.create === undefined && (p.userManagement?.create || p.userManagement?.write)) {
        p.team.create = true;
        changed = true;
      }
      // S5: "Edit / Deactivate Team Member" (team:edit / team:deactivate) — granted to any
      // role that can view a team (supervisors / coordinators / admins). Hierarchy (direct
      // reports vs everyone) is enforced server-side at request time. Never for trainees.
      if (p.team && p.team.view && p.team.edit === undefined) {
        p.team.edit = true;
        changed = true;
      }
      if (p.team && p.team.view && p.team.deactivate === undefined) {
        p.team.deactivate = true;
        changed = true;
      }
      // "View Others' Certificates" (certificates:view_others). Granted to roles that can
      // view a team, manage users, or MANAGE certificates (supervisors / training
      // coordinators / admins) — never plain trainees or trainers (course authors), who
      // have none of these. Scope (team vs all) is enforced server-side by role.
      if (
        p.certificates &&
        p.certificates.view_others === undefined &&
        (p.team?.view || p.team?.read || p.userManagement?.read || p.certificates?.write)
      ) {
        p.certificates.view_others = true;
        changed = true;
      }
      // S1: "View Others' Assessments" (assessments:view_others). Granted to oversight
      // roles (supervisors / training coordinators / admins) — identified by team view,
      // user management, or audit-trail access — but NOT trainers (course authors) or
      // trainees, who have none of these. Scope (team vs all) is enforced server-side.
      if (
        p.assessments &&
        p.assessments.view_others === undefined &&
        (p.team?.view || p.team?.read || p.userManagement?.read || p.auditTrail?.read)
      ) {
        p.assessments.view_others = true;
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

  // 2a-2. S4 one-off: make the EXISTING Supervisor role VIEW-ONLY in the Users module
  // (no create/edit/approve/assign/reset there — team members are managed from My Team).
  // Guarded by a marker so it runs exactly once and never re-clobbers a later admin choice.
  {
    const markerKey = 'migration.supervisor_users_viewonly_v1';
    const done = await prisma.systemConfig.findUnique({ where: { key: markerKey } });
    if (!done) {
      const sups = await prisma.role.findMany({ where: { isDeleted: false, roleName: { in: ['Supervisor', 'SUPERVISOR'] } } });
      for (const r of sups) {
        const p = (r.permissions ?? {}) as Record<string, Record<string, boolean>>;
        if (!p.userManagement) continue;
        for (const k of ['create', 'edit', 'approve', 'assign', 'reset_password']) p.userManagement[k] = false;
        Object.assign(p.userManagement, deriveLegacyFlags(p.userManagement)); // recompute read/write/…
        // Ensure the team-management actions used by My Team are present.
        p.team = p.team ?? {};
        for (const k of ['view', 'create', 'edit', 'deactivate']) p.team[k] = true;
        Object.assign(p.team, deriveLegacyFlags(p.team));
        await prisma.role.update({ where: { id: r.id }, data: { permissions: p as Prisma.InputJsonValue } });
      }
      await prisma.systemConfig.create({ data: { key: markerKey, value: 'done', description: 'S4: Supervisor is view-only in Users; team managed via My Team', updatedBy: SYSTEM } });
      if (sups.length) console.log('   ✓ S4: Supervisor set view-only in Users (team managed from My Team)');
    }
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
