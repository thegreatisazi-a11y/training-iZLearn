# izLearn — Module-wise Change List (handwritten notes 2026-06-17)
**Source:** `changes hendwritup.pdf` (Pages 1–10) + your transcription · compared against current code (`main` @ 73102d8).
**Status:** ⏳ AWAITING APPROVAL — no code changed. Each item: current issue · required change · UI · backend/DB · RBAC · audit · priority · decision.
**Tags:** 🟥 new/not built · 🟧 partial/needs change · 🟩 mostly there (tweak only).

---

## A. My Trainings / Start Training / Material Reading / Assessment  *(Page 1)*

### A1 🟧 Redesigned "Start Training" material-reading screen
- **Current:** `TakeAssessmentPage` shows a per-material timed reader (tabs of materials + countdown), then the assessment. No top "course header bar", no chapter list with overall progress %.
- **Required:** Reading screen layout = top bar `[Menu] · [Course/Topic Name] · Back · Reading time (min/sec) · Cancel · Continue to Assessment`; a **left list of materials/chapters** ("1st PDF, 2nd…"), and an overall **progress (Total chapters / time · 100%)** indicator.
- **UI:** restructure the material phase into header bar + chapter list + viewer + progress.
- **Backend:** none (reading-status API already returns per-material state).
- **RBAC/Audit:** none new. **Priority:** Medium. **Decision:** confirm exact header items + whether "Menu" = app sidebar.

### A2 🟧 Show correct answer for wrong answers after submission
- **Current:** result page shows `incorrectDetails` (correct answer + explanation) **only when failed** and only if `showExplanations` is on.
- **Required:** after submission, for each **wrong** answer show the **correct answer** (per the note).
- **UI:** result page — render correct answer per incorrect question regardless of pass/fail (or per topic setting).
- **Backend:** `submitAttempt` already returns `incorrectDetails`; ensure returned on pass too if required. **Priority:** Medium. **Decision:** show correct answers on **pass** as well, or only on fail?

### A3 🟧 One-question-at-a-time after answering
- **Current:** one-question-at-a-time + navigator already implemented (CR-38).
- **Required:** confirm assessment shows Q&A one-by-one (✓ already) — keep. **Priority:** Low (verify).

### A4 🟥 Auto-save / resume material reading if closed before the test
- **Current:** `MaterialViewLog` records start/complete per material; but if the user closes mid-reading there's no explicit "resume where you left" surfaced.
- **Required:** if a material is closed before starting the test, **auto-save reading progress** and resume on return.
- **UI:** resume indicator on the chapter list. **Backend:** persist elapsed reading seconds per material (extend `MaterialViewLog` with `elapsedSeconds`). **DB:** add field (additive). **Priority:** Medium. **Decision:** resume to elapsed time, or just mark "in progress"?

### A5 🟩 Assessment must complete once started (no resume), pass/fail on result
- **Current:** single continuous attempt; closing auto-submits; pass/fail computed (CR-39/40). **Required:** keep as-is. **Priority:** Low (verify).

---

## B. My Job Description  *(Page 2, 5)*

### B1 🟧 List of assigned JDs (support multiple)
- **Current:** `MyJobDescriptionPage` shows a **single** current JD.
- **Required:** show a **list** of assigned JDs (when multiple): columns `Job Description Name · Assigned by · View · Print`; click a name → open that JD's details.
- **UI:** convert single-card → list + detail view + Print per row.
- **Backend:** `getMyJD` returns one; add `listMyJDs(userId)` returning all non-obsolete assigned JDs. **API:** new `GET /job-descriptions/mine/list`. **Priority:** High. **Decision:** show only active/assigned, or include history?

### B2 🟧 Simplify Acknowledge — remove the signature "meaning" dropdown
- **Current:** acknowledgement uses `ESignatureModal` which has a **Meaning** dropdown (Approved/Reviewed/…) and the JD flow had a Reject/Approve concept.
- **Required:** user side = **Acknowledge/Accept only**; **remove the meaning dropdown**; after the signature panel, meaning auto-selects ("Acknowledged"). Remove the multi-dropdown approve/reject selection on the user side.
- **UI:** an `ESignatureModal` variant (or prop) that hides Meaning and forces `Acknowledged`.
- **Backend:** none (already records meaning Acknowledged). **RBAC:** none. **Audit:** unchanged. **Priority:** High.

---

## C. My CV & Team CVs  *(Page 2, 3)*

