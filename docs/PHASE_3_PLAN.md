# Phase 3 Plan (revised, MVP-first)

**Status:** Complete (2026-11-25). Replaces the remaining tasks of `docs/archive/AI_QA_Platform_Phase_3_Mini_Task_Breakdown_Revised (2).md` (see DEC-039).
**Rules:** `AGENTS.md` → *Scope discipline* and `docs/REVIEW_RULES.md` apply to every task.

## 1. Where Phase 3 stands

| Task | Status | Notes |
|---|---|---|
| 3.0a Handoff audit | Complete | |
| 3.0b Feasibility spike | Superseded (DEC-039) | Replaced by the live smoke test in N4 and the first in-platform exploration in Phase 4 |
| 3.1 Document alignment | Complete | DEC-034, DEC-035 |
| 3.2 Provider contracts | Complete | DEC-036 (SDK choice still provisional until N3) |
| 3.2a Structured-output schemas | Complete | DEC-037, Zod 4 |
| 3.3 Provider config and secrets | Complete | DEC-035 enforced |
| 3.3a Request lifecycle and budgets | Complete with known limitations; frozen | The usage ledger is not wired into the lifecycle; reservations are per request, not per attempt; the two-process lock test is skipped on Windows; stale-lock recovery does not check whether the owner is alive. None of these is used in the MVP (DEC-039 item 4). |
| 3.5 Anthropic, 3.6 Gemini, 3.6a OpenAI-compatible | Deferred | Revisit after Phase 5 shows AI-generated tests are useful |

## 2. Remaining work, in order

Each task is small, has one concern, and ends with something you can run.

| # | Task | What you get | Size |
|---|---|---|---|
| N1 | Repository cleanup | Clean repo; platform unit tests pass on Linux and Windows | ~1 h |
| N2 | Approved-test CI pipeline | GitHub Actions runs SauceDemo approved tests on every push | ~1 h |
| N3 | OpenAI adapter (Responses API) | A real adapter behind the existing contract, mock-tested | 2–3 h |
| N4 | `ai-check` CLI command + one live smoke test | `npm run qa -- ai-check` sends one bounded request; Phase 3 exit | 1.5–2 h |

After N4, go straight to a **minimal Phase 4**: the platform connects to Playwright MCP and the model explores one SauceDemo page. Plan it after N4, using the same rules.

---

## N1 — Repository cleanup

**Acceptance criteria**
1. `test-output.txt` and the three `.test-ledger-*/` folders are removed from Git. `.gitignore` ignores `test-output.txt` and `.test-ledger-*/`.
2. `config/ai-providers.json` contains only the `openai` entry (`gpt-6-luna`). The Anthropic and Gemini entries use retired model IDs and have no adapter. The `$schema` line pointing to a missing file is removed. Capabilities are `"unknown"` except `toolCalling: "supported"`, which the spike showed.
3. Windows-only path tests (drive-letter case, UNC paths) run only on Windows (`it.runIf(process.platform === 'win32')`), because the code under test uses the platform's own `path` module. Behaviour on Windows is unchanged. Don't change source code to make them run on Linux.
4. The `.env` inline-comment test no longer depends on the Node version. Document that values containing ` #` must be quoted. `package.json` `engines.node` is `>=22.11.0`.
5. `package.json` gains `test:unit` (`vitest run tests/unit`) and `test:integration` (`vitest run tests/integration`). `npm test` is unchanged.

**Out of scope:** source refactoring, deleting modules, ledger fixes, new tests beyond those required above.

**Prompt**
```text
Task N1 (docs/PHASE_3_PLAN.md). Implement exactly acceptance criteria 1–5 of N1. Follow AGENTS.md "Scope discipline".
Do not change any other source behaviour. Do not delete or rewrite other tests.
Verify: npm run typecheck, npm run build, npm run test:unit, npm test. Report raw Vitest lines, git status --short,
and a table: criterion -> file:line -> evidence.
```
**Done when:** the report shows all five criteria with evidence and `npm test` passes on Windows.

---

## N2 — Approved-test CI pipeline

