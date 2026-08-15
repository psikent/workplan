# 04 — Server: env-config routes + app wiring + v1 compatibility

Status: resolved
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

## Comments

- Implemented `apps/server/src/routes/env-config.ts` with Administrator-only export, file download, validation and import endpoints. Request/response contracts use the shared Zod schemas; the nested `package` stays `z.unknown()` so both v2 packages and legacy v1 field templates reach the compatibility parser.
- Wired one `EnvConfigService` through `buildApp`, registered the routes, and exposed the existing `ownerAccounts` plus `envConfig` services from the application fixture. Existing service tests now exercise that real application wiring.
- Added HTTP coverage for all four endpoints' 401/403/200 authorization matrix, dated attachment headers/content, v1 validate/import, stable `VALIDATION_ERROR` problem details, and Sync Import section/confirmation forwarding.
- Verification: env-config suite 23/23 green; server suite 53/53 green; workspace typecheck green; workspace tests green (server 53, web 77, runtime scripts 3); server build green.
