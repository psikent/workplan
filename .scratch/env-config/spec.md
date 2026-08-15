# Spec: Environment Configuration Package

## Goal

A developer works on several machines; the global definitions that features depend on — Custom Field definitions, Work Owner Account mappings, XLS export templates — drift apart between environments. Provide one versioned JSON package that exports these definitions from one environment and restores or syncs them into another, with clipboard as the primary transport and automatic restore into fresh development environments.

## Terms

See `CONTEXT.md`: **Environment Configuration Package**, **Additive Import**, **Sync Import**, **Destructive Change**.

## Background facts

- There is no definition-migration mechanism at HEAD. An earlier, uncommitted custom-field template feature (schemaVersion 1: fields-only JSON, additive import with skips `key_exists` / `select_without_options` / `required_without_default`) exists on other development nodes; v1 files are accepted as fields-only packages for portability.
- Custom Field definitions have no type-change or physical-delete operation: a field is retired via `archivedAt`; options are retired the same way. Values live in `custom_field_values` / `custom_field_multi_values` keyed by field id and survive archival.
- Work Owner Account mappings are a flat `ownerName → account` table with no attached data.
- XLS export templates are `{ name, sheetName, columns[{ source, header }] }`; `source` may be `custom:<key>` referencing a Custom Field stable key.
- All global-definition write routes are Administrator-only; the web UI enforces CSRF + origin for writes.
- UI baseline: the Settings page hosts 数据导入导出, 负责人账号映射 and Excel 导入导出模板 sections; the old 导出模板/导入模板 buttons live on the Custom Fields page.

## Requirements

### R1 Package format
- A single JSON document, `schemaVersion: 2`, with `exportedAt` (ISO) and three sections:
  - `customFields`: field entries `{ key, label, description, type, required, defaultValue, options: [{ value, label }], sortOrder }` — the v1 field shape plus `sortOrder` (optional, defaults to array position). Active fields and active options only.
  - `ownerAccountMappings`: entries `{ ownerName, account }`.
  - `exportTemplates`: entries `{ name, sheetName, columns: [{ source, header }] }`.
- No local ids anywhere: identity travels as the stable key (`key`, `ownerName`, template `name`); local ids are regenerated on import.
- A v1 custom-field template file is accepted wherever a package is, treated as `{ schemaVersion: 2, customFields: <fields>, ownerAccountMappings: [], exportTemplates: [] }`.

### R2 Export
- `GET /api/v1/env-config` returns the package JSON (for the copy button).
- `GET /api/v1/env-config/file` returns the same JSON as an attachment download.
- Export never includes archived fields/options, values, or any business data.

### R3 Validate
- `POST /api/v1/env-config/validate` with `{ package, mode }` returns an import plan and executes nothing:
  - per-section item actions `create` | `update` | `retire` | `delete` | `skip`
  - grading `safe` | `destructive`; every skip carries a reason code
  - invalid payloads rejected with problem details (existing AppError conventions).

### R4 Additive Import (default)
- Creates definitions whose stable key/name is absent locally; skips existing ones with `key_exists` / `owner_exists` / `template_name_exists`.
- Field-level skip rules: `select_without_options`, `required_without_default` (when Work Plans exist).
- Template skip rule: `missing_field_ref` when a column's `custom:<key>` does not resolve after the field section is applied.

### R5 Sync Import
- Converges the target to match the package. Changes are graded:
  - safe: label/description/defaultValue updates, adding options, applying `sortOrder`, adding new items
  - destructive: retiring a Custom Field or option absent from the package, setting `required`, or a `type_conflict` (package type differs from local)
- Retiring is archival, never physical deletion, for Custom Fields and options. Owner Account mappings and XLS export templates have no attached data and are deleted outright when absent from the package.
- `type_conflict` is reported and skipped; no type migration ever.
- Setting a field `required` requires a non-null default value; otherwise skipped with `required_without_default`.
- Executes in order fields → options → mappings → templates, in one transaction.
- Requires an explicit `confirmDestructive` flag; without it the server rejects any plan containing destructive changes.

### R6 Import granularity
- The plan is per-section; the caller selects which sections to apply (`customFields`, `ownerAccountMappings`, `exportTemplates`). Unselected sections appear in the plan but are not executed.

### R7 Transport & UI
- Settings page gains a 环境配置 section next to 数据导入导出:
  - 复制 to clipboard (pretty-printed JSON) and 下载 as file
  - paste box + 导入 button, plus file upload alternative
  - mode choice: 增量导入 (default) / 同步导入
  - preview from validate: per-section checkboxes (all checked by default), item rows colour-coded by grade (safe / destructive red / skipped with reason)
  - 执行导入 → result summary + toast
- The Custom Fields page keeps definition CRUD only (no template buttons exist at baseline).

### R8 Development auto-restore
- Non-production only. At server startup, when `data/env-config.seed.json` exists, each section is imported additively if and only if its table is empty (`custom_field_definitions`, `owner_account_mappings`, `export_templates`).
- Idempotent; never overwrites existing development data. Failures are logged and non-fatal.

### R9 Seed export command
- `pnpm env-config:export` writes the current environment's package to `data/env-config.seed.json`.

### R10 Authorization and errors
- New endpoints are Administrator-only, inherit the CSRF/origin checks, and return problem details consistent with the rest of the API.

### R11 Testing (per ticket, TDD)
- Server: integration tests for package round-trip, additive skips, sync convergence, archival-not-delete, type conflicts, section selection, v1 compatibility, auto-restore triggers.
- Web: Settings section tests (copy, paste import, preview grading, execute); Custom Fields page tests updated after button removal.

## Out of scope
- Moving Work Plan values between environments (数据导入导出 already exists and stays separate)
- Type changes on existing Custom Fields; migrating values on type conflicts
- Auth/users/tokens, recurrence rules
- Physical deletion of Custom Fields or options
