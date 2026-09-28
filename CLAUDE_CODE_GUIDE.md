# Claude Code Guide

Practical instructions for future Claude Code sessions (applies to other AI tools too).

**Before making major architectural changes, inspect the existing implementation and understand dependencies.**
**Prefer small, testable changes over unnecessary rewrites.**
**Never remove working functionality merely to simplify an implementation without documenting the reason.**

Read [AI_DEVELOPMENT_CONTEXT.md](AI_DEVELOPMENT_CONTEXT.md) (rules you must not break) and
[PROJECT_STATUS.md](PROJECT_STATUS.md) first.

## Project initialization

```bash
npm ci
cp .env.example .env
npm run gen-key        # paste into ENCRYPTION_KEY
```

Node ≥ 22.12. No Docker or PostgreSQL needed for development (PGlite).

## Development commands

|                               |                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| API with reload               | `npm run dev` (port from `PORT`, default 3000)                                                                |
| UI with HMR                   | `npm run dev:web` → http://localhost:5173 (set `APP_URL=http://localhost:5173`)                               |
| Fake upstreams                | `npm run upstreams -w backend` (:4010; `ALLOW_PRIVATE_TARGETS=true`)                                          |
| Demo data                     | `npm run seed:demo -w backend -- --upstreams http://127.0.0.1:4010`                                           |
| Trigger drift in the fake API | `curl -X POST localhost:4010/__control -H 'content-type: application/json' -d '{"json":{"body":{"id":"x"}}}'` |

## Testing commands

|                        |                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| All unit + integration | `npm test`                                                                                             |
| One file               | `npx vitest run test/integration/monitoring.test.ts` (from `backend/`)                                 |
| By name                | `npx vitest run -t "gates by tag"` (from `backend/`)                                                   |
| E2E                    | `npm run build && npm run test:e2e` (add `PW_CHANNEL=chrome` if Playwright's Chromium isn't installed) |
| Against PostgreSQL     | `TEST_DATABASE_URL=postgres://… npm test` — **drops schemas**                                          |

## Build commands

`npm run build` (frontend → `frontend/dist`, backend → `backend/dist`), `npm start` runs the build.
Restart the server after rebuilding the frontend (static files are indexed at startup).

## Database & migration commands

1. Edit `backend/src/db/schema.ts`.
2. `npm run db:generate` → review the new SQL in `database/migrations/`.
3. `npm test` (migrations run in every test harness).
4. Update DATABASE.md.
   `npm run db:migrate` applies migrations manually (startup does it too).

## Linting / formatting

`npm run lint` (ESLint + Prettier check) · `npm run format` · `npm run typecheck`.

## Deployment

DEPLOYMENT.md. Docker files are untested locally; CI builds the image.

## Debugging

- API errors return `request_id`; grep logs for `"reqId":"<id>"`.
- `LOG_LEVEL=debug` for more detail. Logs never contain secrets — keep it that way.
- Reproduce probe issues with `POST /api/v1/monitors/test` (dry run) or unit-test the probe against `test/support/upstreams.ts`.
- Scheduler issues: check `monitors.next_run_at`, `enabled`, `SCHEDULER_ENABLED`.
- Outbox: `notification_deliveries` (`status`, `attempts`, `last_error`).

## Adding features

1. Write/extend a test first (unit for pure logic, integration via `createHarness()` + `Client`).
2. Implement in services/probes; keep routes thin.
3. Run `npm run typecheck && npm run lint && npm test`; E2E if UI changed.
4. Update docs (API_DOCUMENTATION, USER_GUIDE, DATABASE as relevant), CHANGELOG, PROJECT_STATUS.

## Adding API endpoints

- Add to the relevant `backend/src/routes/*.ts`: `config: { role: 'viewer' | 'editor' | 'admin' }`,
  `schema: { params, querystring, body (additionalProperties: false), response: { 200: …, ...errors(…) } }`.
- Response schema is mandatory (it is the serialization whitelist).
- `npm run openapi`; add an integration test incl. authz (401/403) cases.

## Adding database models

Schema → `db:generate` → service functions → routes → tests → DATABASE.md. Use `timestamptz`,
UUID ids, cascade/set-null deliberately, and indexes for every list/filter query.

## Adding integrations

- New monitor kind: see DEVELOPER_GUIDE.md "Adding things". Add a protocol-faithful fixture to
  `test/support/upstreams.ts` and integration tests; mark in docs that real-provider behaviour
  is unverified until tested with real credentials.
- New notification channel: enum + migration, formatter in `send()`, UI, tests with the `/hook` sink.
- Always use `outboundRequest`; store credentials encrypted; never return them.

## Changing UI

- Styles are plain CSS with tokens in `frontend/src/styles.css` (`:root` and `[data-theme='dark']`).
- Use `Field` (auto label association), `ErrorNote`, `Empty`, `Loading`, `useConfirm`, `useToast` from `components/ui.tsx`.
- Every data view needs loading, empty and error states. Destructive actions use `useConfirm`.
- Check mobile (375 px) for horizontal overflow; E2E has a `@mobile` test.
- `api.ts` types mirror the OpenAPI response schemas — update both.

## Updating documentation

Docs must describe the actual implementation. When you change behaviour, update: the relevant
guide, API_DOCUMENTATION.md / `npm run openapi`, CHANGELOG.md (Unreleased section), and
PROJECT_STATUS.md. Never mark something tested unless you ran the test.
