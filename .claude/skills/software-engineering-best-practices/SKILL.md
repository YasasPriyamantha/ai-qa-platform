---
name: software-engineering-best-practices
description: Use when planning or implementing a non-trivial software change, reviewing or refactoring a codebase, making architecture or technology decisions, designing tests, or assessing maintainability and engineering risk. Apply proportionately; for a tiny low-risk edit, use only the relevant guidance. Read references/security.md when changing trust boundaries, authentication, authorization, input handling, sensitive data, dependencies, or build pipelines; read references/release-operations.md when changing CI/CD, infrastructure, deployment, production reliability, or operations; consult references/sources.md when evidence or further reading is needed.
version: 2.0.0
last_reviewed: 2026-11-12
---

# Software Engineering Best Practices

## Purpose

Help engineers and coding agents deliver software that is correct, understandable, maintainable, secure, testable, and operable. This is an evidence-informed decision framework, not a rigid methodology. Scale effort to the system's risk, domain, size, maturity, team, deployment model, and constraints.

Do not introduce architecture, abstractions, dependencies, tooling, documentation, or process merely because this skill mentions them. Prefer the simplest approach that meets real requirements and quality attributes.

## When to use this skill

Use for non-trivial feature work, bug fixes, refactoring, code review, test strategy, architecture decisions, dependency or platform changes, and engineering plans. For tiny, low-risk edits, apply only the relevant rules. For safety-critical, financial, medical, regulated, privacy-sensitive, or high-availability systems, add applicable domain standards, specialist review, and stronger evidence.

## Authority and decision rules

1. Follow applicable law, regulation, contracts, safety obligations, and domain-specific standards.
2. Follow repository instructions and accepted project decisions unless they conflict with a higher-level obligation or a demonstrable security/correctness issue. Surface conflicts; do not silently override them.
3. Use official language, framework, platform, and vendor documentation for current API and implementation details.
4. Use recognized standards and knowledge bases (for example, NIST, OWASP, CWE, SEI, ISO/IEC) for relevant controls and terminology.
5. Treat peer-reviewed studies as evidence bounded by their methods, samples, settings, and limitations. Treat preprints as preliminary evidence.
6. Treat engineering blogs and practitioner reports as useful experience, not universal proof.

Do not present a heuristic as an absolute rule. There is no universally correct architecture, branching model, test ratio, programming paradigm, or review workflow. Do not claim that microservices, a design pattern, high test coverage, more comments, or an optimization is inherently better without a concrete, contextual reason.

## Operating principles

- Understand the repository and the actual request before editing.
- Make the smallest coherent change that satisfies stated behavior and acceptance criteria.
- Prefer clarity, explicit contracts, and predictable behavior over cleverness.
- Keep responsibilities and boundaries understandable; introduce abstractions for demonstrated reuse, volatility, or complexity—not imagined future needs.
- Validate untrusted data at trust boundaries; types and static analysis do not replace runtime validation.
- Make side effects, errors, permissions, and state transitions explicit.
- Design for testability, diagnosability, and safe failure in proportion to operational risk.
- Measure before making performance claims or optimizing.
- Treat AI-generated code, tests, migrations, documentation, and conclusions as untrusted contributions that require human-quality review.

## Workflow

### 1. Inspect and establish a baseline

