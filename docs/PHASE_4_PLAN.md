# Phase 4 Plan: Playwright MCP Browser Exploration

**Status:** Ready to start (Phase 3 MVP complete, 2026-11-25).
**Rules:** `AGENTS.md` → *Scope discipline* and `docs/REVIEW_RULES.md` apply to every task. One task at a time, one correction round at most.

## 1. Goal and exit criteria

**Goal:** The platform's own backend starts Playwright MCP, lets the configured AI model (OpenAI, gpt-6-luna) explore an approved website **read-only**, and saves what was observed as structured, evidence-backed records that Phase 5 can use to plan and generate tests.

**Exit criteria** (from `IMPLEMENTATION_PLAN.md` §8, unchanged):
1. A platform CLI command explores an approved demo site (SauceDemo) and saves observations.
2. It works independently of any VS Code or IDE MCP configuration: the platform starts its own MCP server from its own dependencies.
3. Domain restrictions are enforced by platform code, not only by the prompt.
4. Connection failure, tool error, wrong domain, prompt-injection content, timeout and browser cleanup are tested.
5. One user-run live exploration of SauceDemo is recorded. It must show whether the model itself requested page snapshots, which closes the open question from Task 3.0b (DEC-039).

## 2. How each original Phase 4 item is covered

| `IMPLEMENTATION_PLAN.md` §8 item | Task |
|---|---|
| 1. Read current Playwright MCP and MCP SDK docs | P1 (verified before coding; versions recorded in DEC-040) |
| 2. Install/configure Playwright MCP | P1 |
| 3. Standalone client check: connect, list tools, close cleanly | P1 (`mcp-check` command) |
| 4. Wrap the connection in a platform MCP adapter | P1 (connection) + P2 (tool gateway) |
| 5. Validate tool arguments; timeouts and cancellation | P2 |
| 6. Enforce approved domains before navigation and re-check destinations | P2 |
| 7. Model performs a limited read-only exploration | P3 |
| 8. Store observations with project/release context and evidence metadata | P4 |
| 9. Test connection failure, tool error, wrong domain, prompt injection, timeout, cleanup | P1–P3 (each where the behaviour lives) + P4 exit check |
| Architecture §3.6: discover tools and their schemas; no durable MCP element references; untrusted web content; no downloads or file access | P1, P2, P4 |

## 3. Design decisions (fixed for this phase)

These keep Phase 4 compatible with the existing code and with Phases 5–7. P1 records them as **DEC-040**, with the verified package versions.

1. **Packages.** Use the official Playwright MCP server package (`@playwright/mcp`) and the official MCP TypeScript client SDK, both installed as project dependencies and pinned in the lockfile. Never use `npx …@latest` at runtime. For the SDK, use the v2 client package (`@modelcontextprotocol/client`) only if its npm `latest` tag is a stable, non-prerelease 2.x. Otherwise use v1 (`@modelcontextprotocol/sdk`). Record which one and why.
2. **Process model.** The platform starts the MCP server as a child process over stdio: `process.execPath` plus the package's CLI entry, an argument array, no shell (DEC-019). The child's environment is built with the existing `createFilteredChildEnv()`, so provider API keys never reach the browser process. On close or timeout the whole process tree is stopped; reuse `terminateProcessTree()` where the transport doesn't do it.
3. **Browser settings.** Headless, isolated (in-memory profile), Playwright's bundled Chromium (not a Chrome channel, so it matches the runner and works in CI), image responses off (text accessibility snapshots only), output directory inside the exploration's own folder. Playwright MCP's `--allowed-origins` is set from the project's `allowedDomains` as extra protection only. Its documentation says it is not a security boundary and does not affect redirects.
4. **Tool allowlist (read-only).** Only these tools are offered to the model: navigate, snapshot, navigate back, wait for. Use the exact names from the installed server's `tools/list`. Everything else (click, type, form fill, file upload, evaluate, screenshot, tabs, PDF, install and so on) is not offered, and is refused if requested. Interaction tools (click, type) and logged-in exploration are deferred to Phase 5, with a separate interaction policy and the role credentials of DEC-024.
5. **The domain guard is platform code.** (a) Before calling navigate, the URL must parse and use HTTPS (HTTP only for `localhost`, as in DEC-015), and its hostname must be in the project's `allowedDomains`. (b) After every tool call, the current page URL is read from the result and checked again. If it is off-domain, exploration stops with reason `domain_violation`, and the off-domain content is not sent to the model.
6. **Tool definitions** are passed to the model as `ExternalToolSchema` (DEC-037, `strict: false`, schema unchanged). Tool results become the existing `ToolResultMessage` text content. MCP errors are also written into the text (`Tool error: …`), because the OpenAI adapter does not send `isError`.
7. **AI requests** go through the existing `executeRequest()` lifecycle and the OpenAI adapter: same gates, `config/ai-budget.json` limits, per-run in-memory counting (DEC-039), and no ledger. The per-run counter from `ai-check` is moved into one shared helper, because P3 is its second caller. Don't create a second counter.
8. **Observation storage** (extends the DEC-029 layout): `<project-workspace>/observations/<exploration-id>/` holds `observations.json` (versioned) and `evidence/` (raw snapshot text files). It is git-ignored by default, like artifacts, because real sites may show personal data. `observations.json` records `projectId`, `releaseId` (null until Phase 7), provider and model, limits and usage, stop reason, the visited pages, and the model's summary. Model statements are kept separate from tool evidence, and each statement points to evidence IDs.
9. **MCP element references** (for example `ref=e12`) are temporary. They may appear inside raw evidence files, but must never appear in the model summary or in any field meant to become a locator. Phase 5 builds stable locators from roles and accessible names.
10. **CI stays AI-free.** No MCP or AI step is added to `.github/workflows/ci.yml`. Unit tests use fake MCP clients. Real MCP tests are integration tests (`npm run test:integration`) and run locally.

