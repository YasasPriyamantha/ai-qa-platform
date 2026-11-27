# Phase 5 Plan: Requirements, Test Planning and Candidate Generation

**Status:** Ready to start (Phase 4 complete, 2026-11-26).
**Rules:** `AGENTS.md` → *Scope discipline* and `docs/REVIEW_RULES.md` apply to every task. One task at a time, one correction round at most. Design decisions are recorded as **DEC-041**.

## 1. Goal and exit criteria

**Goal:** Turn authoritative requirements plus browser observations into **traceable candidate test scenarios** and **candidate Playwright test files**, without ever promoting them to the approved suite.

**Exit criteria** (from `IMPLEMENTATION_PLAN.md` §9, unchanged):
1. A workflow (requirements) document plus exploration observations produce candidate scenarios and candidate test files, and every scenario traces to requirement IDs.
2. Candidate output is never written to `tests/approved/` and never promoted automatically.
3. Demonstrated on **SauceDemo and one different application** (the local demo app from Task 2.11, V1).

**Not in Phase 5** (Phase 6): running candidates, the three-run stability check, human approval and promotion, running role credentials and `storageState` in the runner. Phase 5 only checks candidates statically (schema, traceability and TypeScript).

## 2. How each original Phase 5 item is covered

| `IMPLEMENTATION_PLAN.md` §9 item | Task |
|---|---|
| 1. Structured requirement ingestion with stable author-assigned IDs | Q1 (CLI over the existing Phase 2 parser and registry) |
| 2. AI proposes structured requirements from unstructured documents, for human approval; original preserved | Q5 (over the existing `proposals.ts`) |
| 3. Flag missing, ambiguous or conflicting expected results | Q1 (parser and unresolved markers), Q3 (planner must list conflicts and questions), Q5 (AI marks unresolved, never invents) |
| 4. Release-aware classification: new, changed, unchanged, retired, unresolved | Q1 (from the existing import plan; bound to release records in Phase 7) |
| 5. Scenario schema and category labels (on scenarios, not requirements) | Q3 |
| 6. Planner prompt/module with validated output | Q3 |
| 7. Every scenario linked to one or more requirement IDs | Q3 (enforced by schema and deterministic check) |
| 8. Explicit expected outcomes; assertions trace to requirement text | Q3 (quoted requirement text, checked deterministically), Q4 (assertions come only from those quotes) |
| 9. Candidate generation with a small set of templates and conventions | Q4 (deterministic templates; the AI never writes code) |
| 10. Generate into a restricted candidate workspace | Q4 (`tests/candidates/` only) |
| 11. Stable locators; never persist MCP references | Q4 (role, label and text locators from observed names; `ref=` rejected) |
| 12. Code/schema validation, file-count limits, tool-call limits, stop conditions | Q2 (exploration limits), Q3 (scenario limits), Q4 (validation and file limits) |
| 13. SauceDemo plus at least one different application | Q6 |
| Phase 4 carry-over: summary missed buttons; evidence links not checked against evidence text | Q2 |

## 3. Design decisions (fixed for this phase, recorded as DEC-041)

