# izLearn — Module-wise Change Requirement Document
**Date:** 2026-06-16 · **Source:** handwritten notes `PDF Gallery_20260616_011812.pdf` (9 pages) + structured brief · **Status:** ⏳ AWAITING APPROVAL — no code changed

## How to read this
- **Page ref** maps to the note's 15 areas (note order). Handwriting is rough, so each item is the *business meaning*, not a literal transcription.
- Each change has: page · module · current issue · required change · UI · backend/API/DB · RBAC · audit · location · priority · dependency/decision.
- **Status tags:** 🟥 NEW (not built) · 🟧 PARTIAL (exists, needs change) · 🟩 DONE (already implemented this engagement — *verify only*).
- Many items from earlier rounds are already shipped; those are tagged 🟩 so we focus effort on the real gaps.

Legend for the per-module checklist (asked in §15): **L**=Location, **V**=View, **E**=Edit, **A**=Archive/Deactivate, **H**=hide inactive from active lists, **F**=inactive available via filter.

---

# SECTION A — Decisions needed before implementation
Answer these first; several reshape existing work.

| # | Decision | Why it matters | Recommendation |
|---|---|---|---|
| **D1** | Rename **"Supervisor" → "Reporting Manager"** everywhere (UI + code field?) | Field is `supervisorId` across schema/services/UI; UI rename is cheap, code rename is risky. | UI label rename only; keep `supervisorId` internally. |
| **D2** | **One vs many Functional Roles per user**; one vs many per training topic | Code now supports arrays (`designationIds`) on both. Note implies multi. | Keep multi (already built). |
| **D3** | **JD Reject** — keep or remove (only Acknowledge/Accept)? | `transitionJD` has REJECT; note questions if needed. | Keep Reject for *template* review; user side = Acknowledge only. |
| **D4** | **JD assigner role** — Dept Head / Designee / Reporting Manager / Supervisor? | Drives `jobDescription:assign` grant + JD auto-assign trigger. | Reporting Manager + Dept Head + Admin. |
| **D5** | **Bundle vs TNI** — retire Bundle now that TNI matrix drives assignment? | Bundle module still present + deprioritized. | Hide Bundle; TNI primary. (Confirm.) |
| **D6** | **Training Topic field pruning** — remove which of: duplicate SOP/Topic No., optional Role, Department, Duration, Min-reading-time, Next-Review, Sequence? | All exist in schema/forms. Removing changes forms + (optionally) schema. | See CR-T1…T8; need your per-field yes/no. |
| **D7** | **Rename "Roles & Permissions" → "Roles & Access Control"**? | Nav label + page title only. | Yes (label only). |
| **D8** | **Username auto-generate** format (e.g. `firstname.lastname` lowercase) + collision rule | New behavior; needs a rule. | `first.last`, lowercase, numeric suffix on clash. |
| **D9** | **Email mandatory** for user creation (currently optional) | Schema `email` optional; temp-password email depends on it. | Make mandatory. |
| **D10** | **Functional Role location/department scoping**? | Today FR is global. | Keep global unless you need scoping. |
| **D11** | **E-signature scope** — which exact actions must be e-signed vs reason-only? | Currently broad. Note wants it "simplified". | Provide final action list. |
| **D12** | **Location** — which modules actually need Location selection/filter (see §15 table)? | Affects many forms/reports. | Confirm the list in Section C-5. |

---

# SECTION B — Module-wise changes

## 1. User Creation / New Employee Workflow  *(Page 1)*
**Current:** Request → IT-admin approve → user created; temp password generated; `mustChangePassword` forces reset on first login (🟩). Request form already has User Type, Full Name, Employee ID, Email, Department, Location, Supervisor, Functional Role(s), RBAC Roles, Remarks. Username is **entered** (`windowsUsername`), not auto-generated. Email is **optional**. Active/Inactive filter exists (🟩). Inactive users excluded from supervisor picker (🟩).

