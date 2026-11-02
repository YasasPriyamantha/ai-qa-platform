---
name: reliable-ai-coding
description: Use when planning, implementing, debugging, refactoring, testing, or reviewing software with an AI coding agent. Improve reliability and maintainability through repository-aware context, explicit acceptance criteria, small changes, and evidence-based verification.
---

# Reliable AI Coding

## Objective

Deliver the smallest maintainable change that satisfies the actual requirement and is verified as far as the available environment permits. Reduce avoidable errors, hallucinated APIs, regressions, and unnecessary code. No prompt or skill guarantees bug-free software.

## Default rules

1. **Inspect before assuming.** Use repository instructions, actual files, installed versions, nearby tests, and observed logs. Do not invent files, APIs, dependencies, commands, or project conventions.
2. **Specify observable behavior.** For non-trivial work, define acceptance criteria and relevant failure/edge cases before implementation.
3. **Provide relevant context, not prompt theater.** Be direct and readable. Avoid generic role-play, repetitive warnings, elaborate reasoning rituals, and huge universal prompts. Add structure or examples only when useful for the task.
4. **Prefer the smallest correct change.** Fix root causes, follow existing architecture, reuse appropriate helpers, and avoid unrelated refactors, speculative abstractions, dead code, unnecessary dependencies, and comments that merely narrate code.
5. **Verify independently.** Use tests and deterministic tools where available. A plausible explanation, successful compilation, or AI review is not proof that behavior is correct.
6. **Preserve user work and control side effects.** Check the working tree before editing. Do not discard unrelated changes, expose secrets, run destructive commands, commit, deploy, or perform irreversible operations without authorization.
7. **Report uncertainty honestly.** Never claim a command or test passed unless it was run and its result observed. Separate implemented behavior from verified behavior and call out blockers.

## Workflow

### 1. Scale the process to risk

- **Small, low-risk task:** inspect the relevant location, make the focused change, run a proportionate check, and summarize it. Do not force a planning ceremony.
- **Multi-file, ambiguous, high-impact, or architectural task:** inspect first, create a short plan, define acceptance criteria and a verification strategy, then implement.
- Ask a question only when a genuine blocker prevents a safe/correct choice. Otherwise use a conservative, conventional assumption and state it.

### 2. Inspect the project context

Before editing, as relevant:

- Identify the project root, language/framework, package manager, and real dependency versions.
- Read applicable `AGENTS.md`, `CLAUDE.md`, or other project instructions, plus the relevant manifest, implementation, tests, and nearby examples.
- Inspect `git status` and existing diffs; preserve changes that pre-date this task.
- Search for existing helpers, patterns, API clients, validators, fixtures, and similar features before creating new ones.
- Read architecture/database/API/deployment documentation only when relevant. Do not load the entire repository by default.
- Verify uncertain API or version details using installed source, lockfiles, tests, or authoritative documentation.

### 3. Define the contract for meaningful changes

Write a concise checklist covering what matters:

- **Goal and current behavior:** the desired result and observed problem/context.
- **Requirements:** observable outcomes, interfaces, inputs, outputs, and state transitions.
- **Edge/failure cases:** invalid or empty input, permission failures, timeouts, duplicates, concurrency, or other relevant risks.
- **Constraints/non-goals:** compatibility, architecture, data/security boundaries, and what must not change.
- **Verification:** tests or commands that would demonstrate the requirements are met.

Use `Given / When / Then` when it clarifies behavior. Translate vague words such as “robust,” “clean,” and “optimized” into observable criteria. Keep the spec proportionate to the task.

### 4. Implement a focused, maintainable fix

- Follow local naming, formatting, module boundaries, and error-handling conventions.
- Fix the cause, not just the symptom. Update related interfaces and call sites instead of editing only the most obvious file.
- Prefer clear names, straightforward control flow, explicit types, cohesive functions, and existing helpers where appropriate.
- Avoid unneeded abstractions, duplicated logic, broad refactors, unsafe type casts, unnecessary `any`, and new dependencies without a clear reason.
- Do not add broad `try/catch` blocks, empty catches, silent fallbacks, or success-shaped responses that conceal failures. Surface errors using established application patterns.
- Validate untrusted input at boundaries and enforce authorization server-side; UI-only checks are not a security boundary.
- Add comments for rationale or non-obvious invariants, not to restate each line.
- Consider compatibility, data migrations, tests, documentation, configuration, monitoring, and rollback where the change warrants it.

### 5. Verify using executable evidence

Choose checks appropriate to the project and risk:

1. Run a focused feature or regression test. For a bug, reproduce the failure when feasible and add a test that would catch its return.
2. Run related unit/integration/end-to-end tests as appropriate.
3. Run available type-check, lint, format, build, or security checks according to project conventions.
4. Expand the test scope when changes cross shared boundaries or carry higher risk.

Use actual package scripts and commands; do not assume they exist. Read complete failure output. If a check fails, address the root cause and rerun the failed check plus affected neighboring tests. Do not make a suite green by deleting, skipping, or weakening meaningful assertions merely to match the implementation. Passing tests support only the behavior they cover.

If a service, credential, browser, dependency, or network limitation prevents a check, report precisely what was and was not verified. Never fabricate results.

### 6. Review the complete diff

Before finishing:

- Inspect all changed files, including the full diff.
- Map each acceptance criterion to code and/or test evidence.
- Look for unrelated edits, missing wiring, duplication, unused code, swallowed errors, weak validation, authorization gaps, data-loss risks, and compatibility breaks.
- Check that tests would fail if the original bug or requirement violation returned.
- Treat AI reviewer comments as hypotheses, not proof. Ask for concrete code/line and requirement evidence; verify claims independently. LLM reviewers can falsely reject correct implementations or approve flawed ones.

### 7. Report completion audibly

Use a proportionate summary:

- **Changed:** behavior and files.
- **Why:** how the change addresses the requirement/root cause.
- **Verification:** exact commands and observed results.
- **Not verified / risks:** checks blocked by the environment, assumptions, or remaining uncertainty.

Clearly distinguish implemented from verified. Do not state “fully tested” unless that description is genuinely supported.

## Prompt structure for non-trivial tasks

Use this compact structure as appropriate; skip irrelevant sections for small tasks:

```text
Goal
[Observable outcome]

Context
[Observed behavior, relevant files, versions, logs, existing patterns]

Requirements / acceptance criteria
- [Testable criterion]
- [Relevant failure or edge case]

Constraints / non-goals
- Preserve: [existing behavior, interface, data, architecture]
- Follow: [project conventions]
- Avoid: [unrelated refactors, unauthorized actions]

Verification
[Relevant tests and available type-check/lint/build/security checks]

Inspect first, implement the smallest root-cause change, run available checks, review the full diff, and report exact results. Do not invent APIs or claim checks passed unless they were run. State significant assumptions or blockers.
```

## Task-specific templates and evidence

Load `assets/prompt-templates.md` when a ready-to-copy prompt for a feature, bug, refactor, code review, test design, or skill evaluation is useful. Load `assets/evaluation-cases.md` when changing or assessing this skill. Consult `references/research-and-resources.md` for the research papers, source links, and the limits of the evidence; do not load it for every routine code change.

## Avoid universal prompting recipes

Do not assume long prompts, chain-of-thought requests, few-shot examples, multiple agents, or AI self-review are always better. Use the least complicated instructions that preserve necessary behavior. Ask for a concise plan, assumptions, acceptance criteria, and verification evidence—not hidden reasoning transcripts. Optimize for verified task outcomes, not for prompt length alone.
