# Security Engineering Reference

Read this file when changing authentication, authorization, sessions, input handling, data storage, sensitive information, cryptography, dependencies, CI/CD permissions, build systems, or software supply-chain controls.

This is a practical starting point, not a certification or proof that a system is secure. Choose controls according to threat model, data sensitivity, exposure, regulatory obligations, and failure impact. Consult current official documentation and specialists for high-risk systems.

## 1. Threat modelling and security requirements

- Identify valuable assets: accounts, personal data, payment/financial data, business records, credentials, signing keys, infrastructure, and availability.
- Map trust boundaries, entry points, data flows, privileged components, and third-party integrations.
- Consider relevant threat actors, abuse cases, attacker capabilities, and likely impact. Use a lightweight model for ordinary changes; use a documented method such as STRIDE when useful.
- State security requirements as testable outcomes: who can access which resource, under what conditions, and what should happen on denial or failure.
- Revisit the threat model when architecture, data sensitivity, exposure, or dependencies materially change.

## 2. Identity, authentication, and authorization

- Authenticate identities using established, maintained protocols and libraries. Do not design custom authentication or cryptographic protocols.
- Authorize every sensitive action and resource access at the trusted server/service boundary. A hidden UI control is not authorization.
- Enforce least privilege for users, services, database roles, cloud identities, CI jobs, and automation tokens.
- Check object-level and tenant-level access on every relevant request; do not rely only on role names or client-supplied IDs.
- Use secure session/token lifetimes, rotation, revocation, and storage appropriate to the threat model. Avoid putting bearer tokens in URLs.
- For browser sessions, configure cookies and CSRF protection appropriately; use TLS and safe CORS rules. CORS is not an authorization mechanism.
- Use MFA and step-up verification where the account or transaction risk justifies them.

## 3. Input, output, and data handling

- Treat requests, query parameters, headers, files, environment variables, messages, webhooks, network responses, and persisted records as untrusted until validated.
- Validate type, size, format, range, encoding, and domain constraints at trust boundaries. Use allowlists where practical.
- Use parameterized database queries and safe ORM APIs. Do not concatenate untrusted values into SQL, shell commands, LDAP filters, or other interpreters.
- Encode output for its destination context. Avoid unsafe HTML/DOM injection; sanitize rich HTML with a maintained allowlist sanitizer when HTML is a requirement.
- Protect against relevant classes such as injection, XSS, CSRF, SSRF, path traversal, insecure deserialization, request smuggling, open redirects, replay, and resource exhaustion.
- Apply upload limits, content/type checks, safe storage names, malware scanning where required, and isolation from executable/public paths.
- Minimize collection, access, retention, and logging of personal or regulated data. Define deletion, export, audit, and breach-response needs where applicable.

## 4. Secrets and cryptography

- Keep credentials, API keys, tokens, certificates, and private keys out of source control, prompts, client bundles, logs, screenshots, and build artifacts.
- Use a secrets manager or platform-provided secret facility; scope access narrowly and rotate exposed credentials promptly.
- Use maintained cryptographic libraries and safe defaults. Do not invent encryption, password hashing, random number generation, or token formats.
- Store passwords with an appropriate password-hashing algorithm and current parameters for the platform; never use reversible encryption or fast general-purpose hashes for password storage.
- Use TLS with certificate verification. Do not disable verification to work around environment issues.
- Consider key rotation, separation of duties, backup recovery, and cryptographic agility for systems with long-lived sensitive data.

## 5. Dependency and supply-chain security

- Use trusted package registries and pin or constrain dependencies according to ecosystem policy; commit lockfiles for reproducible application builds where appropriate.
- Review new dependencies for maintenance activity, ownership, provenance, license, transitive dependencies, permissions, and known vulnerabilities.
- Monitor advisories and prioritize fixes by exploitability, exposure, reachability, and impact—not severity score alone.
- Use automated dependency, secret, static-analysis, and container scans where they provide meaningful coverage. Triage findings; do not treat a green scanner as proof of security.
- Restrict CI permissions and untrusted pull-request access to secrets. Protect release credentials, signing keys, runners, caches, and deployment environments.
- Generate and consume an SBOM when customer, regulatory, risk, or operational needs justify it. Use the current 2026 SBOM minimum-elements guidance as the updated baseline where applicable; see `sources.md`.
- Verify artifact provenance/signatures and adopt SLSA practices incrementally when the threat model and release process warrant them.

## 6. Logging, errors, and abuse resistance

- Log security-relevant events with enough context for investigation, but never log passwords, bearer tokens, private keys, or unnecessary personal data.
- Return generic safe errors to clients; preserve detailed diagnostics in protected logs.
- Rate-limit and throttle sensitive or expensive operations. Use quotas, timeouts, request-size limits, concurrency bounds, and backpressure where needed.
- Make retries bounded and safe for idempotency; avoid retry storms and amplification.
- Alert on actionable signals such as unusual authentication failures, privilege changes, suspicious access, and repeated abuse. Assign ownership and response procedures.

## 7. Verification checklist

For the changed area, ask:

- [ ] What assets and trust boundaries are affected?
- [ ] Can a lower-privilege or cross-tenant user access the resource or trigger the action?
- [ ] Are all untrusted inputs validated and safely interpreted?
- [ ] Can secrets or sensitive records escape through responses, logs, artifacts, URLs, or client bundles?
- [ ] Are authentication, authorization, session, and cryptographic controls using maintained platform mechanisms?
- [ ] Can uploads, requests, retries, or concurrency exhaust resources?
- [ ] Have dependency, build, CI, and deployment permissions been considered?
- [ ] Are security-relevant failures logged and actionable without leaking sensitive data?
- [ ] Were relevant tests/scans actually run, and are their limitations reported?

## 8. Authoritative starting points

- [NIST SP 800-218 SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) — final version 1.1 (2022); integrate secure development practices into the SDLC.
- [NIST SP 800-218 Rev. 1 / SSDF 1.2 initial public draft](https://csrc.nist.gov/pubs/sp/800/218/r1/ipd) — draft published 17 December 2025; do not describe it as final unless NIST updates its status.
- [NIST SP 800-218A](https://csrc.nist.gov/pubs/sp/800/218/a/final) — final 2024 SSDF community profile for generative AI and dual-use foundation model development.
- [OWASP ASVS](https://asvs.owasp.org/) — use stable version 5.0.0 (published 30 May 2025) for web-application security requirements; verify the current stable release before adopting it.
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/) — focused implementation guidance.
- [OWASP Secure Coding Practices Quick Reference Guide](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/stable-en/) — secure coding checklist.
- [MITRE CWE](https://cwe.mitre.org/) — weakness taxonomy; consult current CWE version and relevant weakness entries rather than treating a top-25 list as exhaustive.
- [SEI CERT Coding Standards](https://wiki.sei.cmu.edu/confluence/display/seccode) — language-specific secure coding rules.
- [SLSA](https://slsa.dev/) — software artifact supply-chain security framework.
- [2026 Minimum Elements for a Software Bill of Materials](https://www.cyber.gov.au/publication/2026-minimum-elements-for-a-software-bill-of-materials-sbom) — updated multi-government guidance published in 2026.
