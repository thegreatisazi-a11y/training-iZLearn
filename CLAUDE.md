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

## Assessment attempts: one definition of the allowance

Never count attempts or compute a limit inline. Everything goes through
`backend/src/utils/attemptAllowance.ts` (`attemptsUsed`, `effectiveMaxAttempts`,
`applicableExtraAttempts`). There were once three different counts and two different
denominators, and no two agreed — a learner who had used 4 of an allowed 4 saw
"Attempt 4 of 2" while their supervisor saw "6 / 4", and neither matched what the gate
enforced.

| Rule | Why |
|---|---|
| Everything is scoped to the course's **current version** | The allowance resets on every revision — `startAttempt` has always scoped its limit to `topicVersion`, so re-training on a revised course starts clean. A count or a limit that spans versions is a bug. |
| `extraAttempts` is a **high-water offset**, not spare attempts | An approved retake sets it to the attempts used so far, so `maxAttempts + extraAttempts` grants a fresh *full* allowance. It only means anything against the version it was granted for, which is why `extraAttemptsVersion` exists. An unstamped grant does **not** apply. |
| **Every completed attempt counts**, technical failures included | The reason is still recorded (`failureReasonIsTechnical`, used by the audit trail) so a supervisor can see the interruption wasn't the learner's fault and approve an unblock — their judgement, not an automatic exemption. The old auto-exemption made the number shown to the learner differ from the number the gate enforced. |

The learner's `maxAttempts` and the supervisor's denominator must both be
`effectiveMaxAttempts(...)`, never the raw `topic.maxAttempts`, or a granted retake is
invisible to the person relying on it.

## The assessment answer key is withheld until the learner passes

`backend/src/utils/answerKey.ts` owns the rule, enforced in **both** `submitAttempt` and
`reviewAttempt`. A failed attempt can be re-taken and a retake reuses the questions (every
mandatory question appears in every attempt; with `randomizeQuestions` off the whole paper
repeats), so revealing `correctAnswer` — or the `explanation`, which states it in prose —
would let a learner learn the answers between attempts. A manager reviewing someone else's
attempt always sees the full breakdown.

Strip it **server-side**. The old leak was in the `POST /assessments/submit` response body,
readable in devtools whether or not the page rendered it; a frontend guard is cosmetic only.
`answerKey.test.ts` pins this — do not weaken it into an untested inline condition.

## Printed documents are rendered on the SERVER, from the record

There is no client-side HTML printing. `frontend/src/lib/print.ts` holds only `printPdfBlob`;
every print and "Export PDF" button calls `printDocument(docType, params)` (or
`downloadDocumentPdf`) from `frontend/src/lib/printDocument.ts`, which fetches
`GET /api/print/:docType` and prints the returned PDF.

To add a printable document, add one entry to `PRINT_DOCUMENTS` in
`backend/src/services/printDocument.service.ts`: the `[module, action]` permission it needs
(normally `<module>:print`) and a `build` that re-reads the data through the **same scoped
service function the on-screen view uses**. Furniture, the permission check and the
`AuditTrail` PRINT event are handled once, around the registry.

**A builder takes identifiers and filters only — never HTML or content from the browser.**
Three reasons this is not negotiable:

| | |
|---|---|
| Furniture | Chrome stamps its own date, title, `about:blank` and page counter on any HTML print job. No CSS suppresses it — only the operator's "Headers and footers" checkbox does. Printing an already-rendered PDF avoids it entirely. |
| Page numbers | Chrome supports neither CSS page margin boxes nor `counter(page)` in printed content, so `Page X of Y` is impossible client-side. Puppeteer's `pageNumber`/`totalPages` spans supply it (see `reportHeader.ts`). |
| Integrity | A browser-composed document attested "Generated by \<user\>" to content the server never validated — a filtered page of rows, hour-old data, or (in My CV) the *unsaved* form. 21 CFR 11.10(b) wants an accurate and complete copy of the record and 11.10(e) wants the act recorded; a copy of a *view* is neither. Rendering arbitrary client HTML in server-side Chromium would also expose `file:///` and internal addresses. |

The header/footer live in `backend/src/utils/reportHeader.ts` and are shared with the report
PDFs, so reports and documents read identically:

```
<org name>                                        <document title>
...
Generated by <name> (<empId>) on <IST>                 Page X of Y
```

There is deliberately **no "Printed By"** (generating and printing are one request by one
user) and **no reference number** (it was minted per render and stored nowhere, so no printed
`Ref:` could ever be looked up — the record's own identifiers and the audit event are the real
handles). Both decisions are documented in `reportHeader.ts`; don't reintroduce either without
also making it mean something.
