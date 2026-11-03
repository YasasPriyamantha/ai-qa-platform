# AI QA Automation Platform

An AI-powered QA automation platform for browser-based web applications. Combines documented requirements, AI-assisted browser exploration, generated test candidates, repeatable test execution, and release-to-release test history.

## Current Status

**Phase 1 — Generic Playwright Execution Engine** (In Progress)

Building the foundational test execution infrastructure without AI dependencies. The deterministic execution engine must work before AI integration begins.

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
- **AI strategy:** Local model first, optional provider adapter later

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

# Execute CLI (placeholder in Phase 1)
npm run qa
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
