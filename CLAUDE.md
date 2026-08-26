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

## Other conventions

- **Comments count.** Commented-out code is kept deliberately in this repo (features
  parked, not deleted). Keep it consistent with live code when renaming.
- **Audit trail is untouchable.** Nothing ever updates or deletes an `AuditTrail` or
  `ElectronicSignature` row; immutability is enforced at the application layer.
- **Line endings are CRLF** (`core.autocrlf=true`, no `.gitattributes`). Scripts that
  rewrite files must preserve CRLF or they produce whole-file churn.
