# 05 — Server: development auto-restore from seed file

Status: resolved
Blocked by: 02
Spec: ../spec.md
Scope: apps/server/src/app.ts (or server entry), apps/server/test/env-config.test.ts

## Task

In `buildApp`, after services are constructed and before listen: when NOT production AND `data/env-config.seed.json` exists, read it and additive-import each section whose table is empty:

- `custom_field_definitions` empty → import `customFields`
- `owner_account_mappings` empty → import `ownerAccountMappings`
- `export_templates` empty → import `exportTemplates`

Rules: additive only (never sync), never overwrite non-empty tables, idempotent, failures logged via `app.log.warn` and never fatal.

## Acceptance (tests first)

- buildApp with temp DB + seed fixture: all three tables populated after startup.
- Non-empty section untouched while empty sections are imported.
- Missing seed file → no-op.
- Production config → never imports, even with seed present.
- Malformed seed → server still starts; nothing imported.

## Comments

- Implemented development auto-restore in `buildApp` immediately after `EnvConfigService` construction and before route registration/listen. The seed path is `path.join(config.dataDir, "env-config.seed.json")`, and production bypasses the restore entirely.
- Each section is selected only when its physical table has no rows (`custom_field_definitions`, `owner_account_mappings`, `export_templates`). All selected sections are passed to one `importAdditive` call, preserving its single-transaction behavior and never supplementing a non-empty section.
- Missing files are a no-op. File, JSON/schema, and import failures are caught, logged with `app.log.warn`, and never prevent startup. Repeated development startups are idempotent.
- Added six startup-boundary tests covering all-three-section restore, mixed empty/non-empty sections, production bypass, malformed and missing seeds, and repeated startup. Test data directories are isolated per context so an external or stale seed cannot contaminate the suite.
- Migration v6 pre-populates Work Owner Account mappings, so an untouched fresh database correctly treats that table as non-empty under this ticket's literal rule. The all-three-section test clears those migration rows before exercising restore.
- Verification: env-config suite 29/29 green; server suite 59/59 green; server and workspace typecheck green; workspace tests green (server 59, web 77, runtime scripts 3). Independent Standards + Spec review: 0 findings.
