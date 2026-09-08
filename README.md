# RTE Hub — Islington College

**One operational hub for the Routine, Timetable & Examination (RTE) Department.**
Built for Islington Hackathon 2026 and addressing *both* RTE challenge briefs:

| Brief | What RTE Hub delivers |
|---|---|
| **Intelligent Academic Planning** (scheduling & resource allocation) | Constraint-based timetable generator, live clash detection (room / lecturer / group / capacity / room-type / overload), manual override with audit, exam venue allocation, interleaved seating generator, workload-balanced invigilator allocation, room utilisation analytics & availability finder, faculty workload view, student/staff lookups |
| **Smarter Systems, Stronger Records** (integrated management system) | Centralised student academic profile, result sheets with inline marks entry + CSV import, validation & statistical anomaly detection, 4-step approval workflow (Draft → Submitted → Approved → Published) with automatic outcomes / resits / progression / standing, role-based access, leadership dashboard, natural-language academic search, full audit trail |

> **AI disclosure:** this repository was built with the assistance of Claude (Anthropic) via Claude Code. All scheduling, seating, grading and anomaly logic is deterministic TypeScript in `src/lib/engine/` and is fully explainable. The in-app AI assistant (`src/lib/agent/`) uses an LLM via the Experiential Labs gateway only to plan tool calls and phrase answers; every fact and every action comes from the same audited application services the UI uses.

---

## Quick start

```bash
npm install            # also runs `prisma generate`
npm run db:push        # creates prisma/dev.db (SQLite)
npm run db:seed        # deterministic demo dataset (500 students, 16 groups, 17 rooms, 22 lecturers…)
npm run demo           # production build + server → http://localhost:3000  (use this for demos)
npm run dev            # hot-reload dev server (slower: every route is compiled on first visit)
```

> **Performance note.** Use `npm run demo` (production mode) when presenting. Measured server render times in production are 20–140 ms per page; the dev server adds 0.5–3 s per page for on-demand compilation and React dev checks. The database layer itself is fast (dashboard queries ≈ 60 ms, timetable solver ≈ 0.4 s for 192 sessions).

Demo accounts (password `Password123`):

| Role | Email | Can do |
|---|---|---|
| Administrator | `admin@islington.edu.np` | everything, incl. publishing results |
| RTE Officer | `rte@islington.edu.np` | timetables, exams, rooms, approvals |
| Lecturer | `lecturer@islington.edu.np` | marks entry for own modules, own workload & duties |
| Student | `student@islington.edu.np` | personal timetable, exam seats, published results |

Environment (`.env`, see `.env.example`):

```
DATABASE_URL="file:./dev.db"
SESSION_SECRET="…"
AI_API_KEY="xpl_…"                                  # Experiential Labs key
AI_BASE_URL="https://api.experientiallabs.ai/v1"    # OpenAI-compatible gateway; clear it to run the rule engine only
AI_MODEL="claude-haiku-4.5"                         # chat/lookup turns (fast)
AI_MODEL_ACTIONS="claude-sonnet-4.5"                # turns that change data (better tool discipline); optional
```

---

## Demo script (5 minutes)

1. **Dashboard** — result-processing pipeline, clash count, exam readiness, room utilisation, overloaded staff, at-risk students.
2. **Timetable → “Legacy spreadsheet import”** — the conflict monitor lists 9 hard conflicts (double-booked room, lecturer clash, group overlap, capacity overflow) exactly as they happen today in spreadsheets. Click **Auto-resolve**, or open a session and watch the **live conflict check** with free-room / free-slot suggestions.
3. **Timetable → Generate clash-free option** — the solver places all 192 weekly teaching hours for 16 groups in under half a second with zero conflicts and reports quality, room fill and any unplaceable demand with the reason. Publish it (blocked while hard conflicts remain).
4. **Results → CS4005 (L5COG1)** — anomaly detection flags a 52 % fail rate and personal outliers before approval; CS4006 (L5COG1) shows validation errors (out-of-range, missing marks) that block submission. Approve → Publish and the system sets outcomes, creates resits, computes progression and updates academic standing automatically.
5. **Examinations → CS4004 resit (20 Sept)** — two papers share one room; the seating map shows papers interleaved so no neighbour has the same paper. Open a December exam: **Auto-allocate venues → Generate seating → Auto-assign invigilators** → **Print seating plan**.
6. **Assistant** (floating button bottom-right, or Ctrl+K) — “Prepare the CS5002 exam”, “Generate a clash-free timetable and publish it”, “Which sheets are waiting for approval? Approve CS5005 for L6COG1”, “Where is 20250252 sitting?”. Watch the tool badges and the page refresh as it acts.
7. **Sign in as the student** — personal timetable, seat allocation, published results only.

---

## Architecture

```
Next.js 15 (App Router, React 19, TypeScript, Tailwind v4)
├── src/app/(app)/…            server components per module + server actions (mutations)
├── src/app/api/…              JSON endpoints: live clash check, assistant, CSV template, health
├── src/lib/engine/            pure, unit-testable algorithms (no I/O)
│   ├── clash.ts               conflict detection (6 rule types) + candidate check
│   ├── scheduler.ts           constraint-based timetable generator
│   ├── seating.ts             exam seating + venue suggestion
│   ├── invigilation.ts        invigilator allocation
│   ├── grading.ts             grade calc, validation, anomaly detection, progression, risk score
│   └── nlq.ts                 natural-language intent router + query handlers (offline fallback)
├── src/lib/services/          business operations (timetable, exams, results, faculty) shared by UI actions and the agent
├── src/lib/agent/             AI assistant: tool definitions/executor (role-gated) + LLM loop with function calling
├── src/lib/data/              Prisma → engine adapters & analytics queries
├── src/lib/auth.ts, session   scrypt passwords, HMAC-signed cookie sessions, RBAC matrix
├── src/middleware.ts          route protection (Edge, Web Crypto)
└── prisma/schema.prisma       24 models, SQLite (swap datasource for PostgreSQL in production)
```