### C1 🟧 My CV explicit Edit mode (save-only persistence)
- **Current:** `MyCVPage` is an always-editable form; Save persists. There's no explicit read-only→Edit toggle; closing without save already doesn't persist.
- **Required:** **read-only view by default** with an **Edit button** next to Print/PDF; Edit → fields editable → **Save** persists; closing without Save discards (already true).
- **UI:** add view/edit toggle + Edit button. **Backend:** none. **Priority:** Medium.

### C2 🟧 Team CV "View" should render the proper CV layout
- **Current:** `TeamCVsPage` shows a modal/print; the **normal on-screen view** isn't the full formatted CV layout.
- **Required:** clicking View shows the **same formatted CV layout** as My CV (read-only); Print/PDF already works.
- **UI:** reuse the CV layout component for read-only team view. **Backend:** none. **Priority:** Medium.

---

## D. Users / New User Request / User Requests  *(Page 3, 4)*

### D1 🟧 New User Request — show generated username directly in the field
- **Current:** username field shows an *auto-generate hint*; actual name is generated on the server at submit.
- **Required:** **show the generated `first.last` username directly in the field** (live, editable), not as a hint.
- **UI:** compute the preview into the input value (still server-validated for uniqueness). **Backend:** optional `GET /users/username-preview?fullName=` for collision-aware preview. **Priority:** Medium.

### D2 🟧 Reporting Manager field — drop the "(optional — for … notifications)" text; hide inactive
- **Current:** label = "Reporting Manager (optional — for training notifications)"; an admin "Include inactive" toggle exists; picker excludes inactive by default.
- **Required:** label just **"Reporting Manager"**; **remove the Include-inactive toggle**; never show inactive users in the selection.
- **UI:** label + remove toggle. **Backend:** none. **Priority:** Low.

### D3 🟧 Roles selection styled like the Functional Role(s) multi-select
- **Current:** RBAC Roles use a native multi-select `<select multiple>`; Functional Roles use the searchable chip `MultiSelect`.
- **Required:** make RBAC **Roles** use the same searchable `MultiSelect` UI. **UI** only. **Priority:** Low.

### D4 🟧 Users list — remove "Functional Role" & "Change Roles" buttons from the Actions column
- **Current:** Users row Actions = View · Lifecycle · Edit · Change Roles · Functional Role · Activate/Deactivate · Reset Password.
- **Required:** **remove Change Roles + Functional Role from Actions** (both are already inside Edit User). Keep them in Edit User only.
- **UI:** trim the Actions column. **RBAC:** unchanged (still enforced in Edit). **Priority:** Medium. **Decision:** confirm both move fully into Edit User (Edit User must include role + functional-role editing — it currently edits functional roles; confirm it also edits RBAC roles, else keep Change Roles).

### D5 🟧 User Requests — show the authorizer's name; rename "Actions" → "Authorized by"
- **Current:** request decisions store `decidedBy` (id); the list shows action buttons.
- **Required:** after approve/reject, show **the approving/rejecting user's name** in that column; rename the column to **"Authorized"/"Authorized by"**.
- **UI:** resolve `decidedBy` → name, show in column. **Backend:** list already has `decidedBy`; resolve name (like JD Approved-By). **Audit:** already captured. **Priority:** Medium.

---

## E. Roles & Access Control  *(Page 4)*

### E1 🟧 Add an Edit button on existing roles
- **Current:** roles have "Edit Permissions" (matrix) via e-sign; a general Edit (name/description) may not be obvious.
- **Required:** an **Edit** action on each created role (name/description/permissions) — controlled (reason + e-sign already required).
- **UI:** ensure an Edit button per role row. **Backend:** `updateRole` exists. **Priority:** Low.

### E2 🟧 Default to Active roles; inactive hidden unless filter = All
- **Current:** roles list has an Active/Inactive/All filter, default Active.
- **Required:** confirm **default shows only Active**; inactive appear only when filter = All/Inactive. (Largely done — verify.) **Priority:** Low (verify).

---

## F. Master Setup  *(Page 5)*

### F1 🟧 Replace "☐ Include inactive" with a clean filter + inline "Add" button (all tabs)
- **Current:** each tab has an "Include inactive" checkbox + Add button.
- **Required:** standardize to a **status filter** (Active default / All) and an **Add button** inline on the header of **every** tab.
- **UI:** unify the toolbar across Locations/Functional Roles/Training Types/Document Types. **Priority:** Medium.

