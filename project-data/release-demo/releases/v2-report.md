# Release report: v2

Project: release-demo · Previous release: v1 · Generated: 2026-11-28T17:16:13.676Z

## Result

**PASS**: 0 regression(s), 0 pending review(s), latest run passed.

## Runs

| Run | Release | Run ID | Finished | Run status | Report | Clean |
|---|---|---|---|---|---|---|
| Latest | v2 | 2026-11-28T17-15-49-590Z | 2026-11-28T17:15:53.992Z | passed | complete | yes |
| Baseline | v1 | 2026-11-28T16-04-22-757Z | 2026-11-28T16:04:27.020Z | passed | complete | yes |

## Tests

| Test | Scenario | Baseline | Latest | Classification |
|---|---|---|---|---|
| SCN-0001.spec.ts > SCN-0001: Display the login form | SCN-0001 | passed | passed | still passing |
| SCN-0002.spec.ts > SCN-0002: Sign in with the demo account | SCN-0002 | passed | passed | still passing |
| SCN-0003.spec.ts > SCN-0003: Prevent login when the username is empty | SCN-0003 | passed | passed | still passing |
| SCN-0004.spec.ts > SCN-0004: Prevent login when the password is empty | SCN-0004 | passed | passed | still passing |
| SCN-0005.spec.ts > SCN-0005: Prevent login with an incorrect password | SCN-0005 | passed | passed | still passing |
| SCN-0009.spec.ts > SCN-0009: Display the predefined task titles | SCN-0009 | passed | - | retired |
| SCN-0010.spec.ts > SCN-0010: Add a task with a non-empty title | SCN-0010 | passed | passed | still passing |
| SCN-0011.spec.ts > SCN-0011: Submit an empty task title | SCN-0011 | passed | - | retired |
| smoke.spec.ts > login page shows the sign-in heading | none | passed | passed | still passing |
| SCN-0014.spec.ts > SCN-0014: Sign out from the task list | SCN-0014 | - | passed | new |
| SCN-0016.spec.ts > SCN-0016: Do not add a task when the title is empty | SCN-0016 | - | passed | new |

## Requirement changes

| Requirement | Classification | Content version | Review |
|---|---|---|---|
| DEMO-003 | retired | 1 → 2 | reviewed |
| DEMO-004 | changed | 1 → 2 | reviewed |
| DEMO-005 | new | - → 1 | - |

Unchanged requirements: 2

## Pending reviews

None.

## Needs tests

None.
