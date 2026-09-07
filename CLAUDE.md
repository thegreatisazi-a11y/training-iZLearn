# izLearn — working notes

## Naming: it is a **Course**, never a "Topic"

The domain object is a **Course**. Everything a user can read must say *Course* —
labels, headings, buttons, placeholders, table headers, toasts, error messages,
tooltips, permission descriptions, email bodies, print/CSV/Excel headers, download
filenames, and the URL in the address bar (`/courses`).

Historically the same object was called a "Topic", and that name is still baked into
identifiers the system's records depend on. Those are **deliberately not renamed** —
changing them would break stored data, not just wording:

| Stays "topic" | Why it must not change |
|---|---|
| Prisma models `TrainingTopic`, `TopicBundle`, `BundleTopic`, `TopicVersionHistory` | MongoDB collection names — renaming means a data migration |
| DB fields `topicId`, `topicCode`, `topicNumber`, `topicTitle`, `trainingTypes` | Stored on every existing document |
| `entityType: 'TrainingTopic'` in `AuditTrail` | Audit rows are immutable and already say `TrainingTopic`. A new name would split one entity's history across two labels and break 21 CFR Part 11 traceability |
| API paths `/api/topics/...` | Public contract |
| Permission module key `topicVersionHistory` | Stored inside every role's permission matrix — renaming silently revokes access |
| Report type keys `topic-wise-status`, `version-wise-topic` | API contract. Their *display* labels are overridden in `ReportsPage.tsx → REPORT_LABELS` |
| `topicCode` values (`TRN-2026-0041`) | Printed on issued certificates and records |
| TS identifiers, local variables, file names (`TopicsPage.tsx`) | Internal only; renaming is churn with real regression risk and no user benefit |

**So the rule when writing new code:** use whatever identifier the surrounding data
layer already uses (`topicId` stays `topicId`), but every **string a user will read**
says *Course*. When a key can't change but its label is derived from it, override the
label — see `REPORT_LABELS`.

The frontend route is `/courses`; `/topics` and `/topics/:id` are kept only as
redirects in `AppRoutes.tsx` so old bookmarks and emailed links still resolve.

## Authorization: permissions are the contract, role NAMES are just labels

**Never branch on a role name.** No `roleNames.includes('SUPER_ADMIN')`, no
`requireRole('...')` — that middleware was deleted on purpose. A role is free-text data
created in Roles & Access Control: an organisation can rename it, delete it, or build all
its roles from scratch under names nobody wrote code for. Every guard that matched a name
broke silently when `SUPER_ADMIN` was renamed to `Super Admin` — manual backup/restore
became unreachable by anyone, and the password-reset privilege guard stopped firing
(a hole, not just an outage).

The two legitimate mechanisms:

| Need | Mechanism |
|---|---|
| Can this user do X? | `requirePermission(module, action)` on the route, or `hasPermission()` / `hasOrgWideScope()` in a service, against `PERMISSION_CATALOG` |
| Org-wide vs own-direct-reports scope | the module's `view_all` action (`hasOrgWideScope(perms, module)`) |
| "Is this the built-in administrator?" (privilege escalation only) | `Role.isSystem` via `holdsSystemRole(userId)` — a flag, so renaming is harmless |

`Role.isSystem` marks the built-in administrator role, stamped by the seed. It may be
renamed and its permissions edited, but `deactivateRole` refuses to delete or deactivate
it, and `assertNotLastSystemRoleHolder` refuses a role change or user deactivation that
would leave nobody holding it. So production always has an administrator, whatever it is
called, even if every other role is rebuilt from scratch.

**What must stay stable** are the permission *keys* — module names (`courseManagement`,
`backup`, `integrations`, and the legacy `topicVersionHistory`) and action names
(`view`, `view_all`, `view_others`, `reset_password`, …). They are stored inside every
role's permission matrix, so renaming one silently revokes access. Adding a new action is
safe but needs a marker-guarded back-fill in `seed.ts` for existing roles, because an
absent **or explicitly `false`** flag both read as denied.

Role names are Title Case (`Super Admin`, `Supervisor`, `Trainer`, `Trainee`) because they
are user-visible. That is a display convention only — nothing depends on it. Note that
re-running the seed after an admin deletes a baseline role will recreate it, since roles
are matched by normalised name.

## Other conventions

- **Comments count.** Commented-out code is kept deliberately in this repo (features
  parked, not deleted). Keep it consistent with live code when renaming.
- **Audit trail is untouchable.** Nothing ever updates or deletes an `AuditTrail` or
  `ElectronicSignature` row; immutability is enforced at the application layer.
- **Line endings are CRLF** (`core.autocrlf=true`, no `.gitattributes`). Scripts that
  rewrite files must preserve CRLF or they produce whole-file churn.