| CR | Issue | Required change | UI | Backend/DB | RBAC | Audit | Loc | Pri | Dep |
|---|---|---|---|---|---|---|---|---|---|
| **CR-U1** 🟧 | Username manually typed | Auto-generate username from full name (lowercase, e.g. `first.last`), editable-on-clash | New User Request: username field auto-fills, read-only or suffix-on-clash | `generateUsername()` + uniqueness check in `createUserRequest` | userManagement.create | capture generated username | – | High | D8 |
| **CR-U2** 🟧 | Email optional | Make email **mandatory** (temp password delivery depends on it) | required validation | `createUserSchema.email` → required | – | – | – | High | D9 |
| **CR-U3** 🟩 | — | Temp password emailed + forced change on first login | exists | `notifyPasswordReset`/`mustChangePassword` | – | already audited | – | — | verify SMTP live |
| **CR-U4** 🟧 | Reporting Manager term | Label "Supervisor" → "Reporting Manager" on request/edit | label only | none (keep `supervisorId`) | – | – | – | Med | D1 |
| **CR-U5** 🟩 | — | RBAC + Functional Role(s) multi-select in request/edit | exists | `designationIds`, `roleIds` | – | – | – | — | — |
| **CR-U6** 🟩 | — | View / Edit / Activate-Deactivate; Active/Inactive filter; inactive excluded from pickers | exists | exists | userManagement view/edit/approve | exists | user has Location ✓ | — | verify |

**§ checklist (User Mgmt):** L=Yes V=Yes E=Yes A=Yes(deactivate, no hard delete) H=Yes F=Yes.

## 2. Reporting Manager / Team Management  *(Page 1–2)*
**Current:** Supervisor = searchable single-select of **active** users, excludes self (🟩). Team module + `team` RBAC, `/users/team` + `/users/team/:id/history`, MyTeam page with training/assessments/JD/CV/cert/TNI + history drill-in (🟩). Backend scoped by `supervisorId` (🟩). Supervisor change e-signed + audited (🟩).

| CR | Issue | Required change | UI | Backend | RBAC | Audit | Pri |
|---|---|---|---|---|---|---|---|
| **CR-RM1** 🟧 | "Supervisor" wording | Rename to **Reporting Manager** across User mgmt, Team page, JD, reports labels | labels | — | — | — | Med (D1) |
| **CR-RM2** 🟩 | — | RM sees team training/JD/CV/TNI/assessment/cert/history per `team` permission | exists | `listMyTeam`/`getTeamMemberHistory` | team.view/print/export | — | verify |
| **CR-RM3** 🟧 | Team reports | Add Reporting-Manager **filter** to relevant reports | reports filter | report.service filter by supervisorId | reports.view | export audited | Med |

**§ checklist (Team):** L=No V=Yes E=No(read-only) A=No H=n/a F=via search.

## 3. Job Description Workflow  *(Page 2–3)*
**Current:** JD templates keyed by Functional Role; assign auto-creates APPROVED JD; "My Job Description" shows content + acknowledge (typed sentence + e-sign) (🟩). Reject exists on template transition. "My JD" exists. Print/View on JD list = partial.

| CR | Issue | Required change | UI | Backend | RBAC | Audit | Pri | Dep |
|---|---|---|---|---|---|---|---|---|
| **CR-JD1** 🟩 | — | Templates per Functional Role; auto-fetch content on assign | exists | `assignFunctionalRole` | jobDescription.assign | CREATE/ACKNOWLEDGE | — | — |
| **CR-JD2** 🟧 | Button wording | Ensure action labelled **"Assign JD"**; show **user name** clearly on assign | label + show user | — | — | — | Med | — |
| **CR-JD3** 🟧 | JD list columns | Show User · Status · Approved by · Done/Ack status · View/Edit · Active | list columns | list returns approver + ack | jobDescription.view | — | High | — |
| **CR-JD4** 🟧 | Print/View | Add **Print** + **View** on JD + My JD | print/view btns | reuse print lib | jobDescription.print | PRINT | Med | — |
| **CR-JD5** 🟧 | Reject option | Decide: keep Reject (template review) vs Acknowledge-only (user) | conditional | keep transition; hide user reject | — | — | Med | D3 |
| **CR-JD6** 🟧 | Controlled template edit | Approved template must not change silently → version/controlled edit | edit→new version | template version flow | jobDescription.edit + e-sign | UPDATE+reason | High | — |
| **CR-JD7** 🟧 | Assigner role | Allow Dept Head / Reporting Manager to assign JD | — | grant assign verb | jobDescription.assign | — | Med | D4 |

**§ checklist (JD):** L=No V=Yes E=Yes(controlled) A=Yes(obsolete) H=Yes F=Yes.

## 4. Dashboard & Navigation  *(Page 3)*
**Current:** Role-aware dashboard service with personal + org sections; counts computed server-side (🟩). Some counts were fixed earlier. Risk of stale/demo cards + wrong navigation targets.

