# 04 — Server: env-config routes + app wiring + v1 compatibility

Status: open
Blocked by: 02, 03
Spec: ../spec.md
Scope: apps/server/src/routes/env-config.ts (new), apps/server/src/app.ts, apps/server/test/env-config.test.ts (HTTP level)

## Task

- `GET /api/v1/env-config` → package JSON (admin)
- `GET /api/v1/env-config/file` → same JSON, `Content-Disposition: attachment; filename="env-config-<date>.json"` (admin)
- `POST /api/v1/env-config/validate` body `{ package, mode?, sections? }` → plan (admin)
- `POST /api/v1/env-config/import` body `{ package, mode, sections, confirmDestructive }` → result (admin)
- Zod-typed via fastify-type-provider-zod; register in `app.ts`.
- CSRF/origin: inherited from the existing preHandler hook — do not add route-specific checks.

## Acceptance (tests first, HTTP level)

- Unauthenticated → 401; Editor → 403; Administrator → 200.
- v1 template file accepted by validate and import.
- Invalid package → problem details with a stable code.
- Download endpoint sets the attachment headers.
