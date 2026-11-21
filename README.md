# AI QA Automation Platform

An AI-powered QA automation platform for browser-based web applications. Combines documented requirements, AI-assisted browser exploration, generated test candidates, repeatable test execution, and release-to-release test history.

## Current Status

**Phase 2 — Project and Workflow-Document Management** (Complete)

Project workspaces, document ingestion, requirement schema, role profiles, and credential security are implemented. 999 tests passing across 27 test files.

**Next:** Hosted-provider feasibility spike and Phase 3 (Hosted AI Provider Integration).

## Project Documentation

Complete project specifications and architecture are maintained in the `docs/` directory:

- **[PROJECT_SPEC.md](docs/PROJECT_SPEC.md)** — Product requirements, goals, and success criteria
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — System design and component responsibilities
- **[IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)** — Phased task breakdown with acceptance criteria
- **[DECISIONS.md](docs/DECISIONS.md)** — Architecture and implementation decision record

## Technology Stack

- **Language:** TypeScript (ES Modules)
- **Runtime:** Node.js 22+
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

# Run platform tests
npm test

# Execute project tests via CLI
npm run qa -- run --config project-data/saucedemo/project.config.json
```

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
