# Phase 6 Plan: Candidate Validation, Approval and CI

**Status:** Ready to start (Phase 5 complete, 2026-11-27).
**Rules:** `AGENTS.md` → *Scope discipline* and `docs/REVIEW_RULES.md` apply to every task. One task at a time, one correction round at most. Design decisions are recorded as **DEC-042**.

## 1. Goal and exit criteria

**Goal:** Run the Phase 5 candidate tests, prove which ones are stable, let a human approve the good ones into `tests/approved/`, and have CI run those approved, AI-planned tests on every push.

**Exit criteria** (from `IMPLEMENTATION_PLAN.md` §10, plus the MVP CI goal of DEC-039):
1. A candidate test can be validated and run: three separate executions, with a recorded verdict.
2. The record shows actual outcomes and the available evidence: run directories with JSON and HTML reports, plus traces and screenshots on failure.
3. Reviewers control promotion: only an explicit `approve` by a named reviewer puts a candidate into `tests/approved/`, never anything automatic.
4. Approved AI-planned tests for **both** apps (SauceDemo and the Release Demo) run green in CI, with role credentials from GitHub Actions secrets.

**Not in Phase 6:** `storageState` and login setup projects (deferred, §3.3), AI failure analysis (deferred, §3.8), editing candidates by hand, Playwright retries, release comparison and the demo app's V2 (Phase 7), and the UI (Phase 8).

## 2. How each original Phase 6 item is covered

| `IMPLEMENTATION_PLAN.md` §10 item | Task |
|---|---|
| 1. Candidate syntax and TypeScript checks | Done in Q4 (`generate` type-checks before writing). V2 proves the file is unchanged since then (§3.5). |
| 2. Run candidates in a controlled subprocess with timeouts | V2 (existing runner, own run directory per execution, runner timeout) |
| 3. Validate test IDs, requirement links and assertion traceability | Done in Q3/Q4. V2 adds the unchanged-file check, V3 the requirement-version check. |
| 4. Three separate executions, retries disabled; inconsistent results flagged unstable | V2 |
| 5. Human review that assertions represent documented behaviour | V3 (`approve` shows the requirement quotes next to the checks; a named reviewer decides) |
| 6. Parse Playwright JSON including top-level errors; keep native HTML | Done in Phase 1 (`reconcileRunResult`); V2 reuses it |
| 7. Traces, screenshots and logs by configuration | Done in Phase 1 (`retain-on-failure`, `only-on-failure`, logs); V2 prints the run directories |
| 8. Normalise statuses without collapsing distinct failure causes | V2 (`blocked` vs `needs-revision`, failing vs unstable) |
| 9. Separate observed facts from AI failure hypotheses | Deferred (§3.8): Phase 6 records observed facts only and makes no AI calls |
| 10. Approval and rejection workflow | V3 |
| 11. A failed run, missing report, empty suite or inconsistent result is never reported as passing | Done in Phase 1 for runs; V2 criterion 4 extends it to verdicts |
| Phase 5 LATER: `checkCredentialPresence` reads `process.env` | V1 (the runner checks the merged `.env` and environment values) |
| MVP CI goal (DEC-039): approved AI-planned tests run in CI | V4 |

## 3. Design decisions (fixed for this phase, recorded as DEC-042)

