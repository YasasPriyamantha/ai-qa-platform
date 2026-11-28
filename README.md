# AI QA Automation Platform

An AI-powered QA automation platform for browser-based web applications. Combines documented requirements, AI-assisted browser exploration, generated test candidates, repeatable test execution, and release-to-release test history.

## Current Status

**Phase 7, Release Comparison and Regression Memory**: complete (2026-11-28): release records, deterministic requirement comparison, human review that keeps or retires affected tests, release runs and regression reports. The planted V2 regression was caught and fixed, and CI runs the active suite against demo app V2. **Next:** decide the scope of Phase 8 (local UI and release triggers) before writing its plan. See [`docs/PHASE_7_PLAN.md`](docs/PHASE_7_PLAN.md).

- Works today: running a project's approved Playwright tests through the CLI, with trustworthy pass/fail reporting.
- Phase 7 is complete (see [`docs/PHASE_7_PLAN.md`](docs/PHASE_7_PLAN.md)). Phase 8 (local UI and release triggers) is not planned yet.
- Detailed progress: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

### Two operating modes

- **AI-assisted authoring (on demand):** AI explores a site, proposes tests, and a human approves them. Planned for Phases 4–6.
- **CI execution (every pipeline run):** only approved Playwright tests run. No AI calls.

## Project Documentation

Complete project specifications and architecture are maintained in the `docs/` directory:

- **[PROJECT_SPEC.md](docs/PROJECT_SPEC.md)** — Product requirements, goals, and success criteria
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System design and component responsibilities
- **[IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** — Phased task breakdown with acceptance criteria
- **[DECISIONS.md](docs/DECISIONS.md)** — Architecture and implementation decision record
- **[PHASE_7_PLAN.md](docs/PHASE_7_PLAN.md)** — Phase 7 task list (complete)
- **[PHASE_6_PLAN.md](docs/PHASE_6_PLAN.md)** — Phase 6 task list (complete)
- **[PHASE_5_PLAN.md](docs/PHASE_5_PLAN.md)** — Phase 5 task list (complete)
- **[REVIEW_RULES.md](docs/REVIEW_RULES.md)** — Rules for writing and reviewing coding tasks
- `docs/archive/` — Historical phase breakdowns (not current instructions)

## Technology Stack

- **Language:** TypeScript (ES Modules)
- **Runtime:** Node.js 22.11+
- **Browser automation:** Playwright Test
- **Platform tests:** Vitest
- **Initial interface:** CLI (local web UI in later phase)
- **AI strategy:** Hosted provider APIs (OpenAI, Anthropic Claude, Google Gemini) with multi-provider support; platform remains local-first for CLI, files, and tests

## Development

```bash
# Install dependencies
npm install

# Build platform
npm run build

# Type-check all TypeScript
npm run typecheck

# Run platform tests (all, including slow browser integration tests)
npm test

# Fast unit tests only (script added in Task N1)
npm run test:unit

# Execute project tests via CLI
npm run qa -- run --config project-data/saucedemo/project.config.json

# Start the platform's Playwright MCP server, list its tools and close it
npm run qa -- mcp-check --config project-data/saucedemo/project.config.json
```

### Browser for Playwright MCP (Phase 4)

`@playwright/mcp` 0.0.86 ships its own Playwright (1.66.0-alpha), which needs a different Chromium build (v1255) from the runner's `@playwright/test` 1.64.1 (v1248). Install it once with the MCP package's own installer:

```bash
node node_modules/@playwright/mcp/cli.js install-browser --no-remove chromium
```

`--no-remove` keeps the runner's Chromium build; without it, Playwright may delete browser builds it thinks are unused. `mcp-check` does not need the browser (it starts no browser); exploration does.

## Validating and approving tests

AI-planned tests reach CI in five steps (DEC-042, `docs/PHASE_6_PLAN.md`):

1. **Generate** candidates from a plan: `npm run qa -- generate --config <config> --plan <plan-id>`.
2. **Validate** them in three separate runs: `npm run qa -- validate --config <config> --plan <plan-id>`. Each scenario becomes `validated`, `needs-revision` or `blocked`.
3. **Read** each `validated` candidate file in `tests/candidates/` and check that its assertions match the documented requirements.
4. **Approve or reject**: `npm run qa -- approve --config <config> --scenario <SCN-…> --reviewer "<name>"` copies it into `tests/approved/`; `npm run qa -- reject --config <config> --scenario <SCN-…> --reviewer "<name>" --reason "<text>"` records why not.
5. **Commit** the approved files and the updated plan, then push. CI runs the approved tests of both apps.

Candidates are never edited by hand. `validate` refuses a changed candidate file and `approve` refuses one changed since validation. Fix a bad candidate by re-planning, not by editing it.

CI gets role credentials from these GitHub Actions repository secrets (Settings → Secrets and variables → Actions), with the same values as your `.env`:

- `SAUCEDEMO_STANDARD_USER_USERNAME`, `SAUCEDEMO_STANDARD_USER_PASSWORD`
- `SAUCEDEMO_LOCKED_OUT_USERNAME`, `SAUCEDEMO_LOCKED_OUT_PASSWORD`
- `RELEASE_DEMO_USERNAME`, `RELEASE_DEMO_PASSWORD`

A missing secret makes the tests that need it fail with "Environment variable … is not set".

## Project Structure

```
ai-qa-platform/
├── src/              # Platform source code
├── tests/
│   ├── unit/         # Platform unit tests
│   ├── integration/  # Platform integration tests
│   └── fixtures/     # Runner test fixtures
├── project-data/     # Target application projects
├── dist/             # Compiled output (excluded from Git)
└── docs/             # Project documentation
```

## License

UNLICENSED - Private project