**Acceptance criteria**
1. `.github/workflows/ci.yml` exists, with two jobs on `ubuntu-latest`:
   - `platform`: `npm ci`, `npm run typecheck`, `npm run build`, `npm run test:unit`.
   - `approved-tests`: `npm ci`, `npx playwright install --with-deps chromium`, `npm run build`, `npm run qa -- run --config project-data/saucedemo/project.config.json`, then upload `project-data/saucedemo/artifacts/` with `if: always()`.
2. No AI provider key, MCP or ledger is used in either job.
3. Both jobs are green on GitHub after you push.

The workflow file is supplied ready to use (`ci.yml`). Copy it into `.github/workflows/`. No coding agent is needed.

**Done when:** the Actions tab shows both jobs green and the SauceDemo run artifacts can be downloaded.

---

## N3 — OpenAI adapter

**Acceptance criteria**
1. `src/model-providers/openai-adapter.ts` implements the existing `ProviderAdapter` interface using the official `openai` SDK (current major; record the exact version in DEC-036 and mark DEC-036 no longer provisional for OpenAI). It uses the Responses API, `store: false` and `maxRetries: 0`.
2. It translates text output, tool calls (`function_call` → `ToolCall`), tool results (`function_call_output`), finish/refusal/incomplete state, `ObservedUsage` and request ID into the existing contract. Reasoning items are passed back unchanged through the existing continuation state.
3. Structured output uses the canonical schema, with strict mode only when the schema meets OpenAI strict rules. External tool schemas are sent with `strict: false`, never rewritten.
4. Provider errors map to the existing `ProviderError` codes and `RetrySafety` values.
5. Mock tests (SDK client injected, no network) cover: a text reply, a structured reply, a tool call followed by a tool result and a second reply with reasoning items preserved, refusal, incomplete output, and the 401/429/500 error mappings. Target 15–25 tests, not more.

**Out of scope:** Anthropic, Gemini and compatible adapters; ledger wiring; CLI changes; live calls.

**Prompt**
```text
Task N3 (docs/PHASE_3_PLAN.md). Implement exactly acceptance criteria 1–5 of N3. Follow AGENTS.md "Scope discipline".
Reuse existing types in src/model-providers (ProviderAdapter, ModelRequest, ModelResult, ObservedUsage, ProviderError,
RetrySafety, SecureContinuationState, CanonicalSchema, ExternalToolSchema). Create no parallel types.
Verify the openai SDK's current API against its installed source/types before writing code.
No live API calls. Verify: typecheck, build, npm run test:unit. Report a table: criterion -> file:line -> test name.
Report the diff size (git diff --stat). If it exceeds ~800 added source lines, stop and explain before continuing.
```
**Done when:** all five criteria have evidence; the diff stays within budget.

---

## N4 — `ai-check` command and one live smoke test (Phase 3 exit)

**Acceptance criteria**
1. `npm run qa -- ai-check` prints the selected provider and model, whether AI is enabled, whether a key is present (never its value), and the budget limits. It makes no network call.
2. `npm run qa -- ai-check --live` sends one bounded request through `executeRequest()` with the OpenAI adapter. It asks for a small structured reply (for example `{ "status": "ok" }`), validates it locally, and prints the result, usage and duration.
3. Limits come from `config/ai-budget.json` and are enforced per run in memory. The ledger is not used. Without that file, `--live` refuses before any network call. Add `config/ai-budget.example.json`; the real file is created by you.
4. Tests (mocked adapter) cover: AI disabled, missing key, missing budget file, and a successful mocked `--live`.
5. You run the live check once yourself, with `AI_ENABLED=true` and your key in `.env`, and record the output in `IMPLEMENTATION_PLAN.md`.

**Out of scope:** MCP, agents, multiple providers, ledger, new budget features.

**Prompt**
```text
Task N4 (docs/PHASE_3_PLAN.md). Implement exactly acceptance criteria 1–4 of N4. Follow AGENTS.md "Scope discipline".
Wire the existing provider-secrets loader, config conversion, budget loader, lifecycle executeRequest() and the N3 OpenAI
adapter. If executeRequest() does not update budget state between requests, keep a per-run in-memory counter in the
command; do not wire the ledger. Do not run a live request yourself; the user runs it.
Verify: typecheck, build, npm run test:unit, plus `npm run qa -- ai-check` (no --live). Report the criterion table.
```
**Phase 3 exit:** N1–N4 done, the live check output is recorded, and `IMPLEMENTATION_PLAN.md` and `README.md` statuses are updated.