1. **Two test folders, one runner.** Approved tests (`tests/approved/`) run with `run`, as today. Candidates (`tests/candidates/`) run only through `validate`. Both go through the existing runner and the single platform Playwright config, which selects the folder through one validated environment variable (default: approved). No second Playwright config.
2. **Role credentials reach Playwright** (completes the DEC-024 runner part). For every credential variable named by the project's roles, the runner passes the value from the parsed root `.env` (existing parser). If `.env` has no value, the inherited environment value is kept: that's how CI supplies GitHub secrets. `.env` wins when both exist. Only role variables are added, never other `.env` entries, and the existing filter still strips AI provider keys. The platform never prints or writes a value. Playwright's own traces of a failed test can contain typed values. Locally they stay in git-ignored `artifacts/`. CI uploads them only because both current apps use public demo credentials. **Before a project with non-public credentials runs in CI, CI must stop uploading traces and HTML reports.**
3. **`storageState` is deferred.** Every generated test logs in through the login form itself, so no current test needs a saved session (DEC-039 rule 6). It is added when a site needs it, for example MFA or SSO with a manually exported session (`AUTHENTICATION_AND_CREDENTIALS.md` §7.3), or when login time matters.
4. **Stability check.** `validate` runs the selected candidates in **three separate executions** (separate processes and run directories), with retries 0 (unchanged) and `--workers=1`. Verdict per candidate: passed in all three → `validated`; failed in all three → `needs-revision` (failing); mixed → `needs-revision` (unstable); any execution without a trustworthy result for that candidate (timeout, infrastructure error, incomplete report, no result for its file, or a missing credential) → `blocked`, with the reason. Three passes are evidence, not a guarantee.
5. **Candidates are never edited by hand.** Before running, a candidate file must be byte-identical to what the generator renders from its plan today, using the same render function and not a second renderer. A changed or stale file is `blocked` with "regenerate it". The fix for a bad candidate is a better requirement, exploration or plan, then a new plan with new scenario IDs.
6. **Lifecycle lives in the plan file** (ARCHITECTURE §7; extends DEC-041 §5). Each scenario's `status` becomes one of `draft`, `validated`, `needs-revision`, `blocked`, `approved` or `rejected`. "Awaiting approval" is `validated`. Validation and approval details are stored on the scenario, so the plan file stays the single record, and Phase 7 reads approved tests' requirement links from it. Existing plan files stay valid; there is no migration.
7. **Approval is explicit and human.** `approve --reviewer <name>` promotes only a `validated` scenario whose file is unchanged since validation and whose requirements are still active at the planned content version. It copies the file to the project's approved folder, replacing only the first header line with an approval line. `approve` is the only platform code that writes to `tests/approved/`; hand-written smoke tests stay as they are. `reject` records the reason and keeps the candidate file. Approved and rejected scenarios are final; scenario IDs are never reused.
8. **No AI in Phase 6.** Validation and approval are deterministic. A failure is described by observed facts only: run status, test status, error message, reports and traces. AI failure hypotheses (§10 item 9) are deferred until real use shows they're needed.
9. **CI runs approved AI-planned tests.** The approved-tests job passes the role credential variables from GitHub Actions secrets as environment variables. CI stays AI-free and never runs candidates. A missing secret makes the dependent tests fail with "Environment variable … is not set", never pass.

## 4. Tasks

| # | Task | What you get | Size budget (source lines) |
|---|---|---|---|
| V1 | Role credentials in test runs | `run` gives Playwright the role credentials from `.env` (or the environment in CI), and warns about missing ones by name | ~150 |
| V2 | `validate`: three-run stability check | `validate --plan <id>` runs the candidates three times and records `validated`, `needs-revision` or `blocked` per scenario, with report paths | ~350 |
| V3 | `approve` and `reject` | A named reviewer promotes a validated candidate into `tests/approved/`, or rejects it with a reason | ~250 |
| V4 | CI with approved AI-planned tests, and Phase 6 exit | CI runs the approved tests of both apps with credentials from GitHub secrets; docs updated | ~50 plus docs |

The order is the shortest path to AI-planned tests running in CI: V1 (credentials), V2 (validate), V3 (approve), V4 (CI).

---

## V1 — Role credentials in test runs

**Acceptance criteria**
1. The runner accepts extra environment variables for the Playwright child process, added through the existing `createFilteredChildEnv()` additions. `run` builds them from the project's roles (§3.2): the value from the parsed root `.env` (existing `parseEnvFile` and `getEnvSecret`), otherwise the inherited value. Only role credential variables are added.
2. Before running, `run` prints the **names** of role credential variables that have no value in either source, as a warning, using the existing `checkCredentialPresence()` over the merged values. The run still goes ahead, because smoke tests need no credentials.
3. No credential value is printed or written by the platform (console output, run metadata, persisted logs).
4. Tests (temp workspaces, fixture project): the `.env` value reaches a fixture test, which checks `process.env.<VAR>` equals a sentinel and prints nothing; the inherited value is used when `.env` lacks it; `.env` wins when both exist; an AI provider key in `.env` never reaches Playwright; the missing-name warning; the sentinel appears in no file the platform writes in the run directory.

**Out of scope:** candidates and `validate` (V2), `storageState` and setup projects (§3.3), changing exploration's credential handling (DEC-041 §7 stays as it is).

**User step after V1:** run `run` for both apps (start the demo app first). Both smoke tests still pass, and no credential warning appears.

**Prompt**
```text
Task V1 (docs/PHASE_6_PLAN.md). Implement exactly acceptance criteria 1–4 of V1, following design decision §3.2.
Follow AGENTS.md "Scope discipline". Reuse createFilteredChildEnv() additions, parseEnvFile/getEnvSecret and checkCredentialPresence();
create no new env parser or presence checker. Do not change exploration's credential handling. Size budget ~150 source lines.
Verify: typecheck, build, npm run test:unit, and `node dist/cli/index.js run --config project-data/saucedemo/project.config.json`.
Report the criterion table, raw Vitest lines and git status --short.
```

---

## V2 — `validate`: three-run stability check