1. **Requirements stay the only source of expected behaviour.** Observations describe *how* to reach and find things (pages, roles, names). They never decide *what should happen*. Every expected result in a scenario must quote text from a requirement's expected result or negative case. The platform checks the quote deterministically, as a substring after normalising whitespace. Requirements marked unresolved are excluded from planning, and the reason is shown.
2. **The AI plans; the platform writes code.** The planner returns structured scenarios (Zod, DEC-037) whose steps use a small fixed action set: `goto`, `fill`, `click`, `select`, `press`, and `expect` (visible, text, URL). The generator turns these into Playwright code with deterministic templates. No model-written code is saved, and the same scenario always produces the same file.
3. **Stable locators only.** Locators are `getByRole(role, { name })`, `getByLabel`, `getByPlaceholder` and `getByText`, built from role and name pairs present in **supported** observation claims. CSS or XPath selectors, `nth()` positions and MCP references (`ref=…`) are rejected.
4. **Scenario IDs are allocated by the platform** as project-unique `SCN-0001`, `SCN-0002` and so on, never by the model and never reused. Scenarios record the requirement IDs plus each requirement's current content version, so Phase 7 can detect a requirement that changed after generation.
5. **Storage (extends DEC-029):** scenario sets go in `<workspace>/specs/candidates/<plan-id>.json`, versioned with lifecycle status `draft` or `generated` (ARCHITECTURE §7; Phase 6 adds `validated`, `awaiting approval` and `approved`). Candidate files go in `<workspace>/tests/candidates/<scenario-id>.spec.ts`. Each file has a header comment with the scenario ID, requirement IDs, plan ID and source exploration IDs. `tests/approved/` is never written. Candidate files are only written after they pass validation, because `npm run typecheck` (and CI) type-checks `project-data/**/*.ts`.
6. **Interactive exploration needs explicit permission.** The project config gains an optional `exploration.mode`: `"read-only"` (the default) or `"interactive"`. Interactive adds `browser_click`, `browser_type`, `browser_select_option` and `browser_press_key` to the gateway allowlist. File upload, evaluate, run-code, dialogs and tabs stay blocked. The domain guard (DEC-040) applies unchanged, and the environment rule (no `production`) still applies.
7. **Credentials never reach the model** (implements the Phase 5 part of DEC-024). The model writes placeholders such as `{{credential:standard_user.password}}` in `browser_type` text. The gateway replaces them with values from the role's credential variables, read from the root `.env` through the existing parser and never put into `process.env`. Before any tool result or evidence file is stored or returned, it is scrubbed of those values (replaced by `[REDACTED]`). Generated tests read credentials with `process.env.<VARIABLE_NAME>`, never literal values. Passing those variables to the Playwright runner is Phase 6.
8. **Evidence must actually contain the claim.** A summary element, form field or action is `supported` only if its accessible name appears in the text of at least one cited evidence file. Otherwise it is marked `unsupported` and not used for locators.
9. **The second application is the Task 2.11 local demo app, V1 only.** It's a small static site plus a tiny Node HTTP server in `demo-apps/release-demo/`, with no framework and served on `localhost` (HTTP allowed by DEC-015). V2 is added in Phase 7 for release comparison.
10. **CI stays AI-free** (DEC-039). New unit tests use fakes; real MCP and AI runs are integration tests or user steps.

## 4. Tasks

| # | Task | What you get | Size budget (source lines) |
|---|---|---|---|
| Q1 | `requirements` CLI (import, list) | Requirements documents are imported into the registry from the CLI, with classification and diagnostics | ~300 |
| Q2 | Interactive, requirement-guided exploration | `explore --requirement REQ-001` can log in and click through a workflow safely; evidence-checked summaries with buttons/actions | ~400 |
| Q3 | Scenario schema and planner | `plan` produces validated, requirement-traced scenarios from requirements and observations | ~400 |
| Q4 | Candidate generator and validation | `generate` writes type-checked candidate `.spec.ts` files from scenarios with deterministic templates | ~400 |
| Q5 | AI requirement proposals from unstructured documents | `requirements propose` and `requirements review` (accept/reject) over the existing proposal workflow | ~350 |
| Q6 | Second application and end-to-end demonstration | Task 2.11 demo app V1; the whole pipeline run on both apps; Phase 5 exit | ~250 |

The order is the shortest path to working candidate tests: Q1, then Q2, Q3, Q4 on SauceDemo. Then Q5, then Q6.

---

## Q1 — `requirements` CLI (import, list)

**You do first (not the agent):** write the SauceDemo requirements document following `docs/REQUIREMENTS_AUTHORING_CONVENTION.md`, for example `project-data/saucedemo/docs/requirements.md`. The convention's §11 example is a starting point, but you decide the requirements: the agent must not invent them. Add it to the project's `documents` list in `project.config.json`, and add the `standard_user` role with its credential variable names (as in `project-config-with-roles.example.json`).

