# Phase 7 Plan: Release Comparison and Regression Memory

**Status:** Ready to start (Phase 6 complete, 2026-11-28; planner fix F1 done, 14 approved AI-planned tests).
**Rules:** `AGENTS.md` → *Scope discipline* and `docs/REVIEW_RULES.md` apply to every task. One task at a time, one correction round at most. Every task prompt starts by having the agent read and understand the repository before changing anything. Design decisions are recorded as **DEC-043**.

## 1. Goal and exit criteria

**Goal:** When a new release of an application arrives, keep the approved tests that are still valid, flag the ones affected by changed or retired requirements for a person to review, add tests for new behaviour, run the active suite against the new release, and report which tests newly fail compared with the previous release. Every decision leaves a record.

**Exit criteria** (from `IMPLEMENTATION_PLAN.md` §11):
1. A V2 run of the Release Demo keeps valid V1 coverage: approved tests whose requirements didn't change stay active without re-approval.
2. Approved tests exist for the new behaviour in V2 (a new requirement and a changed requirement), produced by the existing pipeline.
3. Changed and retired requirements, and the approved tests linked to them, are flagged. A named reviewer confirms each one with a reason; tests are kept or retired, never silently deleted.
4. The V2 release report compares the V2 run with the V1 baseline, and it flags the planted regression in V2 (§3.8) as a regression. After the fix, the report is clean and CI runs the active suite against V2.

**Not in Phase 7:** AI suggestions for semantic requirement changes (deferred, §3.2), SQLite or any database (DEC-039), release-triggered pipelines and the UI (Phase 8), un-retiring tests, comparing more than two releases at once, and SauceDemo releases (it's an external site whose versions we don't control).

## 2. How each original Phase 7 item is covered

| `IMPLEMENTATION_PLAN.md` §11 item | Task |
|---|---|
| 1. Release records and stable project, test and requirement IDs | R1 (release records). Stable IDs exist already: author-assigned requirement IDs (Phase 2) and never-reused scenario IDs (Phase 5). |
| 2. Store document versions, hashes, release metadata and source references | R1 (the release record stores them). Document snapshots by hash exist since Phase 2. |
| 3. Deterministic requirement comparison by author-assigned ID and structured fields | R1 |
| 4. AI suggests semantic changes only where deterministic comparison is insufficient | Deferred (§3.2): with author-assigned IDs and structured documents, the deterministic comparison is enough |
| 5. Preserve comparison evidence; a reviewer can correct classifications | R1 (evidence in the release record), R2 (the reviewer confirms each change and decides what it means for each test) |
| 6. Map approved tests to requirements; keep test and requirement history | Done in Phase 6 (plan files). R2 adds `retired` with its history. |
| 7. Select the active approved suite for a release | R2 (the active suite is `tests/approved/`; retired tests move out) |
| 8. Run the active suite against the new release | R3 (`run --release`) |
| 9. Compare current and prior results; highlight newly failing tests | R3 (`release report`) |
| 10. Record approvals and reasons for changed or retired requirements and tests | R2 |
| 11. Demonstrate V1 and V2 workflow documents | R4 (demo app V2 and its requirements) and the live walkthrough (§5) |

## 3. Design decisions (fixed for this phase, recorded as DEC-043)

