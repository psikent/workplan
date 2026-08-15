# 02 — Server: EnvConfigService — export, validate, Additive Import

Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/server/src/modules/env-config.ts (new), apps/server/test/env-config.test.ts (new)

## Task

Create `EnvConfigService` (constructed with database + CustomFieldService + OwnerAccountService + SpreadsheetTransferService):

- First add the shared import-plan vocabulary to `packages/contracts` (spec R3–R5): action enum (`create`/`update`/`retire`/`delete`/`skip`), grading enum (`safe`/`destructive`), skip-reason codes (`key_exists`, `owner_exists`, `template_name_exists`, `select_without_options`, `required_without_default`, `missing_field_ref`, `type_conflict`), and the plan/result schemas the server returns and the web preview renders.
- `exportPackage()`: active Custom Fields (key/label/description/type/required/defaultValue/active options/sortOrder), all Owner Account mappings, all XLS export templates (name/sheetName/columns). No ids.
- `validate(payload, mode)`: parse via `parseEnvConfigPackage`; produce plan entries per section:
  - fields: `create` | `skip(key_exists | select_without_options | required_without_default)`
  - mappings: `create` | `skip(owner_exists)`
  - templates: `create` | `skip(template_name_exists | missing_field_ref)`
- `importAdditive(payload, sections)`: execute the planned creates in one transaction, in order fields → mappings → templates; return the plan with per-item outcomes.

Reuse existing service methods (`CustomFieldService.create`, `OwnerAccountService.create`, `SpreadsheetTransferService` list/create). Extend a service only if a needed capability is genuinely missing.

## Acceptance (tests first, following app.test.ts setup)

- export → validate on empty DB → importAdditive round-trips all three sections.
- Importing the same package twice: second run imports nothing; every item reported with the correct skip reason.
- v1 template file imports as a fields-only package.
- A template referencing `custom:<missing>` skips with `missing_field_ref` when the field section is not imported.
- Invalid JSON/schema → problem details with a stable code (existing AppError conventions).
- A package field without `sortOrder` imports at its array position (spec R1).

## Comments

- Implemented: `apps/server/src/modules/env-config.ts` (new) + `apps/server/test/env-config.test.ts` (new, 8 tests).
- Contracts: added the shared import-plan vocabulary — actions `create/update/retire/delete/skip`, grades `safe/destructive`, skip-reason codes, `envConfigPlanSchema` (with `hasDestructiveChanges`) and `envConfigImportResultSchema` (per-item `outcome: created | skipped | not_selected`).
- `SpreadsheetTransferService.listTemplates(ensureDefault = true)` gained an opt-out parameter so export never fabricates the default template in an empty environment.
- `validate(payload, mode)` parses via `parseEnvConfigPackage` and reports invalid payloads as 422 `VALIDATION_ERROR` problem details; template `custom:<key>` refs resolve against active local keys ∪ package fields planned for create; sync mode throws 同步导入模式尚未实现 until ticket 03.
- `importAdditive(payload, sections)` executes creates in one transaction in order fields → mappings → templates; created fields land at their package `sortOrder` (defaults to array position per R1); unselected sections report `not_selected`; a template whose field section is not imported skips with `missing_field_ref`.
- Tests cover all six acceptance bullets plus `select_without_options` / `required_without_default` skips and active-only export. Note: `buildApp` services do not expose `ownerAccounts` yet, so the test helper constructs `OwnerAccountService` directly (app wiring belongs to ticket 04).
- Verification: env-config suite 8/8 green; server + web typecheck green; full server suite green except `config.test.ts`, which fails only under `vitest --pool=threads` (sandbox cannot spawn fork workers; `process.chdir` is unsupported in worker threads) — unrelated to this ticket and green under the normal forks pool.
