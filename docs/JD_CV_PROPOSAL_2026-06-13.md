# JD & CV Module

This document proposes the screens, workflow, data model, and RBAC for the **Job Description (JD)** and **Curriculum Vitae (CV)** modules. Review and approve (and answer the ❓ decision points) before I implement.

---

## 0. Key concept — "Functional Role" vs "RBAC Role"

The document introduces **Functional Role** (QA Auditor, Analyst, …). This is **NOT** the same as an izLearn login/permission Role (Super Admin / Supervisor / Trainer / Trainee).

- **RBAC Role** = what you can *do* in the app (permissions).
- **Functional Role** = the employee's *job function* — it drives which Job Description they get.

**Proposal:** Introduce **Functional Role** as a master list (15 values below). Because your earlier note was *"No designation,"* the Functional Role **replaces the old Designation** concept — same slot on the user, renamed and given a fixed seeded list. JD templates are keyed by **Functional Role** (optionally + Department), not by RBAC role.

> ❓ **D-JD1:** OK to repurpose the existing `Designation` field as **Functional Role** (rename + reseed with the 15 values), rather than adding a third parallel concept? (Recommended — avoids a 3rd overlapping field.)

**Seeded Functional Roles (15):**
QA Auditor · Apprentice · Jr. Analyst · Analyst · Sr. Analyst · Group Leader · QC Personnel · Operation Head · QA Head · IT Personnel · HR Personnel · Quality Compliance Personnel · Corporate Personnel · Project Management Personnel · Admin Personnel

---

## 1. JD Module

### 1.1 Workflow
```
1. Supervisor opens a user → assigns a Functional Role.
2. System looks up the JD Template for that Functional Role (+ Department).
   → auto-creates an APPROVED, assigned JD for that user (assignedBy = supervisor, assignedAt = now).
   → if no template exists for that functional role: supervisor is warned, no JD assigned (must create template first).
3. User is notified (in-app banner + bell notification + email): "A Job Description has been assigned. Please acknowledge."
4. User opens "My Job Description" → reads content → ticks/clicks acknowledge.
   → must type/confirm exactly: "I acknowledge/accept the assigned responsibilities."
   → optional light e-signature (secondary password) per the e-sign model.
5. acknowledgedAt + acknowledgementSignatureId stored on the JD. Audit trail row written (ACKNOWLEDGE).
6. If the supervisor later changes the user's Functional Role:
   → the old JD is marked OBSOLETE, a new JD is auto-assigned, re-acknowledgement required.
```

> ❓ **D-JD2:** When a JD is auto-assigned from a template, should it land directly as **APPROVED & assigned** (template is already the approved master — recommended, fewer clicks), or go through DRAFT → review → approve each time? Recommended: **directly APPROVED** since the template is the controlled master.

> ❓ **D-JD3:** Acknowledgement signature — **(a)** just the typed sentence + a confirm click, or **(b)** typed sentence **+** secondary-password e-signature (stronger, 21 CFR Part 11-aligned)? Recommended **(b)**.

### 1.2 Screens

**A. Supervisor → User detail → "Functional Role & JD" panel**
- Dropdown: Functional Role (15 values).
- On save: shows "JD '{title}' will be assigned to {user}." → confirm.
- Read-only status line: `JD assigned 12/06/26 14:30 · Acknowledged: ✗ pending` / `✓ 13/06/26 09:10`.

**B. Admin → JD Templates** (already exists, re-keyed to Functional Role)
- Table: Functional Role · Department · Title · Version · Active.
- Create/Edit: Functional Role (dropdown), Department (optional), Title, Rich-text content (responsibilities).

**C. Trainee → "My Job Description"** (new menu item for Trainee)
- Card: Title, Functional Role, Department, Assigned by, Assigned on.
- Rendered JD content (read-only, locked viewer style).
- If not acknowledged: yellow banner + acknowledge box:
  - Required text confirm: ☐ *"I acknowledge/accept the assigned responsibilities."*
  - [Acknowledge] button (opens e-sign modal if D-JD3 = b).
- If acknowledged: green "✓ Acknowledged on 13/06/26 09:10" + signature block.

**D. Dashboard / bell**: "JD pending acknowledgement" item for the trainee; supervisors see "N users have not acknowledged their JD."

### 1.3 Data model (changes to existing `JobDescription`)
Fields already present and reused: `assignedBy`, `assignedAt`, `acknowledgedAt`, `acknowledgementSignatureId`.
Changes:
- `JobDescription.roleId` → semantics change to **functionalRoleId** (or add `functionalRoleId`, keep `roleId` nullable). *(Recommended: add `functionalRoleId String?`, stop using `roleId` for new JDs.)*
- `JDTemplate` keyed by `functionalRoleId` (+ optional `departmentId`) instead of RBAC `roleId`. `@@unique([functionalRoleId, departmentId])`.
- New `acknowledgementText String?` to store the exact sentence captured (immutable record).
- Add audit action `ACKNOWLEDGE` to the audited actions enum.

### 1.4 Backend
- `assignFunctionalRole(userId, functionalRoleId, req)` — sets user's functional role, obsoletes prior JD, auto-creates assigned JD from template, notifies user. E-signed (assign verb).
- `acknowledgeJD(jdId, { text, signature }, req)` — validates exact text, stores ack + signature, writes ACKNOWLEDGE audit row. Only the JD's owner may call.
- `getMyJD(userId)` — current assigned JD for the logged-in user.

