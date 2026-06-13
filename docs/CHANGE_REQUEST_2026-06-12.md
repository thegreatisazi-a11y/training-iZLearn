# izLearn — Change Request & Requirement Document
**Sources:** Testing report `izLearn Testing Report 120626.docx` (31 items) · handwritten review notes (5 pages, Piyush Sir / Nirav Sir / Gayathri / Rushi) · current `training-tran-main` codebase.
**Status:** For review — **no code changed yet.** Implement only after approval.

**Legend:** `T#` = testing-report item · `HW` = handwritten note · Priority = Critical / High / Medium / Low.
Each change lists: Current issue · Required change · UI · Backend/data · RBAC · Priority.

---

## ⚠️ SECTION A — Decisions needed from you first (these reverse or reshape existing work)

These conflict with what's already built; your answer changes the scope of many items below. Please decide:

- **D1 — Designation.** HW (User Creation page) says **"No designation."** But designation was added across users/topics/bundles/reports. → **Remove designation everywhere, or keep it?**
- **D2 — Bundle vs TNI.** HW: *"No need of bundle as TNI is done"* and *"Bundle & TNI almost same?"*. A full Bundle module exists. → **Drop/hide Bundles and drive assignment through TNI, or keep both?**
- **D3 — Unpublish ≠ Archive (T30).** Currently "Unpublish" sets status **ARCHIVED**. Report says unpublish should not archive directly. → Confirm: **Unpublish → DRAFT/UNDER_REVIEW**, and Archive is a separate explicit action?
- **D4 — Material archive on revise.** HW: *"no archive thing (for revise), keep in material only."* Current build has an "Archived Materials" status + `supersededByTopicId`. → **Drop the archive status and just keep old versions in Version History / Material Library?**
- **D5 — E-signature scope.** HW: *"E-sign – not needed okay (for change); username autofetch, password fill, just Approve, ☑ T&C type."* Report T12 wants e-sign (secondary password) for **edit user**. → Define the lighter model: **secondary-password + "I approve / T&C" checkbox**, applied to which actions (publish/revise/approve/edit-user), and which actions need **no** e-sign.
- **D6 — Role model.** HW defines 4 roles: **Super Admin** (everything), **Supervisor** (user management & assignment), **Trainer** (course creation), **Trainee** (take course). Current seed ships 8 GMP roles. → **Replace the seeded role set with these 4 (keep the 10-verb matrix underneath), or keep 8?**
- **D7 — Due date.** HW: *"No due date because someone may join after due date"* + *"after due date → mail; needs approval from respective supervisor."* → Confirm: **due date optional**, and an **after-due escalation** (notify + supervisor approval) instead of hard due dates.
- **D8 — Storage/DB direction.** (Carried over) Files currently default to MongoDB (≤15 MB/file) for the free Render+Atlas demo. Keep as-is for now? (No action needed unless you want R2.)

---

## SECTION B — Module-wise changes

### 1. Roles & Permissions
**CR-1 — Make roles actually go inactive + enforce it (T1)** — *Current:* a deactivate exists (soft) but an inactive role does **not** block its users. *Required:* toggling a role Inactive must (a) persist, (b) **prevent login** for users whose only/all active roles are inactive, and (c) block role-change requests referencing it. *UI:* explicit Active/Inactive toggle on the role row + confirm. *Backend:* on login/`buildAuthUser`, drop inactive roles; if user has no active role → deny login with a clear message; guard `changeRoles` against inactive roles. *RBAC:* `roleManagement:edit`. *Priority:* **Critical**.

**CR-2 — "Select all" checkbox in one click (T2)** — *Current:* permission matrix + multi-selects have no select-all. *Required:* a select-all (per row / per column / all) in the role permission matrix, and in multi-selects. *UI:* header checkboxes in `PermissionMatrixEditor`; "Select all" in `MultiSelect`. *Backend:* none. *RBAC:* `roleManagement:edit`. *Priority:* **Medium**.

**CR-3 — View (read-only) mapped permissions (T5)** — *Current:* only an Edit dialog. *Required:* a **View** action showing the role's permission matrix read-only. *UI:* View button → read-only matrix dialog. *Backend:* none. *RBAC:* `roleManagement:view`. *Priority:* **Medium**.

**CR-4 — Search role by description (T6)** — *Current:* search matches `roleName` only. *Required:* also match `description`. *UI:* none (same box). *Backend:* `listRoles` where-clause add description contains. *RBAC:* `roleManagement:view`. *Priority:* **Low**.

