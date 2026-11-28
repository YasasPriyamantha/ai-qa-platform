# Release report: v1

Project: release-demo · Previous release: none (first release) · Generated: 2026-11-28T15:52:04.057Z

## Result

**FAIL**: 0 regression(s), 0 pending review(s), latest run failed.

## Runs

| Run | Release | Run ID | Finished | Run status | Report | Clean |
|---|---|---|---|---|---|---|
| Latest | v1 | 2026-11-28T15-51-44-387Z | 2026-11-28T15:51:51.139Z | failed | complete | yes |

No baseline: this release has no previous release.

## Tests

| Test | Scenario | Baseline | Latest | Classification |
|---|---|---|---|---|
| SCN-0001.spec.ts > SCN-0001: Display the login form | SCN-0001 | - | failed | new |
| SCN-0002.spec.ts > SCN-0002: Sign in with the demo account | SCN-0002 | - | failed | new |
| SCN-0003.spec.ts > SCN-0003: Prevent login when the username is empty | SCN-0003 | - | failed | new |
| SCN-0004.spec.ts > SCN-0004: Prevent login when the password is empty | SCN-0004 | - | failed | new |
| SCN-0005.spec.ts > SCN-0005: Prevent login with an incorrect password | SCN-0005 | - | failed | new |
| SCN-0009.spec.ts > SCN-0009: Display the predefined task titles | SCN-0009 | - | failed | new |
| SCN-0010.spec.ts > SCN-0010: Add a task with a non-empty title | SCN-0010 | - | failed | new |
| SCN-0011.spec.ts > SCN-0011: Submit an empty task title | SCN-0011 | - | failed | new |
| smoke.spec.ts > login page shows the sign-in heading | none | - | failed | new |

## Requirement changes

| Requirement | Classification | Content version | Review |
|---|---|---|---|
| DEMO-001 | new | - → 1 | - |
| DEMO-002 | new | - → 1 | - |
| DEMO-003 | new | - → 1 | - |
| DEMO-004 | new | - → 1 | - |

Unchanged requirements: 0

## Pending reviews

None.

## Needs tests

None.