| CR | Issue | Required change | UI | Backend | RBAC | Pri |
|---|---|---|---|---|---|---|
| **CR-D1** 🟧 | Possible demo/unused cards | Audit dashboard cards; remove non-applicable; ensure each links to correct module | card cleanup + links | dashboard.service | dashboard.view | High |
| **CR-D2** 🟧 | Role relevance | Show role-specific cards (Super Admin / Reporting Mgr / Trainer / Trainee / IT Admin) | conditional cards | role-aware payload | per-module view | High |
| **CR-D3** 🟧 | Count correctness | Re-verify pending/completed/overdue counts vs assignments | — | dashboard.service counts | — | High |
| **CR-D4** 🟦 | Dashboard config (optional) | If configurable cards needed → config + audit | config UI | systemConfig | systemConfig + dashboard.configure | Low |

**§ checklist (Dashboard):** L=No V=Yes E=No A=No.

## 5. Master Setup  *(Page 4)*
**Current:** Tabs Locations/Departments/Functional Roles/Training Types/Document Types; Active/Inactive filter + Include-Inactive; soft-delete only (🟩). Designation tab renamed to Functional Roles (🟩). `code` field still shown on masters.

| CR | Issue | Required change | UI | Backend | RBAC | Audit | Pri | Dep |
|---|---|---|---|---|---|---|---|---|
| **CR-M1** 🟩 | — | Active/Inactive filter on all tabs; no hard delete; activate/deactivate | exists | exists | masterSetup view/create/edit | exists | — | verify all tabs |
| **CR-M2** 🟧 | `code` field clutter | Remove/auto-generate `code` where not needed (e.g. Functional Role, Training Type) | hide code or auto | keep `code` unique internally, auto-generate | — | — | Med | confirm which masters |
| **CR-M3** 🟧 | Training "Code/name" | Ensure Training Type master used as **Training Type** (not "code") consistently | label | — | — | — | Med | — |
| **CR-M4** 🟧 | Search/filter | Ensure search + Active/Inactive on **every** tab | filter row | list params | — | — | Med | — |
| **CR-M5** 🟦 | Print/Export/Bulk | Add Print/Export per master if required | btns | export util | masterSetup print/export | PRINT/EXPORT | Low | confirm |

**§ checklist (each master):** L=only Departments(→Location) V=Yes E=Yes A=Yes(deactivate) H=Yes F=Yes Restore=Yes Print/Export=optional Bulk=optional.

## 6. Functional Role  *(Page 4–5)*
**Current:** Designation→Functional Role rename in UI (🟩); multi-select arrays on user + topic (🟩); Active/Inactive + soft-delete (🟩); used in User/New-Request/Edit/Course/JD/TNI/CV header (🟩).

| CR | Issue | Required change | Pri |
|---|---|---|---|
| **CR-FR1** 🟧 | A few leftover "Designation" strings | Sweep remaining user-facing "Designation" (keep only CV previous-role) + **Audit-trail display** label, **Reports filter** label | Med |
| **CR-FR2** 🟧 | Reports/Filters by FR | Add Functional Role **filter** to reports + team/CV filters | Med |
| **CR-FR3** 🟩 | — | Multi-FR per user + per topic; Active/Inactive; no hard delete | verify |

**Decision:** D2, D10. **Audit:** FR change on user already via `updateUser` diff.

## 7. Roles & Access Control  *(Page 5–6)*
**Current:** 10-verb matrix UI (per-module), e-sign on role create/edit/deactivate (🟩); legacy fallback; role inactive → blocks login when user has no active role (🟩). Module shows **all** verbs even when not applicable. Nav label "Roles & Permissions".

| CR | Issue | Required change | UI | Backend | Audit | Pri | Dep |
|---|---|---|---|---|---|---|---|
| **CR-RA1** 🟧 | Name | Rename to **"Roles & Access Control"** (nav + title) | label | — | — | Low | D7 |
| **CR-RA2** 🟥 | Matrix shows irrelevant actions | Show **only actions that exist** per module (per-module action catalog) | matrix driven by per-module verb catalog | define `MODULE_ACTIONS` map; validate on save | PERMISSION_CHANGE | **High** | needs catalog (below) |
| **CR-RA3** 🟧 | Missing verbs | Ensure catalog covers: view/create/edit/activate-deactivate/archive/restore/assign/approve/reject/acknowledge/print/export/import/bulk/configure/viewOwn/viewTeam/viewAll/resetPassword/assignReportingManager/assignFunctionalRole | matrix | extend verb set | — | High | D11 |
| **CR-RA4** 🟧 | Labels | User-friendly module + verb labels | label map | — | — | Med | — |
| **CR-RA5** 🟧 | E-sign simplify | Review which actions need e-sign vs reason-only | — | gate config | ESIGN | Med | D11 |
| **CR-RA6** 🟩 | — | Role inactive blocks access; perm change audited | exists | exists | PERMISSION_CHANGE | verify | — |