**CR-5 — Active/Inactive filter + Print for roles (T7)** — *Current:* includeInactive exists; no print. *Required:* explicit Active/Inactive filter control + Print. *UI:* filter toggle + Print button (gated). *Backend:* none (print client-side). *RBAC:* `roleManagement:view` (filter), `roleManagement:print`. *Priority:* **Medium**.

**CR-6 — RolesPage edit should follow the agreed e-sign model (see D5)** — *Current:* reason-only textarea. *Required:* per D5 (secondary password + approve/T&C). *Priority:* **High** (pending D5).

---

### 2. Audit Trail
**CR-7 — "Anonymous" username must be the real user (T3)** — *Current:* pre-auth/system actions log `Anonymous` (`ANON_ACTOR`). *Required:* every user-initiated action records the actual username; only genuine system jobs show `SYSTEM`. *UI:* none. *Backend:* ensure `auditContext` actor is set before any audited write on authenticated routes; audit the right actor on login events. *RBAC:* n/a. *Priority:* **High**.

**CR-8 — Change Details in human-readable form (T4)** — *Current:* field diff shows raw JSON keys (`passingScorePercent: 70 → 80`). *Required:* friendly field labels + readable values (dates formatted, ids resolved to names where feasible), `old → new`, plus reason. *UI:* `AuditTrailPage` change-details renderer with a field-label map. *Backend:* optionally include label metadata. *RBAC:* `auditTrail:view`. *Priority:* **High**.

**CR-9 — Audit trail captures Who / When / Changed / old→new / Why (HW)** — *Current:* mostly present (user, timestamp, action, old/new, reason). *Required:* confirm every controlled change records all five and surface them in the export. *UI:* columns/diff. *Backend:* verify reason propagation on all edit paths. *RBAC:* `auditTrail:view/export`. *Priority:* **High**.

**CR-10 — Fix audit-trail export error (T17)** — *Current:* export throws. *Required:* fix PDF/CSV/XLSX export (likely a render/streaming issue post-Mongo). *UI:* none. *Backend:* `exportAudit` controller + pdfGenerator. *RBAC:* `auditTrail:export`. *Priority:* **Critical**.

**CR-11 — No-op edits must not write or audit (T18)** — *Current:* saving with no real change still updates and writes an audit row. *Required:* detect "no fields changed" and skip the write + audit entry (return early). *UI:* none. *Backend:* compare before/after in update services (topic/user/role/master/etc.) and short-circuit. *RBAC:* n/a. *Priority:* **High**.

---

### 3. User Management
**CR-12 — Show assigned role(s) on the user list + View + Print + Active/Inactive filter + Export PDF/Excel (T9)** — *Current:* user rows don't show roles; no detail view; no export. *Required:* role column, a **View** user detail, **Print**, Active/Inactive filter, **Export to PDF & Excel**. *UI:* UsersPage column + View dialog + export/print buttons (gated). *Backend:* include roleNames in list; an export endpoint (reuse report exporter). *RBAC:* `userManagement:view/print/export`. *Priority:* **High**.

**CR-13 — Mandatory fields marked + enforced (T11)** — *Current:* forms don't mark required; server validates. *Required:* visible required markers; block submit until filled. *UI:* asterisks + disabled submit + inline errors across forms. *Backend:* none (already validates). *RBAC:* n/a. *Priority:* **High**.

**CR-14 — E-signature (secondary password) for edit user (T12, see D5)** — *Current:* edit-user uses reason-only. *Required:* secondary-password e-sign per agreed model. *UI:* e-sign step on user edit. *Backend:* `signFromRequest` on `updateUser`. *RBAC:* `userManagement:edit`. *Priority:* **High**.

**CR-15 — User creation flow + "No designation" (HW, D1)** — *Current:* request→approve exists; designation present. *Required:* per HW: HR adds details → request to IT → IT accepts; mail addable by HR or IT; **remove designation** (pending D1). *UI:* remove designation field; clarify HR/IT steps. *Backend:* drop `designationId` usage (pending D1). *RBAC:* `userManagement:create/approve`. *Priority:* **Medium**.

**CR-16 — User lifecycle flow (HW)** — User → JD → CV → TNI ack → TNI → completion → **User release**. *Required:* model the end-to-end flow incl. a "release" state. *UI:* user detail shows stage. *Backend:* status field / derived stage. *RBAC:* `userManagement`. *Priority:* **Medium** (design first).

