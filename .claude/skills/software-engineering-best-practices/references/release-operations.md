# Release, Reliability, and Operations Reference

Read this file when changing CI/CD, infrastructure, deployment workflows, runtime configuration, production reliability, observability, incident response, backups, or operational processes.

Apply the controls that match the system's availability needs, release cadence, team size, customer commitments, and failure impact. A small internal tool does not need the operational machinery of a regulated, high-availability service.

## 1. Version control and change integration

- Keep changes focused and reviewable. Integrate frequently enough to reduce long-lived divergence and integration risk.
- Choose trunk-based development, GitHub flow, Gitflow, release branches, or another model based on release cadence, maintenance branches, team topology, and compliance needs. No single branching strategy is universally best.
- Protect important branches with proportionate review and required checks. Restrict force-push and deletion where appropriate.
- Keep commits and pull requests understandable; separate mechanical refactors from behavior changes when that improves review.
- Never overwrite another person's uncommitted changes or use destructive Git operations without explicit authorization and a verified recovery path.

## 2. Continuous integration

A useful CI pipeline provides fast, trustworthy feedback. Depending on the project, consider:

- Reproducible dependency installation using the committed lockfile and supported runtime/tool versions.
- Formatting/lint checks, type checks, static analysis, unit and integration tests, build/package checks, migration validation, and security scans.
- Protected access to secrets and deployment credentials; least privilege for jobs and runners.
- Isolation of untrusted pull-request code from privileged jobs. Treat caches, artifacts, and workflow definitions as supply-chain assets.
- Clear, actionable failure output and ownership for flaky or failing checks.
- Parity between tested and released configuration where practical; document justified differences.

Do not make CI green by silently skipping, weakening, or suppressing a meaningful check. If a check is unreliable, fix or quarantine it transparently with a reason, owner, and removal condition.

## 3. Build and artifact integrity

- Make builds reproducible or traceable to an exact source revision, dependency set, toolchain, and configuration.
- Store artifacts in controlled registries with access policy and retention appropriate to the product.
- Sign and verify artifacts/provenance when risk, customer, or regulatory needs justify it.
- Maintain SBOMs and dependency records when useful for vulnerability response, procurement, or compliance. Use current SBOM guidance, not stale templates.
- Keep release credentials outside source code and avoid exposing secrets to untrusted jobs.

## 4. Deployment and database changes

- Define a rollout plan, health verification, ownership, and rollback/roll-forward strategy for production-impacting changes.
- Use canary, rolling, blue/green, feature flags, or staged release when the risk and platform warrant it. These are tools, not mandatory ceremony.
- For schemas and data migrations, consider compatibility across simultaneously running versions. Use expand-and-contract patterns when old and new code must coexist.
- Make migrations observable and tested against representative data where possible. Back up or define recovery steps before irreversible data changes.
- Treat rollback carefully: code rollback may not reverse a schema or data migration. Prefer explicit forward recovery plans when reversal is unsafe.
- Define feature-flag ownership, expiration/removal, and safe defaults. Flags left indefinitely create hidden state and operational complexity.

## 5. Observability and reliability

- Monitor user-relevant behavior: availability, latency, correctness, throughput, saturation, and meaningful business outcomes.
- Use structured logs, metrics, and distributed traces when they materially improve diagnosis. Propagate correlation/trace IDs across boundaries without including secrets or personal data.
- Ensure health/readiness checks represent the component's ability to serve traffic, not merely that a process exists.
- Set actionable alerts with clear ownership and runbooks. Avoid alerts that are noisy or do not prompt an action.
- Define timeouts, bounded retries, jitter, circuit breaking, bulkheads, backpressure, and graceful degradation where failure modes justify them.
- Make operations idempotent where practical; do not blindly retry non-idempotent side effects.
- For critical services, define service-level indicators/objectives, error budgets, recovery time and recovery point objectives, capacity assumptions, and resilience tests.

## 6. Backup, recovery, and incidents

- Identify what must be backed up, how often, retention requirements, encryption, access controls, and off-site/independent copies.
- Test restoration, not just backup creation. Document dependencies and recovery order.
- Define incident roles, escalation paths, communication requirements, and evidence-preservation needs appropriate to the service.
- Conduct blameless reviews that identify contributing system and process factors, concrete corrective actions, owners, and follow-up verification.
- Track recurring incidents, service degradation, flaky tests, release failures, toil, and capacity issues as engineering feedback.

## 7. Operational review prompts

- Can the artifact be traced to reviewed source and dependencies?
- Do checks run in a trustworthy environment with least-privilege credentials?
- Are deployment, migration, rollback, and recovery assumptions explicit?
- Can the team detect and diagnose user-visible failures?
- Are alerts actionable and owned?
- Have backups actually been restored in a test?
- Does the operational design match the product's real risk and service commitments?

## 8. Further guidance

- [Google SRE Books](https://sre.google/books/) — monitoring, SLOs, incident response, and reliability engineering.
- [DORA Research](https://dora.dev/research/) — software delivery, organizational capabilities, and AI-assisted development research. Interpret measures at the system/team level, not as individual productivity scores.
- [OpenTelemetry documentation](https://opentelemetry.io/docs/) — vendor-neutral instrumentation for traces, metrics, and logs.
- [SLSA](https://slsa.dev/) — build integrity and provenance.
- [Microsoft Well-Architected release engineering](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/release-engineering-continuous-integration) — CI and release engineering guidance.
- [2026 SBOM Minimum Elements](https://www.cyber.gov.au/publication/2026-minimum-elements-for-a-software-bill-of-materials-sbom) — current multi-government supply-chain inventory guidance.
