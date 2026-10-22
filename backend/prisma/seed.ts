/**
 * Explicit setup implementations (never imported by normal API startup):
 *   - System configuration defaults
 *   - The 4 baseline RBAC roles with permission matrices
 *   - A default Location + Department
 *   - The first SUPER_ADMIN user
 *
 * Run via prisma/bootstrap.ts or prisma/release.ts after schema sync.
 *
 * These controlled setup commands use a bare PrismaClient and stamp their
 * bootstrap records createdBy = 'SYSTEM'. Run against a backed-up database.
 */
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { normalizeRoleName } from '../src/utils/roleIdentity';

// Load backend/.env if present, else fall back to the monorepo-root .env (same
// resolution as src/config/env.ts) so setup commands work from the backend workspace.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import { DEFAULT_SYSTEM_CONFIG, PERMISSION_CATALOG, deriveLegacyFlags } from '@izlearn/shared';

const prisma = new PrismaClient();

const BCRYPT_COST = 12;
const SYSTEM = 'SYSTEM';

function bootstrapPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 12 || /^change[\W_]*me/i.test(password) || /^replace[\W_]*with/i.test(password)) {
    throw new Error('Set SEED_ADMIN_PASSWORD to a unique password of at least 12 characters before first-time bootstrap.');
  }
  return password;
}

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
const ROLE_DEFINITIONS: { roleName: string; description: string; isSystem?: boolean; permissions: Record<string, Flags> }[] = [
  {
    // Role names are user-visible (Topbar, Users list, Profile), so they are Title Case.
    // Nothing in the code matches on them — see isSystem below and the permission catalog.
    roleName: 'Super Admin',
    description: 'Full, unrestricted access to every module.',
    // The built-in administrator role: renameable, but never deletable, and the anchor the
    // privilege-escalation guards key on. Guarantees production always has a top-tier role
    // even if every other role is rebuilt from scratch.
    isSystem: true,
    permissions: allFull(),
  },
  {
    roleName: 'Supervisor',
    description: 'User & team management, JD/TNI assignment & approval, training oversight and reports.',
    permissions: buildMatrix({
      dashboard: ['view'],
      // S4: the Supervisor is VIEW-ONLY in the Users module (sees all users + dept filter,
      // but no create/edit/deactivate there). Team members are managed from My Team via the
      // team:* permissions instead.
      userManagement: ['view', 'print', 'export'],
      userRequests: ['view', 'approve'],
      // NOT 'all': team:view_all is the org-wide override (see the permission catalog) and
      // must stay OFF for a supervisor, who is scoped to their own direct reports.
      team: ['view', 'create', 'edit', 'deactivate', 'approve', 'print', 'export'],
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
    roleName: 'Trainer',
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
    roleName: 'Trainee',
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
      // Trainees only SUBMIT feedback (the open /feedback/submit route); they must not be
      // able to create/manage feedback FORMS. (Was ['view','create'] which derived write.)
      feedback: ['view'],
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
  { code: 'E_LEARNING', displayName: 'E-learning' },
  { code: 'WORKSHOP', displayName: 'Workshop' },
];

async function bootstrapRolesAndConfig(): Promise<string> {
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
  // Existing duplicate identities require explicit review: never merge user links or
  // permissions automatically during setup.
  let systemRoleId: string | undefined;
  const allRoles = await prisma.role.findMany();
  const activeRoles = allRoles.filter((r) => !r.isDeleted);
  const names = new Map<string, string>();
  for (const role of activeRoles) {
    const key = normalizeRoleName(role.roleName);
    const previous = names.get(key);
    if (previous) throw new Error(`Duplicate role identity '${role.roleName}' (${previous}, ${role.id}). Reconcile these roles explicitly before bootstrap.`);
    names.set(key, role.id);
  }
  if (activeRoles.filter((r) => r.isSystem).length > 1) throw new Error('Multiple system roles found. Reconcile them explicitly before bootstrap.');
  const protectedRole = activeRoles.find((r) => r.isSystem);
  if (protectedRole && activeRoles.some((r) => r.id !== protectedRole.id && normalizeRoleName(r.roleName) === normalizeRoleName('Super Admin'))) {
    throw new Error('A separate role still uses the legacy Super Admin name. Review its assignments before bootstrap; no automatic merge will occur.');
  }

  for (const def of ROLE_DEFINITIONS) {
    const matches = def.isSystem && activeRoles.some((r) => r.isSystem)
      ? activeRoles.filter((r) => r.isSystem)
      : activeRoles.filter((r) => normalizeRoleName(r.roleName) === normalizeRoleName(def.roleName));
    if (!def.isSystem && matches.some((r) => r.isSystem)) {
      throw new Error(`The protected system role is named '${def.roleName}', which conflicts with a baseline role. Rename it before bootstrap.`);
    }
    if (matches.length === 0) {
      const created = await prisma.role.create({
        data: {
          roleName: def.roleName,
          description: def.description,
          isSystem: def.isSystem ?? false,
          permissions: def.permissions as Prisma.InputJsonValue,
          createdBy: SYSTEM,
        },
      });
      if (def.isSystem) systemRoleId = created.id;
      continue;
    }
    const canonical = matches[0];
    if (def.isSystem) systemRoleId = canonical.id;
    if ((def.isSystem ?? false) && !canonical.isSystem) {
      await prisma.role.update({ where: { id: canonical.id }, data: { isSystem: true } });
      console.log(`   ✓ marked '${canonical.roleName}' as the protected system role`);
    }
  }
  if (!systemRoleId) throw new Error('System administrator role was not seeded.');
  console.log(`   ✓ ${ROLE_DEFINITIONS.length} roles ensured`);
  return systemRoleId;
}

/** Versioned release update; never runs as part of backend startup or bootstrap. */
export async function runReleaseMigrations(): Promise<void> {
  const markerKey = 'migration.release_2026_10_bootstrap_split_v1';
  if (await prisma.systemConfig.findUnique({ where: { key: markerKey } })) return;
  const liveRoles = await prisma.role.findMany({ where: { isDeleted: false } });
  const names = new Set<string>();
  for (const role of liveRoles) {
    const key = normalizeRoleName(role.roleName);
    if (names.has(key)) throw new Error(`Duplicate role identity '${role.roleName}'. Run setup:audit and reconcile before release migration.`);
    names.add(key);
  }
  const systemRoles = await prisma.role.findMany({ where: { isSystem: true, isDeleted: false, isActive: true } });
  if (systemRoles.length !== 1) throw new Error('Expected exactly one active system role before release migrations. Run role reconciliation.');
  if (liveRoles.some((role) => role.id !== systemRoles[0].id && normalizeRoleName(role.roleName) === normalizeRoleName('Super Admin'))) {
    throw new Error('A separate role uses the legacy Super Admin name. Reconcile its assignments before release migration.');
  }
  const systemRoleId = systemRoles[0].id;

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
      // "View Organisation Overview" (dashboard:view_org) is a NEW permission gating the
      // org-wide dashboard section (previously derived from broad read access, so supervisors
      // saw whole-org numbers). Grant it ONLY to the top admin so an existing deployment
      // isn't locked out of org stats; every other role defaults to OFF — a team-only
      // dashboard — and can be granted it explicitly in Roles & Access Control.
      if (p.dashboard && p.dashboard.view_org === undefined) {
        p.dashboard.view_org = role.id === systemRoleId;
        changed = true;
      }
      // "Version History" (topicVersionHistory:view) is now enforced on the course
      // history route (previously it was inert — gated on courseManagement:view). Preserve
      // prior access: any role that can view courses keeps history unless explicitly
      // toggled off. Only fills when absent, so it stays independently toggleable.
      if (p.topicVersionHistory && p.topicVersionHistory.view === undefined && (p.courseManagement?.view || p.courseManagement?.read)) {
        p.topicVersionHistory.view = true;
        changed = true;
      }
      // Also create the module for a course-viewing role that lacks it entirely.
      if (!p.topicVersionHistory && (p.courseManagement?.view || p.courseManagement?.read)) {
        p.topicVersionHistory = { view: true, ...deriveLegacyFlags({ view: true }) };
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
      // `integrations` is a NEW module: the integration routes used to be gated on
      // requireRole('SUPER_ADMIN', 'IT_ADMIN') — role NAMES, which broke on rename.
      // Preserve exactly the prior access by granting it to the roles that already hold
      // the equivalent system-level rights (system config / restore), which is precisely
      // the administrator + IT-admin set. Only fills when the module is absent.
      if (!p.integrations && (p.systemConfig?.edit || p.backup?.approve)) {
        const ig = { view: true, edit: true };
        p.integrations = { ...ig, ...deriveLegacyFlags(ig) };
        changed = true;
      }

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

  // 2a-3. `view_all` one-off: the org-wide override that replaced the hard-coded
  // `roleNames.includes('SUPER_ADMIN')` checks in the user / certificate / CV / retake
  // services.
  //
  // MUST be granted here or the super-admin role silently LOSES org-wide access the moment
  // the new code deploys — an absent OR explicitly-false permission both read as denied,
  // and saving the role in Roles & Access Control before this migration writes `false` for
  // the new actions. Restores exactly the access the old role-name check gave: the
  // super-admin role only, never widened to anyone else.
  //
  // Matched on the NORMALISED name (as everywhere else in this seed) because the role is
  // routinely renamed 'SUPER_ADMIN' -> 'Super Admin' via the UI. Marker-guarded so it runs
  // exactly once and never re-clobbers a later deliberate choice.
  {
    const markerKey = 'migration.view_all_super_admin_v1';
    const done = await prisma.systemConfig.findUnique({ where: { key: markerKey } });
    if (!done) {
      const admins = await prisma.role.findMany({ where: { isDeleted: false, isSystem: true } });
      for (const r of admins) {
        const perms = (r.permissions ?? {}) as Record<string, Record<string, boolean>>;
        for (const mod of ['userManagement', 'team', 'cv', 'certificates']) {
          perms[mod] = perms[mod] ?? {};
          perms[mod].view_all = true;
          Object.assign(perms[mod], deriveLegacyFlags(perms[mod]));
        }
        await prisma.role.update({ where: { id: r.id }, data: { permissions: perms as Prisma.InputJsonValue } });
      }
      await prisma.systemConfig.create({
        data: {
          key: markerKey,
          value: 'done',
          description: 'Granted view_all (org-wide scope) to the super-admin role, replacing hard-coded SUPER_ADMIN checks',
          updatedBy: SYSTEM,
        },
      });
      if (admins.length) console.log(`   ✓ granted org-wide view_all to ${admins.length} super-admin role(s)`);
    }
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

  await prisma.systemConfig.create({
    data: { key: markerKey, value: 'done', description: 'Versioned permission updates after bootstrap split', updatedBy: SYSTEM },
  });
}

async function bootstrapMastersAndAdmin(systemRoleId: string): Promise<void> {

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
  const existing = await prisma.user.findUnique({ where: { windowsUsername: adminUsername } });
  if (!existing) {
    if (await prisma.user.count()) {
      throw new Error('Users already exist, but the named bootstrap administrator does not. Refusing to create a new privileged account. Run setup:audit.');
    }
    const adminPassword = bootstrapPassword();
    const passwordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
    const signaturePasswordHash = await bcrypt.hash(adminPassword, BCRYPT_COST);
    await prisma.$transaction(async (tx) => {
      const admin = await tx.user.create({
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
      await tx.userRole.create({ data: { userId: admin.id, roleId: systemRoleId, assignedBy: SYSTEM } });
      await tx.passwordHistory.create({ data: { userId: admin.id, passwordHash } });
    });
    console.log('   ✓ First SUPER_ADMIN created');
  } else {
    const link = await prisma.userRole.findFirst({ where: { userId: existing.id, roleId: systemRoleId, isActive: true } });
    if (!link) throw new Error(`Bootstrap account '${adminUsername}' has no active system-role assignment. Inspect it and use the explicit repair command; no privilege was granted automatically.`);
    console.log('   • Existing bootstrap administrator verified; credentials unchanged');
  }

  console.log('✅ Bootstrap complete.');
}

export async function runBootstrap(): Promise<void> {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  if (!(await prisma.user.findUnique({ where: { windowsUsername: username } }))) {
    if (await prisma.user.count()) {
      throw new Error('Users already exist, but the named bootstrap administrator does not. Refusing to create a new privileged account. Run setup:audit.');
    }
    bootstrapPassword();
  }
  const systemRoleId = await bootstrapRolesAndConfig();
  await bootstrapMastersAndAdmin(systemRoleId);
}

export async function disconnectSetup(): Promise<void> {
  await prisma.$disconnect();
}
