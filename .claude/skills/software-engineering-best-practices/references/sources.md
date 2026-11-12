# Research and Source Catalogue

This catalogue supports the engineering principles in `../SKILL.md`. It is intentionally separate so agents do not spend context loading a bibliography on every coding task. Consult it when a design decision needs evidence, when writing engineering policy, or when checking whether a practice is supported.

## How to interpret the evidence

- **Peer-reviewed empirical research / systematic mapping:** stronger basis for understanding what has been studied, but findings remain bounded by methods, samples, context, and replication.
- **Preprint:** useful preliminary work, not peer-reviewed evidence unless separately published and verified.
- **Standards and authoritative frameworks:** provide agreed requirements, controls, or vocabulary; they do not automatically prove that a particular implementation is secure or effective.
- **Engineering books, official guidance, and practitioner articles:** valuable accumulated experience and operational lessons; consider organizational context before generalizing.

Do not convert a study result into a universal rule. Verify the current version of living standards and documentation before using them for compliance or implementation.

## 1. Peer-reviewed research and empirical studies

1. **Montgomery, Fucci, Bouraffa, Scholz, Maalej et al. (2022), “Empirical research on requirements quality: a systematic mapping study,” *Requirements Engineering*, 27, 183–209.** A systematic mapping study that screened 6,905 articles and analyzed 105 primary studies. Recurring quality attributes include ambiguity, completeness, consistency, and correctness. It is a map of the research landscape, not a proof that one requirements method always works. Published 15 February 2022. [Springer article](https://link.springer.com/article/10.1007/s00766-021-00367-z) · [DOI](https://doi.org/10.1007/s00766-021-00367-z).

2. **Ribeiro, Dos Santos, and Travassos (2023), “On the Investigation of Empirical Contradictions – Aggregated Results of Local Studies on Readability and Comprehensibility of Source Code,” *Empirical Software Engineering*.** Aggregates three local studies of source-code readability/comprehensibility. In these studies, comments and identifier length had positive effects, while indentation spacing and code size were not statistically significant; the authors note that the tested factors and participant stratification were insufficient to explain contradictions in prior literature. Do not turn the result into a simplistic rule such as “more comments are always better.” Published 9 November 2023. [Springer article](https://link.springer.com/article/10.1007/s10664-023-10360-5) · [Study dataset](https://zenodo.org/records/7559406).

3. **Katole (2026), “An Empirical Comparison of Monolithic and Microservices Architectures for an E-Commerce Application,” arXiv:2608.15668.** A single-application e-commerce experiment using a shared PostgreSQL database and tested workloads. It reports different behavior at the tested concurrency levels and distinct failure modes. This is a preprint and a narrow deployment context; it is not general evidence that microservices outperform monoliths. [arXiv record](https://arxiv.org/abs/2608.15668).

**Interpretation note:** The first two sources support careful requirements definition and context-sensitive readability practices. The third should only be used to illustrate that architecture trade-offs are empirical and workload-dependent.

## 2. Standards, security bodies, and authoritative knowledge bases

4. **NIST SP 800-218, Secure Software Development Framework (SSDF) v1.1 (final, 3 February 2022).** Integrates high-level secure development practices into different SDLC models. It remains the final SSDF 1.1 publication on NIST's publications page at the time this catalogue was reviewed. [NIST publication](https://csrc.nist.gov/pubs/sp/800/218/final).

5. **NIST SP 800-218 Rev. 1 / SSDF v1.2 initial public draft (17 December 2025).** Draft describing proposed updated practices for secure and reliable development, delivery, and improvement. The NIST page lists this as an initial public draft, not a final standard; check its status before relying on it. [NIST draft](https://csrc.nist.gov/pubs/sp/800/218/r1/ipd) · [NIST publication list](https://csrc.nist.gov/Projects/ssdf/publications).

6. **NIST SP 800-218A (final, 26 July 2024), Secure Software Development Practices for Generative AI and Dual-Use Foundation Models.** An SSDF community profile adding AI-specific secure development practices; intended to be used alongside SP 800-218. Particularly relevant to teams developing models or AI systems. [NIST publication](https://csrc.nist.gov/pubs/sp/800/218/a/final).

7. **OWASP Application Security Verification Standard (ASVS) 5.0.0 (stable, 30 May 2025).** A framework of security requirements for designing, developing, and testing web applications and services. Check the current stable release before use. [ASVS overview](https://asvs.owasp.org/) · [Downloads](https://asvs.owasp.org/downloads/).

8. **OWASP Cheat Sheet Series.** Focused, implementation-oriented security guidance for common application security topics. [Official series](https://cheatsheetseries.owasp.org/).

9. **OWASP Secure Coding Practices – Quick Reference Guide.** A practical secure-coding checklist covering input validation, authentication, access control, cryptography, error handling, and communications. [Official guide](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/stable-en/).

10. **MITRE Common Weakness Enumeration (CWE).** A community-developed weakness taxonomy useful for describing classes of software and hardware weakness. CWE 5.0 and Schema 8.0 were announced on 28 October 2026; check schema and integration changes if tools consume CWE data. Do not use any CWE Top 25 list as a complete threat model. [CWE](https://cwe.mitre.org/) · [2026 news](https://cwe.mitre.org/news/archives/news2026.html).

11. **SEI CERT Coding Standards.** Language-specific secure coding rules and recommendations. Select the relevant language and edition. [SEI CERT wiki](https://wiki.sei.cmu.edu/confluence/display/seccode).

12. **SLSA (Supply-chain Levels for Software Artifacts).** A framework for incrementally improving software build integrity and provenance. [Official documentation](https://slsa.dev/).

13. **2026 Minimum Elements for a Software Bill of Materials (SBOM).** Multi-government guidance published in July 2026, updating the earlier 2021 baseline and adding fields such as component hashes and tool/generation context. Use the official document and verify national/regulatory applicability. [Australian Cyber Security Centre publication page](https://www.cyber.gov.au/publication/2026-minimum-elements-for-a-software-bill-of-materials-sbom) · [CISA announcement](https://content.govdelivery.com/accounts/USDHSCISA/bulletins/422a7eb).

14. **ISO/IEC 25010:2023, Systems and software engineering — Systems and software Quality Requirements and Evaluation (SQuaRE) — Product quality model.** A standardized quality-model vocabulary for product/system quality characteristics. Consult the official edition and licensing terms for formal use. [ISO standard page](https://www.iso.org/standard/78176.html).

## 3. Engineering books, official guidance, and practitioner resources

15. **Software Engineering at Google (Google, free online book).** Experience-based guidance on code review, testing, documentation, and maintaining software at scale. It is a useful organizational case, not a universal process specification. [Online book](https://abseil.io/resources/swe-book).

16. **Google Engineering Practices.** Public code-review guidance for authors and reviewers. Useful for designing focused, constructive reviews. [Official guide](https://google.github.io/eng-practices/).

17. **Google SRE Books.** In-depth material on service reliability, monitoring, alerting, incident response, and SLOs. Apply according to service criticality. [SRE books](https://sre.google/books/).

18. **DORA Research — State of AI-assisted Software Development (2025) and prior State of DevOps research.** Research on software delivery, organizational capabilities, and AI's impact as an amplifier of existing organizational strengths and weaknesses. Interpret delivery metrics as system-level learning signals rather than individual productivity scores. [2025 research](https://dora.dev/research/2025/dora-report/) · [Publications archive](https://dora.dev/research/publications/).

19. **OpenTelemetry documentation.** Vendor-neutral instrumentation and concepts for traces, metrics, and logs. [Official documentation](https://opentelemetry.io/docs/).

20. **Microsoft Azure Well-Architected Framework — Continuous Integration / release engineering.** Guidance for reliable CI and release practices on Azure; adapt the concepts to the target platform. [Microsoft Learn](https://learn.microsoft.com/en-us/azure/well-architected/design-guides/release-engineering-continuous-integration).

21. **Atlassian — Git branching strategies.** Explains common branching models and trade-offs. Treat the choice as contextual. [Guide](https://www.atlassian.com/agile/software-development/branching).

22. **Atlassian — Code review best practices.** Practitioner guidance on focused review and collaboration. Use alongside actual project/team policy. [Article](https://www.atlassian.com/blog/add-ons/code-review-best-practices).

23. **The Twelve-Factor App.** A historically influential set of service-application practices for configuration, deployment, backing services, and process design. Apply selectively in modern environments. [Twelve-Factor](https://12factor.net/).

24. **Better Scientific Software — Coding Conventions.** Explains the role of consistent conventions in readability and collaborative maintenance, especially in scientific software. [Article](https://bssw.io/blog_posts/coding-conventions).

## 4. How to use the catalogue

- Start with applicable law, domain rules, and project requirements.
- For secure development, begin with NIST SSDF and relevant OWASP/CWE/SEI material; use ASVS when defining or verifying web-application security requirements.
- For source-level implementation, consult official language, framework, database, and cloud documentation for the exact versions in use.
- For code review and collaboration, compare project practice with Google Engineering Practices and *Software Engineering at Google*.
- For reliability and production operations, consult Google SRE and OpenTelemetry; use DORA research to understand organizational delivery capabilities.
- When reading empirical work, note the study date, setting, sample, measurement, and limitations. A small or single-system study should inform questions, not dictate architecture.
- Re-check links and versions before adopting controls in a regulated, customer-facing, or high-risk environment.

**Catalogue review date:** 12 November 2026. Some standards and web resources evolve continuously; a review date does not guarantee a source will remain current indefinitely.
