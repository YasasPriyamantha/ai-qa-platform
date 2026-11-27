# Release Demo

A small local application used as the platform's second test target (Task Q6, DEC-041 §9).
Plain HTML forms and a dependency-free Node server; no client-side JavaScript.

## Run

```bash
npm run demo:v1     # serves v1/ at http://localhost:4310
```

The server takes the version folder as an argument (`node demo-apps/release-demo/server.mjs v1`),
so a `v2/` folder can be added for release comparison (Phase 7). Signed-in sessions and their
tasks are kept in memory and reset when the server restarts.

## Demo credentials

These are fixed, public demo credentials (not secrets):

| Username | Password |
|---|---|
| `release_tester` | `rt-pass-2026` |

For exploration, set them in the root `.env` as `RELEASE_DEMO_USERNAME` and `RELEASE_DEMO_PASSWORD`
(referenced by the `demo_user` role in `project-data/release-demo/project.config.json`).