### 1.5 RBAC (module `jobDescription`)
| Verb | Super Admin | Supervisor | Trainer | Trainee |
|------|:--:|:--:|:--:|:--:|
| view (all) | ✓ | ✓ (their reports) | – | – |
| assign | ✓ | ✓ | – | – |
| approve (template) | ✓ | ✓ | – | – |
| acknowledge (own) | ✓ | ✓ | ✓ | ✓ (own only) |
| print / export | ✓ | ✓ | – | own |

"acknowledge" is **self-scoped** — a user can only acknowledge their *own* JD (enforced server-side by `jd.userId === req.user.id`), regardless of verb.

---

## 2. CV Module (new — full build)

### 2.1 CV form — fields **exactly** per the document
| Section | Field | Type | Source |
|---|---|---|---|
| Header | Employee Name | read-only | from User |
| | Employee Code | read-only | from User (employeeId) |
| | Functional Role | read-only | from User functional role |
| | Department | read-only | from User |
| | Language(s) Known | text (multi) | user enters — "read, write, understand" |
| Educational Qualifications *(repeatable rows)* | Year of Passing · Degree/Certification · Specialization · Institute/University | table | user enters |
| Current Role | Current Role / Designation | text | user enters (defaults to functional role) |
| | Tenure (From MM-YYYY → To MM-YYYY) | month range | user enters |
| | Key Responsibilities | textarea | user enters |
| Previous Positions *(repeatable rows)* | Organization · Role/Designation · Tenure (From→To) · Key Responsibilities | table | user enters |
| Trainings/Seminars/Workshops *(repeatable, numbered)* | Detail (month-year, topic, location…) or "Not Applicable" | table | user enters |
| Publications/Memberships *(repeatable, numbered)* | Detail or "Not Applicable" | table | user enters |

### 2.2 Screens
**A. "My CV"** (every user) — form with the sections above; repeatable rows have **+ Add row / 🗑 remove**. [Save] persists. Read-only header pulled from the user record. [Print] / [Export PDF] renders the formatted CV (controlled-document style header/footer).

**B. "Team CVs"** (Supervisor / Admin) — table of users → **View CV** (read-only) for assigned reports (supervisor) or everyone (admin). Print/Export available.

### 2.3 Data model — expand `CurriculumVitae`
Current model has `summary/qualifications/experience/skills/trainings/attachmentPath`. Reshape to match the doc:
- `languagesKnown String?`
- `qualifications Json` → `[{ year, degree, specialization, institute }]`
- `currentRole String?`, `currentTenureFrom String?`, `currentTenureTo String?`, `currentResponsibilities String?`
- `experience Json` → `[{ organisation, role, tenureFrom, tenureTo, responsibilities }]`
- `trainings Json` → `[{ srNo, detail }]`
- `publications Json` → `[{ srNo, detail }]` *(new field)*
- keep `attachmentPath` optional. `userId @unique` (one CV per user) retained.

### 2.4 Backend (new `cv.service.ts`, `cv.routes.ts`, `shared/schemas/cv.ts`)
- `getMyCV()` / `upsertMyCV(input)` — owner read/write (auto-creates on first save).
- `getUserCV(userId)` — visibility gate: requester is the owner **OR** the user's supervisor **OR** Admin/Super Admin; else 403.
- `listTeamCVs(q)` — supervisor sees their reports, admin sees all.
- Print/export endpoint returns formatted PDF.

### 2.5 RBAC (new module `cv`)
| Verb | Super Admin | Supervisor | Trainer | Trainee |
|------|:--:|:--:|:--:|:--:|
| create/edit (own) | ✓ | ✓ | ✓ | ✓ |
| view own | ✓ | ✓ | ✓ | ✓ |
| view assigned users | ✓ (all) | ✓ (reports) | – | – |
| print / export | ✓ | ✓ | own | own |

Visibility is **enforced server-side** by the owner/supervisor/admin check — not just hidden in the UI.

---

## 3. Summary of what gets built (after approval)
| # | Item | Type |
|---|---|---|
| 1 | Functional Role master (15 values), replaces Designation | schema + seed + master UI |
| 2 | JD template re-keyed to Functional Role | schema + service + UI |
| 3 | Auto-assign JD on functional-role assignment | service + supervisor UI |
| 4 | "My Job Description" + acknowledge flow (exact text + e-sign) | service + trainee UI |
| 5 | ACKNOWLEDGE audit action + notification | audit + notification |
| 6 | CV model reshape to document fields | schema |
| 7 | CV module: My CV (editable) + Team CVs (read-only) | service + routes + UI |
| 8 | CV print/export | service + UI |
| 9 | RBAC: `jobDescription` (assign/approve/acknowledge/view/print/export) + new `cv` module | seed + permissions |

## 4. Open decisions (please answer)
- D-JD1: Yes, repurpose Designation as Functional Role. Rename/reseed it with the 15 functional roles from the CV-JD document.
D-JD2: Yes, auto-assigned JD should directly become Approved because the JD template is the approved master.
D-JD3: JD acknowledgement must use typed acknowledgement sentence + secondary-password e-signature.
D-CV1: Use one live CV per user, with history maintained through audit trail.