---

### 4. Authentication / Passwords / E-signature
**CR-17 — Reset Password resets BOTH login + signature password (T15)** — *Current:* reset sets login password only. *Required:* reset generates/forces both login and signature passwords. *UI:* reset confirmation notes both. *Backend:* `resetPassword` also resets signature password + mustChange flags. *RBAC:* `userManagement:write`. *Priority:* **High**.

**CR-18 — Login & signature password must differ + 4-field dialog (T13)** — *Current:* no difference check; set-signature dialog has 3 fields. *Required:* enforce signature ≠ login; dialog gets a 4th field (**old signature password**) alongside new/confirm. *UI:* `SignaturePasswordDialog` 4 fields. *Backend:* `setSignaturePassword` validates difference + old-password check. *RBAC:* self. *Priority:* **High**.

**CR-19 — Specific error messages (T10, T14)** — *Current:* generic "Validation failed"; generic mismatch errors. *Required:* surface the **actual** field error (e.g. "New signature and confirm password must match"); map Zod field errors to readable messages on the frontend. *UI:* `apiError`/form error rendering uses `error.details`. *Backend:* ensure error `details` carry field+message. *RBAC:* n/a. *Priority:* **High**.

**CR-20 — Reset = IT/AD; Change = user; E-sign T&C model (HW, D5)** — *Required:* document/align: password reset via IT (Active Directory) or own-AD; change by user; e-sign = username autofetch + password + "I approve" / T&C checkbox. *UI:* e-sign modal adds a T&C checkbox; username pre-filled (already). *Backend:* per D5. *RBAC:* n/a. *Priority:* **Medium** (pending D5).

---

### 5. Cross-cutting — Date/Time, Export, Print, Validation
**CR-21 — Date/time format `dd/mm/yy HH:MM` (T8)** — *Current:* `DD/MM/YYYY HH:MM` (4-digit year). *Required:* 2-digit year `dd/mm/yy HH:MM` everywhere (UI + exports/PDF). *UI:* `lib/format` + backend `dateUtils`. *Backend:* report/cert/audit formatters. *RBAC:* n/a. *Priority:* **Medium**.

**CR-22 — Export to PDF & Excel where applicable (T9, HW)** — *Required:* topics, users, roles, bundles(if kept), TNI, training records, reports, audit — PDF + CSV/Excel, **permission-gated**. *UI:* export buttons. *Backend:* reuse exporters. *RBAC:* `<module>:export`/`:print`. *Priority:* **High**.

**CR-23 — Print button works + verify printed content (T21)** — *Current:* `lib/print` print may be incomplete/broken. *Required:* fix print output (correct title, columns, printed-by/date, page numbers). *UI:* print templates. *Backend:* n/a (client) / report PDF for server prints. *RBAC:* `<module>:print`. *Priority:* **High**.

---

### 6. Courses / Training Topics, Version History, Material archive
**CR-24 — Better course Version History (T-HW, "need to do better/req")** — *Current:* `TopicVersionHistory` snapshots exist; presentation is basic. *Required:* a clear history view per HW p2: **Version no., old files, new files, old questions, updated questions, changed by, changed date/time, reason, status**. *UI:* richer Version History tab. *Backend:* ensure snapshot captures old+new file sets and question sets per version. *RBAC:* `topicVersionHistory:view` (or `courseManagement:view`). *Priority:* **High**.

**CR-25 — Remove "archive" concept on revise — keep old in material/history only (HW, D4)** — *Current:* superseded files get an Archived status + `supersededByTopicId`. *Required (pending D4):* on revise, old materials simply live in Version History / Material Library; no separate "archived" status flow. *UI:* drop Archived Materials section; show via history. *Backend:* simplify revise/material status. *RBAC:* `courseManagement:revise`. *Priority:* **High**.

**CR-26 — Unpublish must not archive directly (T30, D3)** — *Current:* Unpublish = ARCHIVED. *Required:* Unpublish → DRAFT/UNDER_REVIEW; Archive is a distinct, explicit action. *UI:* separate Unpublish vs Archive buttons. *Backend:* `updateTopicStatus` semantics. *RBAC:* `courseManagement:edit`(unpublish) vs `:archive`. *Priority:* **High**.

**CR-27 — Fix topic name shown for assessment (T27)** — *Current:* wrong/garbled topic name in the assessment screen. *Required:* show correct topic title + number/version. *UI:* TakeAssessmentPage header. *Backend:* verify `start` returns correct topic data. *RBAC:* n/a. *Priority:* **High**.