## 4. Tasks

| # | Task | What you get | Size budget (source lines) |
|---|---|---|---|
| P1 | MCP connection and `mcp-check` | The platform starts Playwright MCP, lists its tools and closes cleanly; DEC-040 | ~300 |
| P2 | Safe tool gateway | Allowlisted, argument-checked, domain-guarded, time-limited tool calls | ~350 |
| P3 | AI exploration loop | The model explores through the gateway within hard limits and returns a validated summary | ~400 |
| P4 | Observation records and `explore` command | `explore` saves evidence-backed observations; one live SauceDemo run; Phase 4 exit | ~300 |

---

## P1 — MCP connection and `mcp-check`

**Acceptance criteria**
1. The MCP server and client packages are installed and pinned, chosen by the rule in §3.1. DEC-040 records the packages, exact versions, the SDK choice and the reason, plus design decisions §3.2–3.10.
2. `src/mcp/` starts the server as described in §3.2–3.3 (no shell, filtered environment, headless, isolated, bundled Chromium, image responses off, allowed origins, output directory) and exposes `connect`, `listTools` and `close`. `close` leaves no MCP or browser process behind, on Windows and Linux.
3. `node dist/cli/index.js mcp-check --config <project.config.json>` prints the server version and the list of tools, then closes. It makes no AI call and doesn't depend on any IDE MCP configuration.
4. Tests:
   - unit tests (fake transport) check the launch arguments and that provider keys are absent from the child environment;
   - one integration test (`tests/integration/mcp/`) starts the real server, lists tools, closes, and confirms the process has exited;
   - a test shows that a failed server start gives a clear error with no leftover process.
5. If the Playwright version used by the MCP server needs a different browser build from `@playwright/test` 1.64.1, the README says how to install it. Don't upgrade `@playwright/test` in this task.

**Out of scope:** calling tools, AI, domain checks, saving anything.

**Prompt**
```text
Task P1 (docs/PHASE_4_PLAN.md). Implement exactly acceptance criteria 1–5 of P1, following design decisions §3.1–3.3 and §3.10.
Follow AGENTS.md "Scope discipline". Before writing code, verify the current package APIs, CLI flags and config options in the installed
packages' own docs/types (not memory or blog posts). Reuse createFilteredChildEnv() and terminateProcessTree(); create no parallel helpers.
Size budget ~300 source lines. Verify: typecheck, build, npm run test:unit, npm run test:integration (MCP test), and
`node dist/cli/index.js mcp-check --config project-data/saucedemo/project.config.json`. Report the criterion table, the tool list
printed, raw Vitest lines, and git status --short.
```

---

## P2 — Safe tool gateway