> **Note:** CR-RA2/RA3 are the biggest RBAC effort — defining the **per-module action catalog** so the matrix hides N/A actions. Needs the master action→module map (I can draft it for approval).

## 8. Training Topic / Course Creation  *(Page 6–7)*
**Current:** Form has title, topicNumber, sopNumber, description, trainingType(single), department, functionalRole(s) multi, role(s), duration, passingScore, maxAttempts, questionLimit, refresher, materialViewSeconds, effective/review date, sequence, signatoryUserIds, requiresAssessment. Signatories persisted (🟩). Sequence enforced (🟩). Training Type master editable (🟩). Multi-FR (🟩).

| CR | Issue | Required change | Pri | Dep |
|---|---|---|---|---|
| **CR-T1** 🟧 | "Topic No." vs SOP | Rename **Topic No. → SOP Number**; remove the duplicate (topicNumber vs sopNumber → keep one) | High | D6 |
| **CR-T2** 🟧 | Optional Role field | Remove RBAC **Role** field from topic if assignment via FR/TNI/JD | Med | D6 |
| **CR-T3** 🟧 | Training Type single | Allow **multiple** Training Types if required | Med | D6 |
| **CR-T4** 🟧 | Department field | Remove if not used by final flow, else justify | Med | D6 |
| **CR-T5** 🟧 | Duration | Remove if not required | Low | D6 |
| **CR-T6** 🟧 | Min material reading time | Remove if not required (note: it powers the reading-gate — confirm) | Med | D6 |
| **CR-T7** 🟧 | Next Review / Sequence | Remove if not needed | Low | D6 |
| **CR-T8** 🟧 | Draft-first | Keep only **Save as Draft** if final flow is draft-first | Med | D6 |
| **CR-T9** 🟩 | — | Signatories table (User · Prepared/Reviewed/Approved · Date); auto-select by function | enhance UI to show table + date + role | Med |
| **CR-T10** 🟧 | Signatory auto-complete | When sign mode used, auto-select signatory by function; their training auto-complete (already on publish) | Med |

**§ checklist (Courses):** L=optional V=Yes E=Yes Publish=Yes Revise=Yes A=Yes(archive) Print=Yes Export=Yes.

## 9. Material / PDF Viewer / Library  *(Page 7)*
**Current:** Inline viewer sizing fixed (80vh, fit-h, no crop) (🟩) but **no zoom in/out**, **no explicit fit-to-width/fit-to-page buttons** (uses iframe with native toolbar hidden). Library = single upload tied to a topic; attach-from-library exists (🟩). **No bulk upload.** Post-completion lock config exists (🟩).

| CR | Issue | Required change | UI | Backend | RBAC | Pri |
|---|---|---|---|---|---|---|
| **CR-MAT1** 🟥 | No zoom/fit controls | Build a **controlled PDF.js viewer** with zoom in/out + fit-width/fit-page + page nav, no download/print when disallowed | new viewer component used in course preview / library / reading | serve blob (exists) | materialManagement.view | **High** |
| **CR-MAT2** 🟥 | No bulk upload | Material Library **bulk upload** + reuse into topics | multi-file upload UI | bulk endpoint | materialManagement.create/import | High |
| **CR-MAT3** 🟧 | Metadata | Auto-read/save metadata (size/type) on save | — | on upload | — | Med |
| **CR-MAT4** 🟩 | — | View-only lock (no download/print) where required | exists | config | — | verify |

**§ checklist (Material):** L=No V=Yes Upload=Yes Bulk=Yes Edit-meta=Yes A=Yes Print/Export=conditional.

## 10. Assessment  *(Page 8)*
**Current:** One-question-at-a-time + timer + auto-submit + single-tab guard (🟩); shows topic title not ID (🟩); linked to topic+version+user (🟩); certificate on pass (🟩).

