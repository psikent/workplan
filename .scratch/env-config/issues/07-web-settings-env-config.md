# 07 — Web: 环境配置 section in Settings; remove old template buttons

Status: open
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
