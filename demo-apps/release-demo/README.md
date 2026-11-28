# Release Demo

A small local application used as the platform's second test target (Task Q6, DEC-041 §9).
Plain HTML forms and a dependency-free Node server; no client-side JavaScript.

## Run

```bash
npm run demo:v1     # serves v1/ at http://localhost:4310
npm run demo:v2     # serves v2/ at http://localhost:4310 (stop V1 first; same port)
```

The server takes the version folder as an argument (`node demo-apps/release-demo/server.mjs v1`).
Per-version behaviour is kept in one settings object (`VERSIONS` in `server.mjs`). Signed-in
sessions and their tasks are kept in memory and reset when the server restarts.

## V2 (Phase 7 release comparison)

V2 implements `project-data/release-demo/docs/requirements-v2.md`:

- the task list starts empty (DEMO-003 retired);
- the empty-title message is `Please enter a task title.` (DEMO-004 changed);
- a `Sign out` button on `/tasks.html` ends the session and goes to `/` (DEMO-005 new).

**Planted regression (fixed in Task R5):** V2 shipped with the empty-password message
`Password is required` (the final period missing), although DEMO-002 is unchanged, so the Phase 7
release report could be shown catching a real regression (DEC-043 §3.8). Task R5 fixed it; the
message is `Password is required.` again.

## Demo credentials

These are fixed, public demo credentials (not secrets):

| Username | Password |
|---|---|
| `release_tester` | `rt-pass-2026` |

For exploration, set them in the root `.env` as `RELEASE_DEMO_USERNAME` and `RELEASE_DEMO_PASSWORD`
(referenced by the `demo_user` role in `project-data/release-demo/project.config.json`).