- Read the request, acceptance criteria, constraints, and non-goals. Resolve what can be inferred from the repository; state assumptions where appropriate.
- Read all applicable agent/project instructions (for example, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`) and resolve precedence before acting.
- Inspect the relevant code path, directory structure, manifests, lockfiles, configuration, runtime/framework versions, and neighboring tests.
- Check Git status and preserve all pre-existing user changes. Do not reset, overwrite, reformat, or delete unrelated work.
- Identify the existing verification commands and inspect project scripts/configuration before running unfamiliar commands. Do not execute untrusted scripts blindly.
- When practical and safe, run the relevant existing tests/checks **before editing**. Record baseline failures, skipped tests, environment limitations, and commands. Do not attribute pre-existing failures to the change.
- For non-trivial work, write a short plan naming likely files/components, behavior, verification, and important risks.

### 2. Define behavior and design the change

- Translate the request into observable outcomes and explicit acceptance criteria.
- Consider negative, boundary, permission, malformed-input, and failure cases.
- Identify relevant non-functional requirements: security, privacy, performance, accessibility, compatibility, availability, maintainability, and operability.
- Identify data invariants, ownership, authorization rules, API/schema contracts, migration implications, and rollback needs.
- Prefer the existing architecture or a modular monolith unless independently deployable/scalable services, team ownership, or fault isolation justify distribution.
- Consider a simpler alternative. Record consequential, long-lived decisions in an ADR when the project uses them.
- For material security or operational changes, perform a lightweight threat/failure analysis before implementation.

### 3. Implement in focused steps

- Follow established project idioms and supported runtime/framework versions.
- Use domain-meaningful names; keep functions and modules cohesive. Split code when it improves comprehension, testability, or change isolation—not to meet arbitrary size limits.
- Keep business rules separate from transport, presentation, and persistence concerns where useful.
- Make control flow and state transitions easy to follow. Avoid hidden global state, needless mutation, duplicated rules, and implicit side effects.
- Handle errors deliberately: preserve diagnostic context, distinguish expected failures from defects, and do not leak secrets or internals to users.
- Keep configuration external to code and validate required configuration at startup where appropriate. Never hard-code credentials, tokens, private keys, or environment-specific secrets.
- Comment on intent, invariants, trade-offs, and non-obvious constraints—not on syntax. Keep docs aligned with behavior.
- Avoid unrelated cleanup and broad rewrites. Do not add a dependency for trivial functionality without evaluating maintenance, license, provenance, compatibility, and security.
- Do not leave placeholder implementations, empty handlers, fake success paths, or known-broken TODOs while reporting the task complete. Clearly label intentional scaffolding and its limitations.

### 4. Test and verify

- Add or update tests that prove the changed behavior and important failure/boundary cases.
- Choose test levels based on the behavior and risk: unit, component, integration, contract, end-to-end, property-based, fuzz, or manual tests as appropriate. Do not enforce a universal test pyramid ratio.
- Prefer deterministic tests with controlled time, randomness, network, and external state. Avoid testing private implementation details when stable behavior contracts are available.
- Run the narrowest relevant tests first, then required broader suites. Also run applicable formatter, linter, type-checker, static analysis, build, migration, and security checks.
- Compare results with the pre-change baseline. A test passing after a change does not prove the change is correct if it never exercises the changed behavior.
- Never skip, disable, weaken, delete, or rewrite a test merely to make CI green. If a test is invalid or obsolete, explain why and replace its coverage appropriately.
- If two or three materially different attempts fail without new evidence, stop thrashing: reassess assumptions, summarize attempts and evidence, and report the blocker or ask for a decision when needed.
- Never claim a check passed unless it was actually run and its result observed. If a check cannot run, state why and what remains unverified.

### 5. Review the final diff

Review the change as if another engineer wrote it. Confirm:

- It satisfies the request and acceptance criteria without unrelated scope.
- Logic, edge cases, state transitions, error paths, and compatibility are correct.
- Validation and authorization occur at the trusted boundary.
- Tests exercise the behavior and would fail for the defect being addressed.
- No accidental secrets, debug code, temporary files, generated artifacts, skipped tests, or unrelated formatting churn were introduced.
- Logs and user-facing errors are useful without exposing sensitive information.
- Documentation and examples match the implementation.
- Performance or reliability claims are supported by measurements or clearly labeled as hypotheses.

Separate blockers from non-blocking suggestions and explain why a change is requested. Prefer automated formatters for style. Review security and release/operations references when relevant.

### 6. Complete and report honestly

A change is complete only when applicable acceptance criteria are satisfied, relevant verification has been performed, the final diff has been reviewed, and remaining limitations are disclosed.

Use this completion report for non-trivial work:

- **Implemented:** behavior delivered.
- **Files changed:** paths and purpose.
- **Verification:** exact commands and observed results, including baseline comparison where relevant.
- **Not verified:** checks not run and why.
- **Risks/limitations:** remaining caveats, migrations, TODOs intentionally deferred, or follow-up decisions.

Never fabricate test output, review approval, security status, benchmark data, deployment success, or file inspection. Do not call a task complete if required work remains unfinished.

## Language and framework adaptation

Determine versions and tooling from the repository, then consult current official documentation. Use ecosystem-native formatting, linting, static analysis, type checking, testing, packaging, and dependency tools. Verify commands for the actual operating system and package manager.

Examples (adapt, do not apply mechanically):

- **TypeScript/JavaScript:** validate runtime input despite static types; handle rejected promises; protect server/client boundaries and secrets; use and commit the appropriate lockfile.
- **Python:** use a reproducible environment/dependency strategy; manage resources explicitly; validate external data; avoid unsafe deserialization and shell construction.
- **Java/Kotlin/C#:** make nullability, resource lifetimes, transaction boundaries, and exception handling explicit; use supported platform security APIs.
- **Go/Rust/C/C++:** handle ownership and errors deliberately; use race, memory, and undefined-behavior tooling where available; document invariants around unsafe operations.
- **SQL/data systems:** parameterize queries, use least-privilege roles, version migrations, inspect query plans, and verify backup restoration where risk warrants.
- **Infrastructure as code:** review plans, protect state, limit identity permissions, manage secrets, detect drift, and stage risky changes.

## Quick completion checklist

- [ ] Project instructions, relevant code, Git state, and baseline understood.
- [ ] Acceptance criteria and edge/failure cases identified.
- [ ] Focused implementation follows project conventions.
- [ ] Relevant tests/checks run and compared with baseline.
- [ ] Final diff reviewed for correctness, security, scope, and accidental changes.
- [ ] Documentation/configuration updated where needed.
- [ ] Unverified checks, risks, and incomplete work disclosed.

## On-demand references

- Read [`references/security.md`](references/security.md) when handling authentication, authorization, untrusted input, sensitive data, cryptography, dependencies, CI permissions, or software supply-chain risk.
- Read [`references/release-operations.md`](references/release-operations.md) when changing build/release pipelines, infrastructure, deployment, observability, reliability, backup/restore, or production operations.
- Read [`references/sources.md`](references/sources.md) when a decision needs research evidence, standards, authoritative guidance, or further reading. The catalogue distinguishes peer-reviewed studies, preprints, standards, and practitioner material.