**Acceptance criteria**
1. **Test set selection (§3.1):** the platform Playwright config accepts one optional, validated environment variable that selects the project's `tests/candidates/` folder instead of the approved test folder. It defaults to approved; any other value is refused, and so is a missing candidates folder. A runner option sets it. `run` is unchanged and still runs approved tests only.
2. **Checks before running:** `node dist/cli/index.js validate --config <…> --plan <plan-id> [--scenario SCN-…[,…]]` selects the plan's scenarios that have a `candidateFile` and are not `approved` or `rejected`. Scenarios without a file are listed as "not generated" and ignored. A selected scenario is `blocked`, and not run, if:
   - its file is not byte-identical to what the generator's existing render function produces from the plan (§3.5; export that function, no second renderer), with the reason "regenerate it"; or
   - a credential variable its file uses (`process.env.<VAR>`) has no value in `.env` or the environment (names only, same merge as V1).
3. **Three executions (§3.4):** the remaining candidates run in three separate executions through the existing runner. Each execution is one Playwright process for all of them, with `--workers=1` and V1 credentials, in its own run directory with JSON and HTML reports. Each execution is reconciled with the existing `reconcileRunResult()`. Each candidate's result is taken from the parsed report by file.
4. **Verdict per candidate (§3.4):** `validated`, `needs-revision` (with `failing` or `unstable`) or `blocked` (with the reason), exactly as §3.4 defines them. A candidate is never `validated` without a `passed` result in all three executions. Distinct causes stay distinct.
5. **Record (§3.6):** the scenario schema's `status` is extended to `draft | validated | needs-revision | blocked | approved | rejected`, and an optional `validation` field holds `{ validatedAt, verdict, reason, candidateSha256, runs: [{ runId, runStatus, testStatus }] }`. The plan file is written atomically. The CLI prints one line per candidate (verdict and reason) and the three run directories. It exits 0 when every candidate is `validated`, otherwise 1.
6. **Tests:** verdict rules for all outcomes (fake runner results: 3 passes, 3 fails, mixed, a timed-out execution, a missing result for a file); the changed-file and missing-credential blocks; the test-set variable refused for bad values; and one real run on a temp fixture project with one passing and one failing candidate.

**Out of scope:** approval (V3), AI failure analysis (§3.8), Playwright retries or `--repeat-each`, editing or regenerating candidates, `storageState`.

**User step after V2 (live, no AI):** validate all three plans. Start the demo app first for the Release Demo plan. Then look at each `needs-revision` or `blocked` candidate's HTML report.

**Prompt**
```text
Task V2 (docs/PHASE_6_PLAN.md). Implement exactly acceptance criteria 1–6 of V2, following design decisions §3.1 and §3.4–3.6.
Follow AGENTS.md "Scope discipline". Reuse the existing runner, loadPlaywrightConfig, reconcileRunResult/parsed report, the
generator's render function (export it; do not write a second renderer), the Q3 scenario schema and atomic write helpers, and the
V1 credential merge. No AI calls. Size budget ~350 source lines. Verify: typecheck, build, npm run test:unit, and validate one
SauceDemo plan. Report the criterion table, the validate output, raw Vitest lines and git status --short.
```

---

## V3 — `approve` and `reject`

**Acceptance criteria**
1. `node dist/cli/index.js approve --config <…> --scenario SCN-…[,…] --reviewer "<name>"` first prints, for each scenario, its requirement IDs, its expected-result quotes and its `expect` steps, so the reviewer can see that the checks match the documented behaviour.
2. It then promotes a scenario only if:
   - its status is `validated`;
   - its candidate file's SHA-256 equals `validation.candidateSha256`;
   - every requirement it links to is still active, at the content version in `requirementVersions` (otherwise: "requirement changed since planning; re-plan");
   - no file of that name exists in the approved folder.
   Each failed condition is reported, and nothing is written for that scenario.
3. **Promotion (§3.7):** it copies the candidate to `<project testDirectory>/<scenario-id>.spec.ts`, replacing only the first header line with `// Approved test (DEC-042): approved by <reviewer> on <date> after validation runs <run IDs>. Do not edit; re-plan instead.` The rest of the file stays byte-identical.
4. **Record:** the scenario's `status` becomes `approved`, with `approval: { reviewer, decidedAt, approvedFile, approvedSha256 }`. `reject --config <…> --scenario SCN-…[,…] --reviewer "<name>" --reason "<text>"` sets `rejected` with the reviewer, date and reason, and keeps the candidate file. `validate`, `approve` and `reject` refuse scenarios that are already `approved` or `rejected`.
5. **Tests:** a refusal for each condition in criterion 2, with the approved folder untouched; the header replacement and an otherwise identical file; the plan update; reject; and an approved file passing `npm run typecheck` (it is under `project-data/**/*.ts`).

