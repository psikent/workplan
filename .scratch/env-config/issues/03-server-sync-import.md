# 03 — Server: Sync Import — plan grading and convergence

Status: open
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
