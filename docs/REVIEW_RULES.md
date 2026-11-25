# Review Rules

These rules are for anyone writing task prompts or reviewing a coding agent's work on this project: Claude, ChatGPT, or you. They exist to stop the endless correction cycles of Task 3.3a. `AGENTS.md` holds the matching rules for the coding agent.

## Before a task starts

1. **Every task names the capability it delivers.** "After this task, the user can …". If nothing can be named, the task waits until a feature needs it.
2. **At most about six acceptance criteria, one concern per task.** If a task needs more, split it.
3. **Every criterion is observable.** A command, a test name or a file you can open. No "robust", "complete" or "production-ready".
4. **List what is out of scope.** It's the cheapest protection against scope creep.
5. **Give a size budget.** For example, "about 800 source lines". The agent stops and asks if it would exceed it.
6. **No infrastructure for imagined futures.** New code needs a production caller in this task or the next listed task (DEC-039).

## Reviewing a report

7. **Review the code, not only the report.** Read the diff on GitHub or in the repository. A report saying something is done is not evidence.
8. **Check only the frozen acceptance criteria.** Don't add new requirements during review.
9. **Label every finding:**
   - **BLOCKING:** an acceptance criterion is not met, a security problem, data loss, a broken or skipped test, or a regression.
   - **LATER:** a real issue that doesn't block this task. Record it as one line in `IMPLEMENTATION_PLAN.md` under the task's known limitations, with the point by which it must be fixed.
   - **NIT:** a style preference. Don't act on it.
   Only BLOCKING findings trigger a correction prompt.
10. **One correction round per task.** If the second report still fails a criterion, stop. Read the code to find the root cause before writing another prompt, or accept the task with the limitation recorded. Never a third broad correction round.
11. **Correction prompts list only the failed criteria**, each with the file and line where it fails.

## After a task

12. **Commit when the criteria are met.** Don't look for extra improvements.
13. **Update status in one place.** Only `IMPLEMENTATION_PLAN.md`; README and AGENTS carry a one-line status that points to it.