**Out of scope:** automatic approval, editing approved tests, un-approving or retiring tests (Phase 7), UI.

**User step after V3:** open each `validated` candidate file and read it. Approve the ones whose checks really match your requirements, and reject the rest with a reason. Then `run` both apps: the approved tests run with the smoke tests.

**Prompt**
```text
Task V3 (docs/PHASE_6_PLAN.md). Implement exactly acceptance criteria 1–5 of V3, following design decisions §3.6 and §3.7.
Follow AGENTS.md "Scope discipline". Reuse the V2 scenario schema and plan writes, the requirement registry loader and the project
config's resolved test directory. approve must be the only platform code that writes to the approved test folder. No AI calls.
Size budget ~250 source lines. Verify: typecheck, build, npm run test:unit. Report the criterion table, raw Vitest lines and
git status --short.
Carry-over note (from the first live validations):
(a) V2 fix: Playwright error messages contain ANSI colour codes (for example "\x1b[2m"), which validate currently copies into
    validation reasons, the plan file and the console. Strip ANSI escape sequences from the error text before it is stored or
    printed. Add one test with a coloured error message. Keep the reason's first line only, as now.
```

---

## V4 — CI with approved AI-planned tests, and Phase 6 exit

**You do first (not the agent):** in GitHub → repository **Settings → Secrets and variables → Actions**, add one repository secret per role credential variable used by your approved tests:
- `SAUCEDEMO_STANDARD_USER_USERNAME`, `SAUCEDEMO_STANDARD_USER_PASSWORD`;
- `SAUCEDEMO_LOCKED_OUT_USERNAME`, `SAUCEDEMO_LOCKED_OUT_PASSWORD`;
- `RELEASE_DEMO_USERNAME`, `RELEASE_DEMO_PASSWORD`.

Use the same values as your `.env`.

**Acceptance criteria**
1. `.github/workflows/ci.yml`: the approved-tests job sets each role credential variable of both projects from the matching secret (`${{ secrets.NAME }}`) as an environment variable for the two run steps. No value appears in the file.
2. CI still runs only approved tests and makes no AI or MCP calls (DEC-039). The trace-upload gate of §3.2 is written as a comment next to the upload steps.
3. `README.md` gains a short "Validating and approving tests" section: `generate` → `validate` → read the file → `approve`/`reject` → commit → CI. It lists the GitHub secrets, and says that edited candidates are refused and must be re-planned.
4. `AGENTS.md`: the Phase 6 rule replaces "Never write to `tests/approved/`" with "Only `approve` writes to `tests/approved/`; never edit candidate or approved files by hand".

**Out of scope:** release triggers and CI artifact linking (Phase 8), running candidates in CI.

**User steps (live, Phase 6 exit):**
1. Push after V3 with your approvals committed. In GitHub Actions, check that the approved-tests job runs your approved tests for both apps and is green.
2. Record the exit: run the exit-record prompt you'll get then. It records each plan's verdicts, the approvals and rejections with reasons, and the CI run in `IMPLEMENTATION_PLAN.md`, and updates the status lines.

**Prompt**
```text
Task V4 (docs/PHASE_6_PLAN.md). Implement exactly acceptance criteria 1–4 of V4, following design decisions §3.2 and §3.9.
Follow AGENTS.md "Scope discipline". Read the role credential variable names from both project configs; put no values in any file.
Size budget ~50 lines plus docs. Verify: typecheck, build, npm run test:unit, and that ci.yml is valid YAML. Report the criterion
table and git status --short.
```

## 5. What Phase 6 hands to the next phases

| Next phase | What it can rely on |
|---|---|
| Phase 7 (release comparison) | Approved tests in `tests/approved/`, each traced in its plan file to requirement IDs and content versions, with validation runs and the approving reviewer; scenario statuses for the whole lifecycle; the demo app's V1, ready for a V2 |
| Phase 8 (UI, release triggers) | CLI workflows to wrap: `validate`, `approve`, `reject`, `run`; CI already running approved tests with secrets |
| CI | Approved AI-planned tests for both apps, with credentials from GitHub secrets |

## 6. Known risks

- **Candidates may fail for reasons other than the product.** The test, the environment, the data or the product may be at fault (ARCHITECTURE §7). That's why the verdict is `needs-revision` or `blocked`, never "product broken". Phase 5's LATER items predict some failures: for example, `getByText('1')` for the SauceDemo cart badge may match more than one element.
- **SauceDemo is an external site.** If it's down or slow, executions are `blocked`, not failed. Re-run `validate` later.
- **Typed credentials can appear in Playwright traces of failed tests** (§3.2). That's acceptable for the two public demo apps, and gated for anything else.
- **Three passes are evidence, not a guarantee.** A test can still turn flaky later. Phase 7's repeated runs will show it.
