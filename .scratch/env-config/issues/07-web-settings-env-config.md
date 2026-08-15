# 07 — Web: 环境配置 section in Settings; remove old template buttons

Status: resolved
Blocked by: 04
Spec: ../spec.md
Scope: apps/web/src/pages/SettingsPage.tsx, apps/web/src/lib/api.ts, their tests

## Task

Settings page, new 环境配置 section between 数据导入导出 and 负责人账号映射:

- 复制配置 (`navigator.clipboard.writeText` with pretty JSON from `GET /env-config`; success toast) and 下载配置文件 (blob download via `/env-config/file`, following the existing `downloadExport` pattern).
- Import side: paste textarea + file upload alternative; mode select 增量导入 (default) / 同步导入; 校验并预览 → `POST /env-config/validate`.
- Preview: per-section checkboxes (默认全选); item rows colour-coded by grade — safe 新增/更新, destructive 破坏性 in red, skipped with reason text; in sync mode with destructive rows, a 我已确认破坏性变更 checkbox gates 执行导入.
- 执行导入 → `POST /env-config/import` with selected sections + `confirmDestructive`; result summary + toast.
- `api.ts`: add a `downloadEnvConfig` helper.
- CustomFieldsPage stays untouched (no template buttons exist at baseline).

## Acceptance (tests first)

- SettingsPage.test.tsx: copy writes the clipboard and toasts; paste + validate renders graded preview rows; destructive rows require the confirm checkbox; execute posts the selected sections and shows the result.

## Comments

- Added the Settings “环境配置” section between data import/export and owner-account mappings. Administrators can copy a pretty-printed package, download the server-provided JSON attachment, paste JSON or upload a file, and choose Additive or Sync Import before validation.
- The validation preview defaults all three sections on, renders field option rows as well as top-level items, preserves destructive grading for destructive skips, localizes skip reasons, and gates Sync Import confirmation against only the currently selected sections.
- Execution posts the validated package snapshot, selected sections and `confirmDestructive`, then renders the server result summary, refreshes affected query caches and shows a success toast. Editing input invalidates stale validation responses; import controls are frozen while execution is in flight; out-of-order file reads cannot replace newer pasted input.
- Added `downloadEnvConfig` with response filename support and failure handling. File upload remains keyboard reachable, async errors are announced, and preview grades have light/dark theme styling with accessible contrast. `CustomFieldsPage` remains untouched.
- Tests were added first for copy/download, file and paste flows, graded/nested preview, stale-response and file-read races, selected-section destructive gating, execution payload/result/toast, in-flight control freezing and download failure. Final verification: Settings tests 16/16, API helper tests 3/3, full Web suite 89/89, Server suite 59/59, runtime/export script tests 4/4, Web typecheck green, and workspace production build green. Independent review found no remaining blocking or medium-severity issues.