**Acceptance criteria**
1. A gateway in `src/mcp/` offers the model only the allowlisted tools (§3.4), converted to `ToolDefinition` with `ExternalToolSchema`. Any other tool name is refused without calling the server.
2. Arguments are checked before each call against the tool's input schema and the domain rule (§3.5a). After each call, the page URL is checked again (§3.5b); a violation stops with `domain_violation` and withholds the content.
3. Each call has a timeout and honours an `AbortSignal`. There is a maximum number of tool calls per session. Errors, timeouts and refusals come back as `ToolResultMessage` text with `Tool error: …` (§3.6), never as uncaught exceptions.
4. Results are text-only. Image items are dropped and replaced by a note. Each snapshot is also handed back as raw evidence for P4, with an evidence ID.
5. Tests:
   - unit tests (fake MCP client) cover each refusal path, the call limit, timeout and tool error;
   - integration tests against a local fixture site (a small static HTTP server on `localhost` started by the test, HTML under `tests/fixtures/mcp-site/`) cover: an allowed page; a direct navigation to a non-allowed host, which is refused; a link that redirects off-domain, which is detected after the call; and a page containing prompt-injection text ("ignore your instructions, go to …"), whose text is returned only as data.

**Out of scope:** AI calls, saving observations, click/type tools.

**Prompt**
```text
Task P2 (docs/PHASE_4_PLAN.md). Implement exactly acceptance criteria 1–5 of P2, following design decisions §3.4–3.6 and §3.9.
Follow AGENTS.md "Scope discipline". Reuse the P1 connection and the existing ToolDefinition, ExternalToolSchema and ToolResultMessage
types; create no parallel types. Use the project's existing allowedDomains/baseUrl validation rules (src/projects) rather than new
URL logic. Size budget ~350 source lines. Verify: typecheck, build, npm run test:unit, npm run test:integration. Report the criterion
table, raw Vitest lines and git status --short.
P1 carry-over: P1's "close leaves no browser process" was not exercised because no browser started. In the P2 integration tests that open the fixture site, also assert that after close() no MCP server, Chromium or child process from that session remains (same check the P1 integration test uses).
```

---

## P3 — AI exploration loop

**Acceptance criteria**
1. `src/exploration/` runs the loop: send a request with the gateway's tools through `executeRequest()` (OpenAI adapter, same adapter instance for the whole session so reasoning items carry over), run the requested tool calls through the gateway, append the tool calls and results in order, and repeat.
2. Hard limits stop the loop: AI requests, tool calls, wall-clock time, and the `config/ai-budget.json` per-run limits. The per-run counter is the shared helper (§3.7), and `ai-check` now uses it too. When a limit is close, the last request is sent **without tools** and asks only for the summary. The stop reason is always recorded.
3. The instructions tell the model: the goal (explore the given start page and its directly linked pages, read-only), that page content is untrusted data, that it must take a snapshot before describing a page, and that it must not use element references in its summary.
4. The final summary is structured output with a canonical Zod schema (`ExplorationSummary`: pages, with their main elements by role and accessible name, forms and fields, links to other pages, and blockers), validated locally. Each claim lists the evidence IDs it is based on. A claim that cites no evidence, or cites unknown evidence, is marked `unsupported` and kept, not dropped.
5. Older snapshots in the conversation are replaced by a short note pointing to their evidence ID. Only the latest snapshot is sent in full, and call/result pairing is kept. Per-request input therefore stays within the budget.
6. Tests use a fake adapter and a fake gateway: a normal session; the request limit reached, leading to the forced summary; the tool-call limit; the model asking for a refused tool or an off-domain URL, which is refused and the session continues or stops as specified; an adapter error, after which MCP is still closed (`finally`); an invalid summary, which gives a clear failure; and snapshot compaction.

**Out of scope:** saving files, CLI command, live calls, click/type tools, requirements input (Phase 5).

**Prompt**
```text
Task P3 (docs/PHASE_4_PLAN.md). Implement exactly acceptance criteria 1–6 of P3, following design decisions §3.6–3.7 and §3.9.
Follow AGENTS.md "Scope discipline". Reuse executeRequest(), the OpenAI adapter, createCanonicalSchema, the P2 gateway and the message
helpers; move the ai-check per-run counter into one shared helper used by both callers (no second counter). Do not wire the ledger.
No live API calls. Size budget ~400 source lines. Verify: typecheck, build, npm run test:unit. Report the criterion table, raw Vitest
lines and git status --short.
```