**Acceptance criteria**
1. `node dist/cli/index.js requirements import --config <project.config.json> --document <documentId>` ingests the declared document (existing `ingestDocument`), parses it (existing parser) and imports it (existing `importRequirements`, all-or-nothing). It prints parse diagnostics with line numbers and exits 1 without changing the registry on any error.
2. On success it prints one line per requirement classified as **new**, **changed**, **unchanged**, **source updated**, **missing from document** or **retired**, plus an **unresolved** flag with the reason. All of these come from the existing import plan; no new classification logic.
3. `requirements list --config <…>` prints active, retired and unresolved requirements (ID, title, status) from the registry.
4. Tests (unit, temp workspaces): a clean import; a second import with one changed and one new requirement, classified correctly; a document with errors, where the registry is unchanged and line numbers are shown; and an unresolved requirement flagged.

**Out of scope:** AI, new parser rules, release records (Phase 7).

**Prompt**
```text
Task Q1 (docs/PHASE_5_PLAN.md). Implement exactly acceptance criteria 1–4 of Q1. Follow AGENTS.md "Scope discipline".
This is a thin CLI over existing Phase 2 code: reuse ingestDocument, parseRequirementDocument, importRequirements and the
registry/storage helpers; add no new parsing, classification or storage logic. Do not create or edit any requirements document.
Size budget ~300 source lines. Verify: typecheck, build, npm run test:unit, and run the import and list commands on the SauceDemo
project. Report the criterion table, the command output, raw Vitest lines and git status --short.
```

---

## Q2 — Interactive, requirement-guided exploration

**Acceptance criteria**
1. Project config accepts optional `exploration.mode` (`"read-only"` default, `"interactive"`), validated by the existing Phase 2 loader. In interactive mode the gateway also allows `browser_click`, `browser_type`, `browser_select_option` and `browser_press_key` (DEC-041 §6). All other tools stay refused, and the domain guard is unchanged.
2. Credential placeholders (§7): `{{credential:<roleId>.<key>}}` in `browser_type` text is replaced by the gateway from the role's variables, read from the parsed root `.env`. Unknown roles or keys are refused. Values are scrubbed from every tool result, evidence file and log. Sentinel tests prove a credential value never appears in anything sent to the model or written to disk.
3. `explore --requirement <REQ-ID>[,…]` adds those requirements' titles, descriptions and expected results to the goal. The instructions tell the model to reach the pages the requirements describe, to use credential placeholders for login, and never to submit anything outside that goal. The record stores `requirementIds`.
4. The summary schema gains `actions` (buttons and links by role and name), and the instructions ask for them. §8 is enforced: a claim is `supported` only if its name appears in a cited evidence file's text.
5. Tests: unit tests (fake MCP) for each new refusal path, placeholder replacement and scrubbing, and the evidence-text check; an integration test on the fixture site with a small login form (extend `tests/fixtures/mcp-site/`), in interactive mode with a test credential, that reaches the page behind the login.

**Out of scope:** planning, generation, `storageState`, the runner.

**User step after Q2:** set `"exploration": { "mode": "interactive" }` in the SauceDemo config, put the real SauceDemo test credentials in `.env`, and run `explore --requirement <one of your REQ IDs>` once live (AI on, then off). Check that the record has the inventory page and that the password appears nowhere.

**Prompt**
```text
Task Q2 (docs/PHASE_5_PLAN.md). Implement exactly acceptance criteria 1–5 of Q2, following design decisions §3.6–3.8.
Follow AGENTS.md "Scope discipline". Extend the existing Phase 2 config loader, P2 tool gateway, P3 loop/summary and P4 record;
create no parallel types. Read role credential values with the existing .env parser (never into process.env). No live API calls.
Size budget ~400 source lines. Verify: typecheck, build, npm run test:unit, npm run test:integration. Report the criterion table,
raw Vitest lines and git status --short.
```

---

## Q3 — Scenario schema and planner

**Acceptance criteria**
1. A canonical Zod `TestScenario` schema (DEC-037) covers:
   - **identity:** the platform-allocated ID (§4); requirement IDs and content versions; category labels (`functional`, `end-to-end`, `black-box`, `regression`, more than one allowed); priority and risk;
   - **setup:** role (or none), preconditions and test-data needs;
   - **content:** steps using the fixed action set (§2); expected results, each with `{ requirementId, quote }`; unresolved questions;
   - **status:** `draft`.
