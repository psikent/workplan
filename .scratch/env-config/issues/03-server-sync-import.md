# 03 — Server: Sync Import — plan grading and convergence

Status: resolved
Blocked by: 02
Spec: ../spec.md
Scope: apps/server/src/modules/env-config.ts, apps/server/test/env-config.test.ts

## Task

Extend `EnvConfigService` with Sync Import:

- `planSync(package, sections)`: per section diff against local state:
  - fields: `create` | `update` (label/description/defaultValue/sortOrder — safe) | `set_required` (destructive; needs non-null default, else skip `required_without_default`) | `retire` (local field absent from package — destructive) | `type_conflict` (skip + report, never executed)
  - options: `add_option` (safe) | `retire_option` (destructive)
  - mappings: `create` | `update` | `delete` (absent from package; no attached data, outright delete)
  - templates: `create` | `update` (replace name/sheetName/columns) | `delete` (absent)
- Matching by stable identity only: fields by `key`, mappings by `ownerName`, templates by `name`. Local ids never compared.
- `importSync(package, { sections, confirmDestructive })`: reject when destructive changes exist and `confirmDestructive` is false; execute in one transaction in order fields → options → mappings → templates; retire fields/options through the existing archive operations; type conflicts reported as skipped.
- Both modes return one shared plan shape (item-level action/grade/reason) so the UI renders a single preview.

## Acceptance (tests first)

- A drifted DB converges to match the package; re-export equals the package (modulo ids/exportedAt).
- Field absent from package → `archivedAt` set, existing values preserved.
- Retired option: values referencing it are not deleted.
- Type conflict: item reported, skipped, DB unchanged for that field.
- Sync with destructive changes and no `confirmDestructive` → rejected; with the flag → applied.
- Mapping/template absent from package → deleted.
- Section selection honoured in sync mode.

## Comments

- Implemented sync import in `apps/server/src/modules/env-config.ts` + `apps/server/test/env-config.test.ts` (16 tests total: 8 additive/export from 02, 8 new sync).
- Contracts: `envConfigActions` gained `set_required`; new `envConfigOptionActions` (`add_option`/`retire_option`/`update_option`) with option plan/result item schemas nested under field items (`options?`); `envConfigImportOutcomes` extended with `updated`/`retired`/`deleted`. dist rebuilt.
- `validate(payload, "sync")` now returns the sync plan (previously threw 同步导入模式尚未实现); `planSync(pkg, sections)` is public and takes the parsed package; `importSync(payload, { sections, confirmDestructive })` takes the raw payload for parse-error symmetry with `importAdditive`.
- Sync plan: package-parallel rows first (create/update/set_required/skip), then appended retire rows for local-only fields and delete rows for local-only mappings/templates; unchanged items are omitted. Matching by stable identity only (key / ownerName / name), never local ids.
- Grading: create/update/add_option/update_option safe; retire/set_required/type_conflict/retire_option/mapping delete/template delete destructive. `type_conflict` is `action: skip` with destructive grade (spec R5), reported and never executed — DB untouched for that field.
- `set_required` needs a non-null package default; otherwise the whole field item is skipped with `required_without_default` (safe changes on that field are not applied either — one action per item).
- confirmDestructive gate considers only destructive items in the SELECTED sections, so deselecting a destructive section in the preview un-gates execution (R6 granularity). Mapping/template deletes are graded destructive although they carry no attached data, so users confirm before definitions disappear.
- Execution: one transaction, order fields → options → mappings → templates; per field, options are added/updated before the field update (defaultValue validation can reference newly added options) and retired after it; option sort orders are normalized to package order so re-export matches the package. Retiring reuses `CustomFieldService.update({archived: true})` / `updateOption({archived: true})`; values referencing retired fields/options are preserved.
- Template `custom:<key>` refs resolve against the post-sync active key set (active local − retired + package creates/updates), so a template referencing a field retired by the same sync skips with `missing_field_ref`.
- Tests clear the 9 seed mappings first (clearDefaultMappings) so sync plans reflect only test-constructed data; the seed mapping noise is why the additive tests filter skips.
- Verification: env-config suite 16/16 green (`vitest run --pool=threads` — the sandbox blocks the default forks pool with spawn EPERM); server + contracts + web typecheck green; full server suite 42/46 green — the 4 failures are the pre-existing `config.test.ts` `process.chdir` failures under the threads pool documented in ticket 02, unrelated to this ticket.