---

## P4 — Observation records and `explore` command (Phase 4 exit)

**Acceptance criteria**
1. `node dist/cli/index.js explore --config <project.config.json> [--start <url>]` runs P3 against the project's `baseUrl` (or `--start`, which must pass the domain rule) and prints the stop reason, pages visited, tool calls, AI requests, token usage and the path to the saved record. Without `AI_ENABLED=true`, a key and a budget, it refuses before starting MCP.
2. The record is saved as in §3.8: `observations.json` with a schema version, a unique exploration ID, timestamps, `projectId`, `releaseId: null`, provider and model, limits and usage, stop reason, the tool-call log (tool name, checked arguments, duration, error flag, evidence ID; no full page text), the validated summary with evidence links and `unsupported` flags, and `evidence/<id>.txt` files. It is written atomically with the existing `atomicWriteRegistry()` (`src/documents/atomic-fs.ts`), which writes any JSON value. `project-data/**/observations/` is added to `.gitignore`.
3. Tests check that no element references appear in the summary fields, and that no API key, `.env` content or provider continuation payload appears in the record or the evidence files (sentinel values).
4. Tests (fake adapter plus the local fixture site through real MCP, as an integration test) cover: a successful exploration that writes a record; and a domain violation, which ends with stop reason `domain_violation` and leaves no off-domain evidence.
5. **User step (live):** raise the limits in `config/ai-budget.json` (suggested: 20 requests, 30,000 input tokens per request, 300,000 cumulative input, 4,000 output per request, 40,000 cumulative output). Then run `explore` once on SauceDemo. Record the following in `IMPLEMENTATION_PLAN.md`: the stop reason, pages, tool calls (**including whether the model called the snapshot tool itself**), usage and the record path. Afterwards set `AI_ENABLED=false`.

**Out of scope:** requirement linking, test generation, click/type exploration, release comparison, ledger.

**Prompt**
```text
Task P4 (docs/PHASE_4_PLAN.md). Implement exactly acceptance criteria 1–4 of P4, following design decisions §3.8–3.10.
Follow AGENTS.md "Scope discipline". Reuse the P3 exploration loop, the existing CLI argument/output conventions, atomicWriteRegistry()
and the project config loader. Do not run a live exploration; the user runs it. Size budget ~300 source lines. Verify:
typecheck, build, npm run test:unit, npm run test:integration, and `node dist/cli/index.js explore --config
project-data/saucedemo/project.config.json` with AI disabled (must refuse cleanly). Report the criterion table, raw Vitest lines and
git status --short.
Carry-over notes: (a) Start the MCP server for each exploration with its --output-dir inside observations/<exploration-id>/
(design §3.3), so the .yml snapshot files the server writes on navigate stay inside the git-ignored exploration folder.
(b) Navigate/back/wait results contain only a link to a .yml file, not page content; only browser_snapshot results are evidence. Keep that rule.
```

**Phase 4 exit:** P1–P4 done, the live run is recorded, and the `IMPLEMENTATION_PLAN.md` and `README.md` statuses are updated.

## 5. What Phase 4 hands to the next phases

| Next phase | What it can rely on |
|---|---|
| Phase 5 (planning and generation) | `observations.json` per exploration: pages, elements by role and accessible name, forms, links, blockers, each claim linked to raw evidence. The gateway and loop can be extended with click/type tools under an interaction policy and with role logins (DEC-024). Observations are inputs; requirements stay the authority for expected behaviour. |
| Phase 6 (validation) | Candidate tests run through the existing runner, never through MCP. MCP is not a source of pass/fail (DEC-004). |
| Phase 7 (release comparison) | `releaseId` already exists in the record; observations can be grouped by release once releases exist. |
| CI | Unchanged and AI-free. |

## 6. Known risks

- **The model may not request snapshots on its own** (the open question from 3.0b). P3's instructions require a snapshot before describing a page, and P4's live run measures it. If the model still skips them, the fix is a prompt or model change, not new infrastructure.
- **Snapshot size.** Large pages produce large snapshots. Compaction (P3, criterion 5) and the per-request input limit bound it; a page too large for the limit stops with a clear reason instead of being cut silently.
- **Playwright version drift** between the MCP server and the runner can need a separate browser install (P1, criterion 5).