**CR-28 — Reason for change in audit on every course change (HW)** — covered by CR-9/CR-11; ensure revise/publish/edit all carry reason. *Priority:* **High**.

**CR-29 — Course-in-sequence (HW "need to think")** — *Required (design):* ability to order topics so a user takes them in sequence. *UI:* sequence field/order. *Backend:* order index on assignment/bundle/TNI. *RBAC:* `courseManagement`. *Priority:* **Low** (design).

**CR-30 — Multiple roles per training topic (T16)** — *Current:* topic has a single `roleId`. *Required:* allow **multiple roles** mapped to a topic. *UI:* MultiSelect for roles on the topic form. *Backend:* change topic `roleId` → `roleIds: string[]` (Json) and assignment resolution. *RBAC:* `courseManagement:edit`. *Priority:* **High**.

---

### 7. Material Library & material access control
**CR-31 — Add option in Material Library (HW)** — *Current:* library lists materials; upload tied to a topic. *Required:* clarify/extend the "add" option in the library (standalone add + reuse). *UI:* Add to library. *Backend:* allow library-level material records. *RBAC:* `materialManagement:create`. *Priority:* **Medium** (clarify scope).

**CR-32 — Disable Download / Print / Google-Drive / Highlight in the material viewer for all roles (T22, T23)** — *Current:* the in-app PDF viewer (iframe/native) exposes the browser PDF toolbar (download, print, open-in-Drive) and text highlight. *Required:* a controlled viewer with **no download/print/save/highlight** for any role. *UI:* render via a locked viewer (e.g. PDF.js with toolbar disabled, or overlay) instead of the native iframe toolbar. *Backend:* keep streaming, no direct URL. *RBAC:* viewing only. *Priority:* **High**.

**CR-33 — No access to material once the SOP/training is complete (HW)** — *Current:* materials remain viewable. *Required:* after a user completes the training, they can no longer open its material. *UI:* hide/disable view post-completion. *Backend:* gate material view/download on assignment-not-completed for trainees. *RBAC:* enforced server-side. *Priority:* **Medium**.

---

### 8. Question Bank / Assessment authoring
**CR-34 — Maximum 4 options per question (T19)** — *Current:* unlimited options. *Required:* cap at **4**. *UI:* prevent adding >4. *Backend:* schema `options.max(4)`. *RBAC:* `questionBank:edit`. *Priority:* **High**.

**CR-35 — Block save when no correct answer selected (T20)** — *Current:* a question can be saved without a correct answer. *Required:* correct answer **mandatory** at creation. *UI:* validation. *Backend:* `createQuestionSchema` superRefine requires a non-empty correctAnswer for the type. *RBAC:* `questionBank:edit`. *Priority:* **High**.

**CR-36 — Fix Matching-the-pairs question type (T25)** — *Current:* match-the-words answering/grading is broken. *Required:* working create + take + grade for match pairs. *UI:* match UI fix. *Backend:* `gradeQuestion` MATCH path + answer encoding. *RBAC:* n/a. *Priority:* **High**.

**CR-37 — Help text for multi-answer questions (T26)** — *Current:* no hint. *Required:* show "multiple options can be selected" (and per-question help text). *UI:* help text on MCQ-multi (+ optional `helpText` field). *Backend:* optional `helpText` on Question. *RBAC:* `questionBank:edit`. *Priority:* **Medium**.

---

### 9. Assessment taking
**CR-38 — Assessment timer + one question at a time (T24, HW)** — *Current:* all questions shown together, no timer. *Required:* configurable time limit (e.g. 10/15 min) with countdown; **one question displayed at a time** (next/prev); **one go** (no resume for assessment); on **timeout or leaving/closing** → auto-submit (and per HW, treat as fail unless ≥ pass %; ≥80%/pass → auto-save & submit). *UI:* single-question stepper + timer; warn on navigate-away. *Backend:* enforce time window server-side; `assessmentTimeMinutes` on topic; auto-submit on expiry. *RBAC:* `assessments:write`. *Priority:* **Critical**.

**CR-39 — Resume for training (reading) but not for assessment (HW)** — *Required:* reading step can be resumed; assessment is one continuous attempt. *UI:* resume reading; assessment locked once started. *Backend:* attempt start/expiry. *RBAC:* n/a. *Priority:* **High**.