### F2 🟧 Hide "code" from the front-end views; show Display Name
- **Current:** Functional Roles, Training Types, Document Types show a `code` column/field.
- **Required:** **hide `code`** in the UI (keep it internal/auto-generated); show **Display Name** only. For Training Types, list by display name, drop the code field; **remove built-in front-end demo entries** where present.
- **UI:** drop code columns/inputs; auto-generate code on save. **Backend:** code stays unique internally (auto-derive). **Priority:** Medium. **Decision:** confirm code becomes fully auto/hidden everywhere (it's referenced by `trainingType` enum mapping — keep mapping intact).

### F3 🟧 Deactivated master values must not appear in new-transaction dropdowns
- **Current:** most dropdowns query active-only; needs a sweep to confirm all do.
- **Required:** verify Locations/Departments/Functional Roles/Training Types/Document Types dropdowns in all forms exclude inactive. **Priority:** High (compliance).

---

## G. Courses / Training Topics / Version / Archive / Publish  *(Pages 5, 6, 7)*

### G1 🟧 New Training Topic — REMOVE (not just hide) Duration, Department, Refresher Interval, Min reading time, Next Review, Sequence
- **Current:** these were moved into an **"Advanced (optional)"** section on the create form (still present).
- **Required:** the note now says **remove them from create** entirely.
- **UI:** drop those fields from the create form. **Backend/DB:** keep columns nullable (data history); schema fields stay. **Priority:** High. **Decision (important):** `durationMinutes` is currently **required** by the schema, and `materialViewSeconds` powers the **compliance reading-gate**, `sequenceIndex` powers **sequence enforcement**. If removed from the form: (a) make `durationMinutes` optional in schema, (b) where do reading-time/sequence get set — Edit form only, or dropped entirely? **Need your call per field.**

### G2 🟥 "Revise" should only Archive — not full-course revise; change wording
- **Current:** "Revise (New version)" creates a brand-new topic version (full clone) and archives the old.
- **Required:** clicking **Revise should just Archive** the topic (full archive); the **new-version flow should be "Save as Draft"** when *materials/files* change — not a full course re-clone. Material/file version changes shouldn't re-version the whole course.
- **UI:** rename/replace Revise → Archive; move "new version" to a draft-on-material-change model.
- **Backend:** significant change to `reviseTopic` semantics + material versioning. **Priority:** High. **Decision needed:** this **reverses** the current revision model — confirm: Revise button = Archive only; version bump happens automatically when a material is replaced (not by a manual full revise)? This is a big behavioral change — please confirm precisely.

### G3 🟧 Material replace → keep both, active = latest, old → version history
- **Current:** replace stages a new file; on revise the old is archived to version history.
- **Required:** on **Replace**, show **both** files at the same location — **active = latest**, old version flagged and moved to **version history** immediately (without a full course revise).
- **UI:** materials list shows current + a "version history" of replaced files. **Backend:** material replace creates a new version row, supersedes old → history. **Priority:** High (ties to G2).

### G4 🟧 Editing a PUBLISHED topic → changes go to a DRAFT (auto-unpublish to a working copy); confirm-on-publish
- **Current:** publish/unpublish is an e-signed status change; editing a published topic edits it in place.
- **Required:** any change to a **published** topic (new material / question change) should go into a **draft working copy** (published stays live unchanged) until **Publish** is clicked → **ask to confirm** publish. New updates don't change the live published version until republished.
- **UI:** "draft changes pending" state + confirm-publish dialog. **Backend:** draft/working-copy model for published topics. **Priority:** High. **Decision:** introduce a draft-copy-of-published model (sizeable) — confirm scope.

### G5 🟧 Allow deleting a course/material **before** publish (controlled); not after
- **Required:** before a course is published, allow delete (permission-gated); after publish, no delete (only archive). **Backend:** guard delete by status. **RBAC:** delete permission. **Priority:** Medium.

---

## H. Material Library  *(Page 7)*

### H1 🟥 Linked/published materials cannot be deleted by anyone
- **Current:** materials soft-delete; no guard preventing deletion of a material attached to a published course.
- **Required:** if a material is **linked to a published course**, **block delete** (for everyone). If a course/material is unlinked/revised, that file also can't be changed.
- **Backend:** delete/edit guard checking links to published topics. **RBAC/Audit:** deny logged. **Priority:** High (compliance).

---

## I. Job Descriptions / Templates / Assign JD  *(Pages 2, 8, 10)*

### I1 🟧 Deactivate JD → require signature
- **Current:** JD deactivate (if present) isn't e-signed.
- **Required:** deactivating a JD asks for **e-signature**. **Backend:** add e-sign to JD deactivate. **Audit:** capture. **Priority:** Medium.

### I2 🟧 Add Edit button after a JD is created/assigned/attached
- **Required:** an **Edit** action on created/assigned JDs (controlled). **UI/Backend.** **Priority:** Medium.

### I3 🟧 Inactive JDs auto-hide; show via filter; default Active
- **Required:** JD list hides inactive by default; Active/Inactive filter; default Active first. **UI.** **Priority:** Medium.

### I4 🟧 Assign JD — title-driven template auto-fill, searchable, editable-without-affecting-template
- **Current:** JD assignment is keyed by Functional Role (auto-creates from template).
- **Required:** when creating/assigning a JD, a **searchable Title dropdown** of templates; selecting a Title **auto-fills Department / Role / Content** from that template; fields **editable** but edits **do not change the template** (they apply to this assignment only).
- **UI:** searchable template-title select + auto-fill + editable copy. **Backend:** assign-from-template-by-title (copy content into the JD instance). **Priority:** High. **Decision:** assign by **Title** (not just Functional Role) — confirm this becomes the assign mechanism.

### I5 🟧 "Assign JD" = direct assign + direct approval (no separate review step)
- **Current:** `assignFunctionalRole` already auto-creates an APPROVED JD.
- **Required:** clicking **Assign JD** assigns **directly to the user** (approved on create, no extra review/approve step). Always show Active first. **Largely matches current** — confirm wording + flow. **Priority:** Medium.

### I6 🟥 JD Template editor = rich "Word-like" designer + import Word/Excel
- **Current:** template `content` is sanitized HTML via a basic editor; opens in a dialog.
- **Required:** a **rich-text/Word-like designer** (headings H1/H2, tables, boxes, text styling) to design JD layout; the create/update template screen should open **full-page (menu still visible)**; support **importing Word/Excel** → content shown per format → editable after import.
- **UI:** integrate a rich-text editor (e.g. TipTap) + docx/xlsx import; full-page route (not modal).
- **Backend:** import parsing (docx→HTML, xlsx→table). **Priority:** High (largest UI item). **Decision:** which editor library is acceptable (adds a dependency)? Import = Word + Excel both?

---

## J. TNI / Requirement Matrix / New TNI  *(Page 9)*

### J1 🟧 Requirement matrix = permission-style per-topic layout
- **Current:** TNI matrix is a grid (topics × functional roles) with Required checkboxes + an Apply button.
- **Required:** make it look like the **permission matrix layout** — click a **Topic** → expand to show **Required toggle per Functional Role**; after **Update**, show the **Assign** button; nothing is assigned until the button is clicked.
- **UI:** restructure matrix to expandable per-topic cards (like the Roles permission cards). **Backend:** same `setRequirement`/`applyMatrix`. **Priority:** Medium.

### J2 🟧 New TNI — multi-select Topics; show user+topic on the request/detail page; show topics on Assign
- **Current:** `createTNI` is single user + single topic.
- **Required:** New TNI allows **multiple Topic selection**; after creating, the **Requirements/Requests page** shows the user & selected topics (currently not showing); when clicking **Assign user**, show the assigned topic details (multi).
- **UI:** multi-topic select + detail rendering. **Backend:** `createTNI` accept `topicIds[]`; detail returns topics. **DB:** TNI per (user, topic) rows or topicIds array. **Priority:** High. **Decision:** store multi-topic TNI as multiple rows (one per topic) or one TNI with topic array?

---

## Decisions I need from you (blocking the heavy items)
1. **G2/G3 — Revision model reversal:** confirm "Revise = Archive only" and version bump happens **automatically on material replace** (not a manual full-course revise). This reverses current behavior — biggest backend change.
2. **G4 — Draft-copy-of-published:** confirm you want edits to a published topic to go to a hidden draft working copy until re-publish (sizeable model change).
3. **G1 — field removal:** per field (Duration / Department / Refresher / Min-reading-time / Next-Review / Sequence) — remove from create only, or also from edit, and is `durationMinutes` now optional? (It's schema-required today; reading-time + sequence power compliance features.)
4. **I4/I6 — JD:** assign **by template Title** (auto-fill, editable copy)? And approve a **rich-text editor library + Word/Excel import** (new dependency)?
5. **J2 — multi-topic TNI:** store as multiple rows or one TNI with a topic array?
6. **A2 — show correct answers on pass too**, or only on fail?
7. **A4 — resume reading:** restore elapsed time, or just "in progress" marker?

## Priority summary
- **Critical/High:** B1, B2, F3, G1, G2, G3, G4, H1, I4, I6, J2.
- **Medium:** A1, A2, A4, C1, C2, D1, D4, D5, F1, F2, G5, I1, I2, I3, I5, J1.
- **Low:** A3, A5, D2, D3, E1, E2.

**Nothing implemented. Awaiting your approval + the 7 decisions above; then I implement safely (additive migrations, no data reset, no hard delete).**