### Data model (core relationships)

Programme → Intake → Cohort → Student → ModuleEnrollment → Mark ← ResultSheet (module × cohort × term)
Module → Assessment (weights) · TeachingAssignment (module × cohort × lecturer × type × hours) → TimetableSession (room × slot) ∈ Timetable (versioned, DRAFT/PUBLISHED)
ExamSession → ExamCohort, ExamVenue, SeatAllocation (student × room × seat), Invigilation · User (role, → Lecturer / Student) · AuditLog · Resit · ProgressionRecord

### Algorithms

**Timetable generator** (`scheduler.ts`) — constructive heuristic + repair + local search:
1. Expand teaching demand into 1-hour units; order most-constrained-first (labs, large groups, busiest lecturers/groups).
2. For each unit evaluate every (slot, room) cell against **hard constraints** — room free, lecturer free, group free, capacity ≥ group size, lab sessions only in labs, lecturer daily/weekly caps, group daily cap — and choose the lowest **soft cost**: wasted capacity, same module twice in a day, gaps in the group's day, late/early slots, lecturer daily load.
3. Repair pass: for unplaced units, temporarily evict a session sharing the lecturer/group and re-place both.
4. Improvement passes: hill-climb each session to a cheaper feasible cell.
Deterministic per seed; ~190 units × 17 rooms × 60 slots (≈200k cell evaluations) solve in about 0.4 s. Locked sessions are respected on regeneration.

**Clash detection** (`clash.ts`) — groups sessions by slot and checks room/lecturer/group multiplicity, capacity, room type, and weekly overload. Used identically by the dashboard, timetable view, the live form check API and the solver, so there is one definition of "conflict".

**Seating** (`seating.ts`) — all papers in a sitting are merged into a weighted round-robin stream (papers interleaved, then cohorts interleaved within a paper), poured into venues largest-first in row-major order. Produces seat numbers and labels (A1…), per-venue paper counts, unseated students and an *adjacency-conflict* quality metric. `suggestVenues` picks the single best-fit free venue, else the smallest largest-first set.

**Invigilation** (`invigilation.ts`) — requirement = 1 chief + 1 assistant per 25 students beyond the first 25; candidates exclude the module's own lecturers and anyone already on duty in the sitting; least-loaded staff first.

**Grading & anomalies** (`grading.ts`) — weighted overall mark, pass = overall ≥ 40 and every component ≥ 30 %; validation (missing, out-of-range, duplicates, component-fail); anomaly checks (cohort mean vs module history, fail-rate, low spread, identical-mark clusters, per-student z-outliers, component divergence); progression rules (PROGRESS / PROGRESS_WITH_RESIT ≤ 40 failed credits / REPEAT / REVIEW); at-risk score 0–100.

**AI operations assistant** (`src/lib/agent/`, floating widget on every page + `/assistant`) — an LLM agent (Experiential Labs gateway, OpenAI-compatible function calling; default model `claude-haiku-4.5` (switch to `claude-sonnet-4.5` for richer answers)) with 17 read tools and 33 action tools. Read tools query live data (students, records, seats, timetables, free rooms, workloads, results, conflicts, exams, at-risk, utilisation, reference lists). Action tools call the same audited services as the UI: generate/publish/delete timetables, auto-resolve, add/move/delete sessions, reassign or create teaching allocations, allocate venues, generate seating, assign invigilators, prepare an exam end-to-end, create/delete exams, submit/approve/publish/reject result sheets, create result sheets and enter marks, and manage records — create/update/delete students, enrol them, add lecturers, rooms, modules and groups, create logins and reset passwords. Every tool is gated by the caller's role; students can only read their own data. The model plans and explains; facts always come from tool results. If the gateway is unreachable, a deterministic rule engine (`nlq.ts`, 10 intents) answers instead.

### Security & governance
- Roles: ADMIN, RTE_STAFF, LECTURER, STUDENT; permission matrix in `auth.ts` (`can()`); students only ever see their own record and published results.
- Passwords hashed with scrypt; sessions are HMAC-SHA256 signed, httpOnly cookies; middleware enforces authentication on every route.
- Every mutation (marks saved/imported, workflow transitions, sessions moved, venues/seating/invigilators, reassignments, room edits, assistant queries) is written to `AuditLog`.

### Scripts
`npm run db:reset` — wipe & reseed · `npx tsx scripts/nlq-test.ts` — exercise the rule engine offline · `npx tsx scripts/agent-test.ts` / `agent-admin-test.ts` — drive the AI agent against the gateway · `npx tsx scripts/e2e-actions.ts` — headless Edge (Playwright) check that in-place actions work on the production build · `npx tsx scripts/timing.ts` — per-route render timings.

---

## Project structure highlights
- `DESIGN.md` — design tokens the UI follows (near-black canvas, single Rosso Corsa accent, sharp corners, Inter).
- `prisma/seed.ts` — reproducible dataset that runs the real engines (timetable, seating, invigilation) so the demo state is produced by the same code the app uses.

## Limitations / next steps
- SQLite for the hackathon; production would use PostgreSQL and background jobs for large solver runs.
- Timetable is weekly-pattern based (no week-by-week exceptions yet).
- Email/SMS notifications, PRISMS-style external integrations and SSO are simulated as audit entries only.