**CR-40 — Website only in one tab (HW)** — *Required:* prevent multiple tabs (esp. during assessment). *UI:* BroadcastChannel/localStorage single-tab guard. *Backend:* single-session already enforced. *RBAC:* n/a. *Priority:* **Medium**.

**CR-41 — SOP with no assessment → T&C checkbox completes (HW)** — *Required:* topics flagged "no assessment" complete via an "I have read & understood (T&C)" checkbox after reading. *UI:* T&C complete button. *Backend:* completion path without an attempt; topic flag `requiresAssessment`. *RBAC:* `assessments:write`. *Priority:* **High**.

---

### 10. Dashboard
**CR-42 — Pending/Completed counts wrong after completion (T28)** — *Current:* a completed+passed training still shows 1 pending + 1 completed. *Required:* on pass, the assignment moves to COMPLETED and is **not** double-counted; refresher creates a new future assignment only when due. *UI:* none. *Backend:* assignment status transition on pass; dashboard count queries de-dupe per topic; check refresher auto-assignment timing. *RBAC:* n/a. *Priority:* **Critical**.

**CR-43 — Dashboard not working properly (T29)** — *Required:* fix the dashboard (counts, sections, role-aware blocks) end-to-end. *UI:* DashboardPage. *Backend:* `dashboard.service`. *RBAC:* per-section. *Priority:* **High** (depends on CR-42).

---

### 11. Master Setup
**CR-44 — Inactive option only, no delete/remove (T31)** — *Current:* master tabs (training types, document types, designations, locations, departments) show Remove/Delete. *Required:* **remove all delete actions**; only an Active/Inactive toggle (soft, no hard delete). *UI:* replace Remove with Active/Inactive toggle on every master tab. *Backend:* keep soft-delete/active flag; no destructive endpoints exposed. *RBAC:* `masterSetup:edit`. *Priority:* **High**.

**CR-45 — Master training-type/doc-type edits: add validation + reason-for-change** — *Current:* PATCH has no validate / no reason. *Required:* validate + reason-for-change like other master edits. *UI:* reason dialog. *Backend:* add `validate` + `requireReasonForChange`. *RBAC:* `masterSetup:edit`. *Priority:* **Medium**.

---

### 12. TNI (Training Need Identification)
**CR-46 — TNI table & fields (HW p2)** — *Required:* TNI table columns **Sr. No. | SOP/Doc No. | Title | Roles… (Required / Not Required)**. *UI:* TNI matrix (topics × roles with Req/Not-Req). *Backend:* TNI model holds role-topic requirement mapping. *RBAC:* `tni:view/edit`. *Priority:* **High**.

**CR-47 — TNI mapping with JD + role-based / direct assignment (HW)** — *Required:* TNI maps to JD and auto-assigns training **based on role**, plus allow **direct** assignment. *UI:* mapping screen. *Backend:* resolve assignments from TNI/role/JD. *RBAC:* `trainingAssignment:assign`. *Priority:* **High**.

**CR-48 — TNI gating on `transition`/decision permission (security)** — *Current:* JD `transition` gated on `read` (a write action). *Required:* gate state-changing transitions on the proper verb. *UI:* none. *Backend:* fix route permission. *RBAC:* `jobDescription:approve`/`edit`. *Priority:* **High** (security).

**CR-49 — Bundle vs TNI (HW, D2)** — per D2, likely **retire Bundle** in favor of TNI-driven assignment. *Priority:* **High** (pending D2).

---

### 13. Job Description (JD)
**CR-50 — JD supervisor-assigned, role→JD, acknowledge (HW p4)** — *Required:* JD is supervisor-specific; 10 roles → 10 JDs; when a person joins, supervisor matches role → assigns JD → **notification** → person must **acknowledge** the JD. *UI:* assign-JD + acknowledge flow on the user side. *Backend:* JD assignment + acknowledgement record + notification. *RBAC:* `jobDescription:assign`, user self-acknowledge. *Priority:* **High**.

**CR-51 — "Review/Approved/Prepared By" signatories — no training needed (HW)** — *Required:* SOP signatories are selected directly in the course and their training is auto-marked complete (shown in their dashboard); they don't take the course. *UI:* signatory selection in course. *Backend:* mark signatory completion. *RBAC:* `courseManagement:edit`. *Priority:* **Medium**.

---

