# AI QA Automation Platform

An AI-powered QA automation platform for browser-based web applications. Combines documented requirements, AI-assisted browser exploration, generated test candidates, repeatable test execution, and release-to-release test history.

## Current Status

**Phase 3, Hosted AI Provider Integration**: complete (MVP: OpenAI only, DEC-039). **Next:** Phase 4, Playwright MCP browser exploration.

- Works today: running a project's approved Playwright tests through the CLI, with trustworthy pass/fail reporting.
- Next: approved-test CI pipeline, the OpenAI adapter, and a CLI AI check. See [`docs/PHASE_3_PLAN.md`](docs/PHASE_3_PLAN.md).
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
- **[PHASE_3_PLAN.md](docs/PHASE_3_PLAN.md)** — Current phase task list
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