2. `node dist/cli/index.js plan --config <…> --requirements REQ-1[,…] --observations <exploration-id>[,…]` sends only active, resolved requirements plus the supported observation claims to the model through `executeRequest()` (structured output), and saves the scenario set to `specs/candidates/<plan-id>.json` (§5). Unresolved requirements are listed as excluded, with the reason.
3. The platform checks deterministically and rejects or flags:
   - a scenario with no requirement ID, or an unknown or inactive one;
   - an expected result whose quote is not in that requirement's text (§1);
   - a step locator whose role and name is not a supported observation claim (marked `needs-observation`, not dropped);
   - positive and negative coverage: every negative case of a planned requirement either has a scenario or is listed as not covered.

   Questions and conflicts the model reports are kept in the file.
4. Limits: maximum scenarios per plan, AI requests and the budget. On a limit, the stop reason is recorded and whatever was validated is kept.
5. Tests (fake adapter): a valid plan; an invented expected result that fails the quote check; an unknown requirement ID; an unresolved requirement excluded; a missing negative case reported; ID allocation never reuses an existing ID.

**Out of scope:** writing code files, MCP calls during planning, running anything.

**Prompt**
```text
Task Q3 (docs/PHASE_5_PLAN.md). Implement exactly acceptance criteria 1–5 of Q3, following design decisions §3.1–3.5.
Follow AGENTS.md "Scope discipline". Reuse executeRequest(), the OpenAI adapter, createCanonicalSchema, countRunRequest, the
requirement registry and the P4 observation records; create no parallel types. The model never assigns scenario IDs. No live API
calls. Size budget ~400 source lines. Verify: typecheck, build, npm run test:unit. Report the criterion table, raw Vitest lines and
git status --short.
```

---

## Q4 — Candidate generator and validation

**Acceptance criteria**
1. `node dist/cli/index.js generate --config <…> --plan <plan-id>` turns each valid scenario into `tests/candidates/<scenario-id>.spec.ts` with deterministic templates (§2): one `test()` per scenario; the header comment (§5); `page.goto` relative to `baseUrl`; the fixed action mapping; credentials as `process.env.<VAR>` with a clear failure if unset; one `expect` per expected result, using the quoted requirement text.
2. Locators follow §3 only. Scenarios with `needs-observation` steps are skipped and reported, not guessed.
3. Validation before a file is written: TypeScript check against the project's settings (all candidates must pass `npm run typecheck`); forbidden patterns (`ref=`, CSS or XPath selectors, `nth(`, `waitForTimeout`, `test.only`, literal credential values, absolute URLs outside `allowedDomains`); at least one `expect` per expected result. Invalid output is not written; the reasons are reported.
4. Limits: maximum files per run. An existing candidate is never silently overwritten (it needs `--replace`). Nothing is ever written to `tests/approved/`. The scenario set's status changes to `generated` with the candidate file path.
5. Tests: snapshot tests of generated code for each action and assertion type; each forbidden pattern rejected; same input gives identical output; approved directory untouched; overwrite protection.

**Out of scope:** running candidates, approval and promotion (Phase 6), AI calls (generation is deterministic).

**User step after Q4:** run `requirements import`, `explore`, `plan` and `generate` on SauceDemo, open the candidate files and read them. Running them is Phase 6.

**Prompt**
```text
Task Q4 (docs/PHASE_5_PLAN.md). Implement exactly acceptance criteria 1–5 of Q4, following design decisions §3.2–3.5.
Follow AGENTS.md "Scope discipline". Generation is deterministic template rendering from the Q3 scenario files: no AI calls, no
model-written code. Reuse the project config loader, PROJECT_DIRECTORIES (tests/candidates) and atomic write helpers. Verify the
TypeScript-check approach against the installed typescript package before choosing it. Size budget ~400 source lines. Verify:
typecheck, build, npm run test:unit. Report the criterion table, one generated example file, raw Vitest lines and git status --short.
```

---

## Q5 — AI requirement proposals from unstructured documents

