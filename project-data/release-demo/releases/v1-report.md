# Release report: v1

Project: release-demo · Previous release: none (first release) · Generated: 2026-11-28T16:04:47.161Z

## Result

**PASS**: 0 regression(s), 0 pending review(s), latest run passed.

## Runs

| Run | Release | Run ID | Finished | Run status | Report | Clean |
|---|---|---|---|---|---|---|
| Latest | v1 | 2026-11-28T16-04-22-757Z | 2026-11-28T16:04:27.020Z | passed | complete | yes |

No baseline: this release has no previous release.

## Tests

| Test | Scenario | Baseline | Latest | Classification |
|---|---|---|---|---|
| SCN-0001.spec.ts > SCN-0001: Display the login form | SCN-0001 | - | passed | new |
| SCN-0002.spec.ts > SCN-0002: Sign in with the demo account | SCN-0002 | - | passed | new |
| SCN-0003.spec.ts > SCN-0003: Prevent login when the username is empty | SCN-0003 | - | passed | new |
| SCN-0004.spec.ts > SCN-0004: Prevent login when the password is empty | SCN-0004 | - | passed | new |
| SCN-0005.spec.ts > SCN-0005: Prevent login with an incorrect password | SCN-0005 | - | passed | new |
| SCN-0009.spec.ts > SCN-0009: Display the predefined task titles | SCN-0009 | - | passed | new |
| SCN-0010.spec.ts > SCN-0010: Add a task with a non-empty title | SCN-0010 | - | passed | new |
| SCN-0011.spec.ts > SCN-0011: Submit an empty task title | SCN-0011 | - | passed | new |
| smoke.spec.ts > login page shows the sign-in heading | none | - | passed | new |

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
