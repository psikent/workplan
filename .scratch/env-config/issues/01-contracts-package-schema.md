# 01 — Contracts: Environment Configuration Package schema

Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: packages/contracts

## Task

Add the package schema and types to `packages/contracts/src/index.ts`:

- `envConfigPackageFieldSchema`: `{ key (regex ^[a-z][a-z0-9_]{1,63}$), label, description (max 500, default ""), type: customFieldTypeSchema, required (default false), defaultValue (nullable, default null), options [{value,label}] (max 100, default []), sortOrder? (non-negative int) }`.
- `envConfigPackageSchema`: `{ schemaVersion: literal 2, exportedAt: iso, customFields: max 200, ownerAccountMappings: max 1000, exportTemplates: max 100 }`, reusing `ownerAccountMappingSchema` and `createExportTemplateSchema` for the entries; superRefine rejecting duplicate field `key`s and duplicate template `name`s.
- `envConfigImportModeSchema` / `envConfigSectionSchema`: enums `["additive","sync"]` and `["customFields","ownerAccountMappings","exportTemplates"]` with the same names exported as const arrays.
- `parseEnvConfigPackage(payload)`: returns a typed `EnvConfigPackage` or throws `Error` with a Chinese message (same phrasing style as the rest of the API). Accepts schemaVersion 2, or a legacy schemaVersion 1 document `{ schemaVersion: 1, exportedAt, fields: [...] }` (fields-only, no `sortOrder`) which becomes a package with empty mapping/template sections. The legacy v1 shape is defined locally in this file — no producer ships in this repo.
- Types: `EnvConfigPackage`, `EnvConfigPackageField`, `EnvConfigImportMode`, `EnvConfigSection`.

## Acceptance

- `corepack pnpm --filter @workplan/contracts build` passes; server and web typecheck keep passing.
- No ids, no versions inside package entries — identity is the stable key/name only.
- Duplicate keys/names rejected; v1 legacy documents parse as fields-only packages; unknown schemaVersion throws.

## Comments

- Implemented in commit 2b113a0. Code review (Standards + Spec): 4 of 6 findings fixed — legacy schema renamed away from Template vocabulary, enum type exports use z.infer style, field shape deduplicated onto createCustomFieldSchema, error formatting extracted; mode/sections enums kept (declared in ticket scope, consumed by ticket 02/04). Spec axis: import-plan vocabulary (actions/grades/skip reasons) is out of this ticket's scope — added to ticket 02's task; inherited constraints from createCustomFieldSchema / ownerAccountMappingSchema / createExportTemplateSchema and import-time rules (required_without_default, sortOrder default) accepted as designed. Build + server/web typecheck green.