**Acceptance criteria**
1. `requirements propose --config <…> --document <documentId>` ingests the document (original snapshot preserved by the existing document service) and asks the model, with structured output, for proposed requirements. Each has a proposed ID, title, description, an expected result **or** an unresolved reason, negative cases, and the source line range it came from.
2. Deterministic checks: proposed IDs follow the convention and don't reuse active or retired IDs; each source line range exists in the snapshot; a proposal with no expected result must be marked unresolved. The model is told never to infer behaviour from websites or general knowledge. Proposals are saved with the existing `createProposal()`; the registry is not touched.
3. `requirements review --config <…> --proposal <id> --accept <REQ-ID>[,…] --reject <REQ-ID>[,…]` uses the existing accept and reject functions. Only accepted items reach the registry.
4. Tests (fake adapter): a valid proposal saved; a reused or retired ID rejected; an invented line range rejected; missing expected result marked unresolved; accept moves one item to the registry, reject doesn't.

**Out of scope:** editing proposals interactively, non-text formats.

**Prompt**
```text
Task Q5 (docs/PHASE_5_PLAN.md). Implement exactly acceptance criteria 1–4 of Q5, following design decision §3.1.
Follow AGENTS.md "Scope discipline". This is a thin layer over the existing documents service and src/requirements/proposals.ts
(createProposal, acceptProposedRequirement, rejectProposedRequirement); add no parallel proposal storage. No live API calls.
Size budget ~350 source lines. Verify: typecheck, build, npm run test:unit. Report the criterion table, raw Vitest lines and
git status --short.
```

---

## Q6 — Second application and end-to-end demonstration (Phase 5 exit)

**Acceptance criteria**
1. `demo-apps/release-demo/` contains Task 2.11 **V1**: a few static pages (for example a login, a list page and a form with validation messages) and a dependency-free Node server script. `npm run demo:v1` serves it on a fixed `localhost` port. It's designed so a V2 variant can be added in Phase 7 without restructuring.
2. `project-data/release-demo/project.config.json` (environment `local`, `http://localhost:<port>`, `allowedDomains: ["localhost"]`, `exploration.mode: "interactive"`, one role) passes the existing loaders.
3. One approved smoke test for the demo app runs through the existing runner, so CI mode works for app 2 too. Adding it to `ci.yml` (start the server, then run) is part of this task.
4. Tests: the server serves the pages; the config loads.

**You do (not the agent):** write the demo app's requirements document (your requirements, following the convention).

**User steps (live, Phase 5 exit):** for **each** app, run `requirements import`, `explore --requirement …`, `plan` and `generate`, then `npm run typecheck`. Record the following in `IMPLEMENTATION_PLAN.md`: the requirements imported, exploration stop reasons, scenarios planned and excluded, candidates generated and skipped, and token usage.

**Prompt**
```text
Task Q6 (docs/PHASE_5_PLAN.md). Implement exactly acceptance criteria 1–4 of Q6, following design decision §3.9.
Follow AGENTS.md "Scope discipline". No framework or new dependency for the demo app; keep V1 small and deterministic. Do not write
the app's requirements document. Size budget ~250 source lines (HTML excluded). Verify: typecheck, build, npm run test:unit, and
the demo app's approved test through `node dist/cli/index.js run --config project-data/release-demo/project.config.json`.
Report the criterion table, raw Vitest lines and git status --short.
```

**Phase 5 exit:** Q1–Q6 done, both live demonstrations recorded, and `IMPLEMENTATION_PLAN.md` and `README.md` statuses updated.

## 5. What Phase 5 hands to the next phases

| Next phase | What it can rely on |
|---|---|
| Phase 6 (validation, execution, reporting) | Candidate files with stable scenario IDs and requirement links in a header; scenario sets with lifecycle status and quoted expected results, for traceability review; credential variable names (Phase 6 passes role credentials to the runner and adds `storageState`); `tests/approved/` untouched, so promotion is a Phase 6 decision |
| Phase 7 (release comparison) | Requirement content versions recorded per scenario; `releaseId` in observations; the demo app's V1, ready for a V2 |
| CI | Approved tests for both apps; candidates are type-checked but not run |

## 6. Known risks

- **Scenario quality depends on observation coverage.** Steps without supported observations are skipped (`needs-observation`), not guessed. The fix is more targeted exploration, not looser checks.
- **Quote checks are strict.** A paraphrased expected result is rejected. That's intended: it is the guard against invented expected behaviour.
- **Generated candidates may fail when run.** That's Phase 6's job to find and report. Phase 5 proves they are traceable, well-formed and type-check.