1. **Releases are committed JSON files.** Each release is `<workspace>/releases/<release-id>.json`, with no database (DEC-039). A release ID has 1–32 characters: lowercase letters, digits, `.` and `-`, starting with a letter or digit (for example `v1`, `2026.12`). It is created once and never overwritten. A new release's previous release is the most recently created existing one. The record stores the target (base URL, environment), each document's current version hash, and a snapshot of every requirement: ID, status, unresolved flag, content version and source document hash.
2. **The comparison is deterministic. There is no AI in Phase 7.** Each requirement is compared by its author-assigned ID with the previous release's snapshot and classified as:
   - `new`: not in the previous release;
   - `changed`: the content version went up;
   - `unchanged`;
   - `retired`: active before, retired now;
   - `unresolved`: became unresolved;
   - `missing`: still active, but absent from the current version of its source document (import reports such IDs but doesn't retire them).
   Because IDs are assigned by the author, this is enough for structured documents. AI suggestions for semantic changes (§11 item 4) are deferred until unstructured documents need them.
3. **Affected tests are flagged; unaffected tests stay.** An approved scenario (from the plan files) linked to a `changed`, `retired`, `missing` or `unresolved` requirement is listed in the release record as pending review. All other approved tests stay active with no action. Each `new` requirement without an approved test is listed as "needs tests"; those tests come from the existing pipeline (explore, plan, generate, validate, approve).
4. **Review is human and recorded.** `release review` records reviewer, date and reason in the release record.
   - Each flagged requirement change is **confirmed**.
   - Each flagged test is either **kept** (still valid, for example after an editorial change; this is how a reviewer corrects a classification's consequences) or **retired**.
   - Retiring moves the approved file to `tests/retired/`, never deleting it, so Git keeps its history. The scenario's status in its plan file becomes `retired`.
   - `approve` (adds) and `release review` (retires) are the only platform code that changes `tests/approved/`.
5. **The active suite is `tests/approved/`:** everything approved and not retired. `run` is unchanged apart from an optional `--release <id>`, which tags the run. After a tagged run, a short summary is appended to the release record: run ID, time, run status and, per test, its file, scenario ID and status. The Playwright artifacts themselves stay git-ignored.
6. **The release report compares the latest run of a release with the latest run of its previous release (the baseline).** For each test:
   - `still passing`;
   - `newly failing`, which is a **regression** when all its linked requirements are `unchanged`, and **affected by a requirement change** otherwise;
   - `still failing`;
   - `fixed`;
   - `new`;
   - `retired`.
   It also lists the requirement changes, pending reviews and "needs tests". A run that is not clean (timed out, infrastructure error, incomplete report) is reported as such and never counts as passing. The report is written to `releases/<release-id>-report.md` and committed. Its exit code is 0 only when there is no regression, no pending review, and the latest run passed.
7. **One base URL per project.** You start the version you are testing (`npm run demo:v1` or `npm run demo:v2`), and the release ID says which release a run belongs to. The release record keeps the base URL and environment it was created with.
8. **Demo app V2 has one planted regression,** documented in its README: an unchanged requirement's message is broken on purpose. It shows that the report catches a real regression, and it's fixed in R5.
9. **CI follows the current release.** After Phase 7, the Release Demo CI job runs the active suite against V2. CI stays AI-free and runs approved tests only.

## 4. Tasks

| # | Task | What you get | Size budget (source lines) |
|---|---|---|---|
| R1 | Release records and requirement comparison | `release create --release <id>` snapshots the requirements and compares them with the previous release, listing changed requirements, affected tests and "needs tests" | ~300 |
| R2 | Release review and retiring tests | `release review` confirms requirement changes and keeps or retires affected tests, with reasons; retired tests move to `tests/retired/` | ~200 |
| R3 | Release runs and the release report | `run --release <id>` records results in the release; `release report` compares them with the baseline and flags regressions | ~300 |
| R4 | Demo app V2 and its requirements | `npm run demo:v2` (with one planted regression) and the V2 requirements document | ~150 plus HTML and the document |
| R5 | Fix the planted regression; CI on V2 | The V2 bug fixed, and CI runs the Release Demo's active suite against V2 | ~20 |

Order: R1 → R2 → R3. You create release `v1` after R1 and run the V1 baseline after R3. R4 brings V2, then the live walkthrough (§5), then R5.

---

## R1 — Release records and requirement comparison

**Acceptance criteria**
1. **Release record (§3.1):** a Zod schema for `<workspace>/releases/<release-id>.json` with: `schemaVersion`, `releaseId`, `projectId`, `createdAt`, `previousReleaseId` (or null), `target { baseUrl, environment }`, `documents [{ documentId, contentHash }]`, `requirements [{ requirementId, status, unresolved, contentVersion, sourceContentHash }]`, `comparison` (criterion 3), `affectedTests` (criterion 4), `needsTests`, `reviews: []` and `runs: []`. It is written atomically with the existing helper. The release ID is validated, and an existing release is never overwritten.
2. **`node dist/cli/index.js release create --config <…> --release <id>`** builds the snapshot from the existing document and requirement registries (no second loader). The content version is computed the same way as the planner (`history.length + 1`). The previous release is the most recently created existing release.
3. **Comparison (§3.2):** each requirement is classified `new`, `changed` (with the previous and current content version), `unchanged`, `retired`, `unresolved` or `missing`. The first release of a project has no previous release, so everything is `new`.
4. **Affected tests (§3.3):** approved scenarios (status `approved` in the plan files) linked to a `changed`, `retired`, `missing` or `unresolved` requirement are listed with their scenario ID, approved file, linked requirements and their classifications, with `review: "pending"`. Flagged requirements (`changed`, `retired`, `missing`, `unresolved`) are listed as pending confirmation. `needsTests` lists each `new` or `changed` requirement that has no approved test for its current content version.
5. **Output:** one line per non-unchanged requirement, the number of unchanged ones, each affected test, and "needs tests". It exits 0 when the record is written.
6. **Tests (temp workspaces):** the first release; one fixture per classification; affected-test detection through plan files; release-ID validation; refusal to overwrite; the previous release chosen by creation time.

**Out of scope:** reviews (R2), runs and reports (R3), changing `requirements import`, AI calls.

**User step after R1:** create the V1 release of the Release Demo:
`node dist/cli/index.js release create --config project-data/release-demo/project.config.json --release v1`
Everything is `new` (first release), and "needs tests" should be empty, because every V1 requirement already has an approved test. Commit `releases/v1.json`.

**Prompt**
```text
First, read and understand the repository before changing anything: AGENTS.md (Scope discipline), docs/PHASE_7_PLAN.md
(§3 and Task R1), docs/DECISIONS.md DEC-041 to DEC-043, and the code this task builds on: src/requirements/registry.ts
(importRequirements, hasContentChanged, history), src/documents/service.ts (document registry, getCurrentVersion),
src/planning/scenario.ts (plan files and statuses), src/cli/approve-command.ts (how plan files are found), src/documents/atomic-fs.ts
and src/cli/args.ts/index.ts. Briefly list what you will reuse before you start.

Task R1 (docs/PHASE_7_PLAN.md). Implement exactly acceptance criteria 1–6 of R1, following design decisions §3.1–§3.3.
Follow AGENTS.md "Scope discipline". Reuse the existing registries, loaders, plan-file lookup and atomic write helper; create no
second loader or parser. No AI calls. Size budget ~300 source lines. Verify: typecheck, build, npm run test:unit. Report the
criterion table, raw Vitest lines and git status --short.
```

---

## R2 — Release review and retiring tests

**Acceptance criteria**
1. `node dist/cli/index.js release review --config <…> --release <id> --reviewer "<name>" --reason "<text>"` with exactly one of:
   - `--requirement <ID>[,…] --confirm`: confirms flagged requirement changes;
   - `--scenario <SCN>[,…] --keep`: the test stays active;
   - `--scenario <SCN>[,…] --retire`: the test is retired.
   Only items pending in that release can be decided. Each decision is appended to the release record's `reviews` with reviewer, date, reason and action, and the item becomes reviewed.
2. **Retire (§3.4):** moves `tests/approved/<SCN>.spec.ts` to `<workspace>/tests/retired/<SCN>.spec.ts` (the file content is unchanged, and an existing file there is never overwritten). It sets the scenario's plan status to `retired`, with `retirement { reviewer, decidedAt, reason, releaseId }`. The scenario status enum gains `retired`. `retired` is final for `validate`, `approve`, `reject` and `release review`.
3. `tests/retired/` is outside the Playwright test folder, so retired tests never run. `run` and the type check still work. `approve` and `release review` remain the only code that changes `tests/approved/`.
4. If writing the release record or the plan file fails, a moved file is moved back, so no file move exists without its record (as in V3).
5. **Tests:** confirm, keep, retire (file moved, content identical, plan updated); refusal for an item that is not pending, an unknown ID, a missing reason or reviewer, and a retired scenario; rollback when a write fails.

**Out of scope:** runs and reports (R3), un-retiring, editing requirement text.

**Prompt**
```text
First, read and understand the repository before changing anything: AGENTS.md (Scope discipline), docs/PHASE_7_PLAN.md
(§3 and Task R2), DEC-042 and DEC-043, the R1 code (release record schema and release create), src/cli/approve-command.ts
(decision recording, plan writes, rollback), src/planning/scenario.ts and the project config's resolved test directory.
Briefly list what you will reuse before you start.

Task R2 (docs/PHASE_7_PLAN.md). Implement exactly acceptance criteria 1–5 of R2, following design decision §3.4.
Follow AGENTS.md "Scope discipline". Reuse the R1 release record helpers and the approve-command plan lookup and writes. Never
delete a test file. No AI calls. Size budget ~200 source lines. Verify: typecheck, build, npm run test:unit. Report the
criterion table, raw Vitest lines and git status --short.
```

---

## R3 — Release runs and the release report

**Acceptance criteria**
1. **`run --config <…> --release <id>`** (§3.5): the release must exist. The run is otherwise unchanged. Afterwards, a summary is appended atomically to the release record's `runs`: `{ runId, finishedAt, runStatus, reportStatus, tests: [{ file, title, scenarioId (from an SCN-… file name, else null), status }] }`, taken from the existing `reconcileRunResult()` and parsed report. A `run` without `--release` behaves exactly as today.
2. **`node dist/cli/index.js release report --config <…> --release <id>`** (§3.6) compares the release's latest run with the previous release's latest run, matching tests by file. It classifies each test as `still passing`, `newly failing` (`regression` when all its linked requirements are `unchanged` in this release, otherwise `affected by requirement change`), `still failing`, `fixed`, `new` or `retired` (in the baseline, now in `tests/retired/`). Tests without a scenario (for example smoke tests) count as linked to no requirement, so they are regressions when newly failing.
3. The report also states: the requirement comparison, pending reviews, "needs tests", and whether each latest run was clean. A run that is not clean is reported as `blocked`, never as passing. If there is no baseline run, or the release has no run yet, the report says so.
4. It writes `releases/<id>-report.md` (readable headings and tables, no ANSI codes) and prints a short summary. It exits 0 only when there is no regression, no pending review, and the latest run passed; otherwise 1.
5. **Tests (fake run summaries):** each test classification; regression vs. affected by requirement change; a blocked latest run; no baseline; a pending review causing exit 1; `run --release` appending a summary; `run` without `--release` unchanged.

**Out of scope:** comparing more than two releases, trend history, charts, the UI (Phase 8), AI analysis of failures.

**User step after R3:** run the V1 baseline with the demo app on V1 (`npm run demo:v1` in another window):
`node dist/cli/index.js run --config project-data/release-demo/project.config.json --release v1`
then `release report … --release v1`. With no previous release, it should say "no baseline" and exit 0. Commit `releases/`.

**Prompt**
```text
First, read and understand the repository before changing anything: AGENTS.md (Scope discipline), docs/PHASE_7_PLAN.md
(§3 and Task R3), DEC-043, the R1/R2 release code, src/cli/run-command.ts, src/test-execution/runner.ts (RunMetadata),
src/reporting/status-model.ts and report-parser.ts (reconcileRunResult, parsed tests), and how plan files link scenarios to
requirements. Briefly list what you will reuse before you start.

Task R3 (docs/PHASE_7_PLAN.md). Implement exactly acceptance criteria 1–5 of R3, following design decisions §3.5–§3.6.
Follow AGENTS.md "Scope discipline". Reuse reconcileRunResult and the parsed report; do not parse Playwright JSON again.
run without --release must behave exactly as today. No AI calls. Size budget ~300 source lines. Verify: typecheck, build,
npm run test:unit. Report the criterion table, raw Vitest lines and git status --short.
```

---

## R4 — Demo app V2 and its requirements

**Acceptance criteria**
1. `demo-apps/release-demo/v2/` and `npm run demo:v2`, served by the existing server script on the same port. Per-version behaviour is kept in one small settings object. V1 stays byte-for-byte the same.
2. V2 matches the V2 requirements below exactly:
   - the predefined task list is gone (DEMO-003 retired), so the list starts empty;
   - the empty-title message is now `Please enter a task title.` (DEMO-004 changed);
   - a `Sign out` button on `/tasks.html` ends the session and goes to `/` (DEMO-005 new).
3. **The planted regression (§3.8):** in V2, the empty-password message is `Password is required` (the final period is missing), although DEMO-002 is unchanged. It is described in `demo-apps/release-demo/README.md` as a deliberate regression for the Phase 7 demonstration, fixed in R5.
4. The V2 requirements document below is saved **verbatim** as `project-data/release-demo/docs/requirements-v2.md`. Do not import it, and do not change `requirements.md`; the user replaces it during the walkthrough.
5. **Tests (unit, like the V1 page tests):** V2 behaviour for each point in criteria 2 and 3; V1 unchanged.

**Out of scope:** CI changes (R5), fixing the regression (R5), importing documents or creating releases (user steps).

**Prompt**
```text
First, read and understand the repository before changing anything: AGENTS.md (Scope discipline), docs/PHASE_7_PLAN.md
(§3 and Task R4), demo-apps/release-demo/ (server.mjs, v1/, README.md), tests/unit/demo-apps/release-demo.test.ts,
project-data/release-demo/ (config and docs/requirements.md) and package.json scripts. Briefly list what you will reuse before you
start.

Task R4 (docs/PHASE_7_PLAN.md). Implement exactly acceptance criteria 1–5 of R4, following design decision §3.8. Follow
AGENTS.md "Scope discipline". No framework or new dependency. V1 must stay byte-for-byte unchanged. Size budget ~150 source lines
(HTML excluded). Verify: typecheck, build, npm run test:unit, and start npm run demo:v2 and fetch / and check the sign-out flow.
Report the criterion table, raw Vitest lines and git status --short.

--- requirements-v2.md ---
# Release Demo Requirements — V2

## DEMO-001: Display the login form

Status: Active
Priority: High

### Description

The Release Demo application provides a login page where a user can enter a username and password to access the task list.

### Expected result

The page at `/` shows the heading `Sign in to Release Demo`, a username field labelled `Username`, a password field labelled `Password`, and a button labelled `Sign in`.


## DEMO-002: Log in with the demo account

Status: Active
Priority: Critical
Role: demo_user

### Description

A user can access the task list by submitting the single configured demo account's valid credentials.

### Expected result

When the user enters the demo account's username and password and clicks `Sign in`, the application navigates to `/tasks.html` and displays the heading `My Tasks`.

### Negative cases

- Empty username: login is prevented, the page remains at `/`, and the message `Username is required.` is displayed.
- Empty password: login is prevented, the page remains at `/`, and the message `Password is required.` is displayed.
- Incorrect credentials: signing in with the demo account's username and the password `wrong-password` is prevented, the page remains at `/`, and the message `Username or password is incorrect.` is displayed.


## DEMO-003: Display the predefined task list

Status: Retired
Priority: High
Role: demo_user

### Description

After a successful login, the task list page displays a small, predictable set of initial tasks.

### Expected result

The `/tasks.html` page displays all three task titles: `Prepare release notes`, `Review test results`, and `Approve deployment`.


## DEMO-004: Add a task with a required title

Status: Active
Priority: High
Role: demo_user

### Description

A signed-in user can add a task by entering a non-empty title in the task form.

### Expected result

The `/tasks.html` page shows a text field labelled `Task title` with the placeholder `Enter a task title` and a button labelled `Add task`. When the user enters `Check deployment logs` and clicks `Add task`, `Check deployment logs` appears in the task list.

### Negative cases

- Empty task title: no task is added and the message `Please enter a task title.` is displayed.


## DEMO-005: Sign out

Status: Active
Priority: High
Role: demo_user

### Description

A signed-in user can end their session from the task list page.

### Expected result

After signing in, when the user clicks `Sign out` on `/tasks.html`, the application navigates to `/` and displays the heading `Sign in to Release Demo`.
--- end ---
```

---

## R5 — Fix the planted regression; CI on V2

Run this only after the live walkthrough (§5) has shown the regression in the V2 report.

**Acceptance criteria**
1. The V2 empty-password message is `Password is required.` again; the README says the planted regression was fixed in R5.
2. `.github/workflows/ci.yml`: the Release Demo steps start `npm run demo:v2` instead of `demo:v1`. Nothing else in CI changes.
3. The R4 test for the planted regression now expects the fixed message.

**Prompt**
```text
First, read and understand the repository before changing anything: AGENTS.md, docs/PHASE_7_PLAN.md (§3 and Task R5),
demo-apps/release-demo/ (server.mjs, README.md), tests/unit/demo-apps/release-demo.test.ts and .github/workflows/ci.yml.

Task R5 (docs/PHASE_7_PLAN.md). Implement exactly acceptance criteria 1–3 of R5. Change nothing else. Size budget ~20 lines.
Verify: typecheck, build, npm run test:unit. Report the criterion table, raw Vitest lines and git status --short.
```

## 5. Live walkthrough (your steps after R4, before R5)

You get the exact commands with real IDs at each step. In outline:
1. **V2 requirements:** replace `requirements.md` with `requirements-v2.md` (a short prompt does it), then `requirements import`. Expect DEMO-004 `changed`, DEMO-003 retired, DEMO-005 `new`.
2. **Create release v2:** `release create --release v2`. Expect:
   - flagged: DEMO-003 (retired) and DEMO-004 (changed);
   - affected tests: SCN-0009 (DEMO-003), SCN-0010 and SCN-0011 (DEMO-004);
   - needs tests: DEMO-004 and DEMO-005.
3. **Review:** confirm DEMO-003 and DEMO-004. Retire SCN-0009 (requirement retired) and SCN-0011 (expected message changed). Keep SCN-0010 (adding a task is unchanged).
4. **New tests on V2** (start `npm run demo:v2`): explore DEMO-004 and DEMO-005, plan, generate, validate, then approve the new tests. Re-planning DEMO-004 also produces a new "add a task" scenario that duplicates the kept SCN-0010: approve it or reject it as a duplicate, whichever you prefer.
5. **Run and report:** `run --release v2`, then `release report --release v2`. Expect the planted regression to be flagged: SCN-0004 is newly failing while DEMO-002 is unchanged.
6. **R5**, then `run --release v2` and `release report --release v2` again. The report should be clean. Push; CI on V2 is green.
7. **Exit record:** a documentation-only prompt records Phase 7 in `IMPLEMENTATION_PLAN.md`.

## 6. What Phase 7 hands to Phase 8

| Next phase | What it can rely on |
|---|---|
| Phase 8 (UI, release triggers) | CLI workflows to wrap: `release create`, `release review`, `run --release`, `release report`; committed release records and Markdown reports to display; CI running the active suite for the current release |

## 7. Known risks

- **The comparison relies on authors keeping IDs stable.** A requirement rewritten under a new ID looks like one retired and one new requirement. The review step is where a person catches that.
- **The report matches tests by file name.** Scenario IDs are never reused, so this is stable. A hand-written test that is renamed looks like one removed and one new.
- **The planted regression is deliberate.** Don't forget R5, otherwise CI on V2 stays red.
- **Runs record only the latest results per release for comparison.** Older runs stay in the record, but there are no trends; that's Phase 8 or later.