| CR | Issue | Required change | Pri |
|---|---|---|---|
| **CR-AS1** 🟧 | Naming/display | Verify assessment list/screens show **SOP/Topic name** everywhere (no IDs); friendly titles | Med |
| **CR-AS2** 🟩 | — | One-question, timer, version link, result/cert | verify only |
| **CR-AS3** 🟧 | Review/Print | Add result **Print/Export** if required | Low |

**§ checklist (Assessment):** V=Yes Start=Yes Submit=Yes Review=Yes Print=optional.

## 11. CV / My CV  *(Page 8)*
**Current:** Header auto-fetch (name/code/FR/dept) (🟩); structured languages read/write/understand (🟩); repeatable education/experience/trainings/publications (🟩); save/reload (🟩); visible to owner/RM/admin (🟩).

| CR | Issue | Required change | Pri |
|---|---|---|---|
| **CR-CV1** 🟩 | — | Approved CV format, auto-fetch header, structured/multi-row, visibility | verify only |
| **CR-CV2** 🟧 | Print/Export | Ensure clean **PDF/Print** + Export per RBAC; "Reporting Manager" wording in Team CV | Med |
| **CR-CV3** 🟧 | Team CV filters | Add filters: name, emp ID, dept, Functional Role(s), Active/Inactive | Med |

**§ checklist (CV):** L=No V=Yes E=Yes(own) Print/PDF=Yes Export=Yes.

## 12. TNI  *(Page 9)*
**Current:** Requirement matrix (topics × roles) Required/Not-Required; drives role-based assignment; e-signed apply; assign-later (🟩). Matrix keyed by **RBAC role** today, note wants **Functional Role**. Bundle still present.

| CR | Issue | Required change | Pri | Dep |
|---|---|---|---|---|
| **CR-TNI1** 🟧 | Matrix keyed by RBAC role | Key TNI matrix by **Functional Role** (per note "SOP × Functional Role") | High | D2 |
| **CR-TNI2** 🟧 | Bundle overlap | Hide/retire Bundle; TNI is the assignment workflow | Med | D5 |
| **CR-TNI3** 🟩 | — | Required/Not-Required, assign by FR/JD/direct, e-sign | verify |
| **CR-TNI4** 🟧 | Professional UI | Polish matrix screen (labels, counts, clarity) | Med | — |

**§ checklist (TNI):** L=optional V=Yes Create/Edit-matrix=Yes Approve=Yes Assign=Yes Print/Export=Yes.

## 13. Reports  *(Page 9)*
**Current:** ~17 report types incl effective→completion-days, role/dept/version/training-type-wise; PDF/XLSX/CSV with title/generated-by/date/page numbers; permission-gated (🟩). Some still surface IDs; filters incomplete (FR/RM/Location).

| CR | Issue | Required change | Pri |
|---|---|---|---|
| **CR-R1** 🟧 | IDs in some reports | Ensure **readable names** everywhere (topic, user, dept, FR) | High |
| **CR-R2** 🟧 | Filters | Add **Location / Department / Functional Role / Reporting Manager** filters where applicable | High |
| **CR-R3** 🟩 | — | Print/Export with header metadata, permission-gated, audited | verify |
| **CR-R4** 🟧 | Fields | Training reports include completion status, day-difference, FR, dept, location | Med |

**§ checklist (Reports):** L=filter V=Yes Print=Yes Export=Yes.

## 14. Audit Trail  *(Page 9)*
**Current:** Prisma middleware audits all models; old/new diff; reason; e-sign ref; IP/session; no-op skip; insert-only (🟩). **Display shows entityType + entityId (IDs), not always readable record names.**

| CR | Issue | Required change | Pri |
|---|---|---|---|
| **CR-AU1** 🟧 | IDs in audit display/export | Resolve **readable record names** (user, topic, role, FR) in audit list + export | High |
| **CR-AU2** 🟩 | — | Who/when/module/old/new/reason/e-sign/IP; insert-only; export | verify |
| **CR-AU3** 🟧 | Coverage sweep | Confirm every action in §15 list writes an audit row (assign RM, assign FR, reset pwd, publish, revise, acknowledge, etc.) | Med |

---

# SECTION C — Consolidated lists