### 14. CV module
**CR-52 — CV created by user, visible in Super Admin + user menu (HW)** — *Required:* a CV module — user creates their CV; Super Admin can view; appears in the user menu (My Training, JD, CV). *UI:* CV page (user) + admin view; nav item. *Backend:* CV model/storage. *RBAC:* user self + `userManagement:view`. *Priority:* **Medium**.

---

### 15. Reports
**CR-53 — Report format & "report in different modules" (HW)** — *Required:* finalize report format; make reports available within their modules (not only the Reports page). *UI:* in-module report views/links. *Backend:* reuse report service. *RBAC:* `reports:view/export/print`. *Priority:* **Medium**.

**CR-54 — Training report: days between effective & done (HW p2)** — *Required:* after filtering by name, show the **difference in days between effective date and completion date**. *UI:* report column. *Backend:* compute eff→done day delta. *RBAC:* `reports:view`. *Priority:* **Medium**.

**CR-55 — Designation-wise / role-wise / version-wise reports (HW, prior)** — keep role/version/designation(if D1 keeps it)/department reports; add Training-Type and Role report (HW "to get from CEAT" reference). *Priority:* **Medium**.

---

### 16. Assignment / Due date / After-due workflow
**CR-56 — Optional due date + after-due mail + supervisor approval (T-HW, D7)** — *Current:* due date is a plain field; refresher auto-assign exists. *Required:* due date optional; **no due date** if a user joins after it; after the due date, **email** the user + on completion-or-not it needs **supervisor approval**. *UI:* due-date optional; supervisor approval queue. *Backend:* overdue job → notify; supervisor approval step. *RBAC:* `trainingAssignment:assign`, supervisor approve. *Priority:* **High**.

**CR-57 — Assignment afterwards / give assignment later (HW)** — *Required:* ability to assign training after the fact and to resume an in-progress (reading) training. *UI:* assign-later action. *Backend:* assignment creation any time. *RBAC:* `trainingAssignment:assign`. *Priority:* **Medium**.

---

### 17. Training Types
**CR-58 — Training type set (HW p5)** — *Required:* support the types from notes: **Self-read, Self-read with evaluation, Quiz, Video, Remote**, plus SOP/Online/Classroom/OJT/Induction/Refresher/Offline. SOP-with-no-assessment uses the T&C-complete path (CR-41). *UI:* training-type select. *Backend:* extend `TrainingType` enum + completion logic per type. *RBAC:* `courseManagement:edit`. *Priority:* **Medium** (confirm final list; note "Training Type to be taken from CEAT" reference).

---

### 18. Reference documents to obtain (HW p1) — not code
- ✓ JD format, ✓ CV format obtained. **✗ Roles/Report format, ✗ Training Type list** still to be received (from CEAT). These block CR-55 / CR-58 finalization. **Action: you to provide.**

---

## SECTION C — Roles & Access Control (consolidated, per D6)
Every new/changed module, button, field, workflow and report above must be permission-gated on **both frontend and backend** using the 10-verb matrix. If D6 = 4-role model, seed presets:
- **Super Admin** — all modules, all verbs.
- **Supervisor** — userManagement (view/create/edit/approve/assign), trainingAssignment (assign), JD (assign/approve), reports (view/print/export), audit (view), dashboard.
- **Trainer** — courseManagement (create/edit/revise/publish), questionBank, materialManagement, reports (view).
- **Trainee** — view/take assigned trainings, My Trainings, JD (acknowledge), CV (self), certificates (self).
New verbs/screens to add to the matrix: TNI, CV, JD-acknowledge, version-history view, material-viewer (no download/print), report export/print per module.

---

## Priority summary
- **Critical:** CR-1 (role inactive enforcement), CR-10 (audit export), CR-38 (assessment timer/one-question), CR-42 (dashboard counts).
- **High:** CR-7, CR-8, CR-9, CR-11, CR-12, CR-13, CR-14, CR-17, CR-18, CR-19, CR-22, CR-23, CR-24, CR-25, CR-26, CR-27, CR-30, CR-32, CR-34, CR-35, CR-36, CR-39, CR-41, CR-43, CR-44, CR-46, CR-47, CR-48, CR-50, CR-56.
- **Medium:** CR-2, CR-3, CR-5, CR-15, CR-16, CR-20, CR-21, CR-31, CR-33, CR-37, CR-40, CR-45, CR-51, CR-52, CR-53, CR-54, CR-55, CR-57, CR-58.
- **Low:** CR-4, CR-29.

**Awaiting your decisions on D1–D8 and the reference formats (Section 18) before implementation.**