## C-1. Decisions needed from you
D1 (Reporting Manager rename) · D2 (multi FR) · D3 (JD reject) · D4 (JD assigner) · D5 (Bundle vs TNI) · D6 (topic field pruning — per-field yes/no) · D7 (Roles & Access Control rename) · D8 (username format) · D9 (email mandatory) · D10 (FR scoping) · D11 (e-sign action list) · D12 (Location module list).

## C-2. Implementation phase plan (after approval)
1. **Phase 1 — Naming & masters (low risk):** D1 RM rename, D7 RBAC rename, FR string sweep (CR-FR1), master `code` cleanup (CR-M2/3/4).
2. **Phase 2 — RBAC catalog (foundational):** per-module action catalog → matrix hides N/A actions (CR-RA2/3/4), e-sign simplification (CR-RA5).
3. **Phase 3 — User & JD workflow:** username auto-gen + email mandatory (CR-U1/U2), JD list columns + Assign-JD labels + print/view + controlled template edit (CR-JD2…JD7).
4. **Phase 4 — Training Topic pruning + signatories table (CR-T1…T10)** per D6.
5. **Phase 5 — PDF.js viewer + material bulk upload (CR-MAT1/2/3).**
6. **Phase 6 — TNI by Functional Role + retire Bundle (CR-TNI1/2/4).**
7. **Phase 7 — Reports filters + readable names; Audit readable names (CR-R1/2/4, CR-AU1/3).**
8. **Phase 8 — Dashboard cleanup + role cards (CR-D1/2/3).**
9. Re-seed live roles after RBAC catalog change; re-verify build/tests; redeploy.

## C-3. Conflicts with already-implemented features
- **TNI matrix** currently keyed by **RBAC role** → CR-TNI1 re-keys to Functional Role (rework).
- **Training Topic** fields (department/duration/reviewDate/sequence/topicNumber) are **built + wired**; D6 removals will unwind some recent work.
- **JD reject** transition exists; D3 may remove user-facing reject.
- **Bundle** module is built; D5 retires it.
- **RBAC matrix** shows all verbs; CR-RA2 (per-module catalog) changes the matrix UI + seed shape → needs live re-seed.
- **"Supervisor"** is wired end-to-end; D1 rename touches many labels.

## C-4. Modules requiring View / Edit / Archive-Deactivate
User Mgmt, Roles, Master Setup (all tabs), Functional Roles, Training Topics, Materials, JD/JD-Templates, TNI matrix, Announcements, Certificate Templates, Feedback forms, CV (view/edit own). *(All soft-delete only — no hard delete.)*

## C-5. Modules requiring Location mapping
**Yes:** User (has location), Department (belongs to location), Training Schedule/Attendance (venue/site), Reports (location filter), optionally Training Topic + TNI (site-specific SOPs). **No:** Roles, Functional Role (global unless D10), JD templates, CV, Assessment, Audit.

## C-6. Roles & Access Control updates required
- Per-module **action catalog** (hide N/A verbs) — CR-RA2.
- Add verbs: activate-deactivate, restore, reject, acknowledge, import, bulk, configure, viewOwn, viewTeam, viewAll, resetPassword, assignReportingManager, assignFunctionalRole — CR-RA3.
- Rename module → "Roles & Access Control" — CR-RA1.
- Friendly labels — CR-RA4.
- E-sign action list finalized — CR-RA5/D11.
- Re-seed 4 roles with new catalog after change.

## C-7. Audit Trail updates required
- Readable record names in display + export — CR-AU1.
- Coverage confirmation for: assign Reporting Manager, assign Functional Role, reset password, JD assign/acknowledge, template controlled-edit, topic publish/revise/archive, material upload/bulk, TNI matrix change/apply, CV create/update, report print/export — CR-AU3.
- Keep insert-only + no-op skip (already done).

---

## Priority summary
- **Critical/High:** CR-RA2 (action catalog), CR-MAT1 (PDF.js viewer), CR-MAT2 (bulk upload), CR-JD3/JD6, CR-U1/U2, CR-D1/2/3, CR-R1/2, CR-AU1, CR-T1, CR-TNI1.
- **Medium:** RM/RBAC renames, CR-T2…T10, CR-FR1/2, CR-CV2/3, CR-TNI2/4, CR-M2/3/4, CR-AS1.
- **Low:** CR-RA1, CR-T5/T7, CR-AS3, CR-D4, CR-M5.

**Nothing implemented. Awaiting your decisions (D1–D12) and approval of this list.**
