# 02 — Web 设置页:备注选项配色编辑器
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/settings/CustomFieldsSettings.tsx、apps/web/src/pages/settings/CustomFieldsSettings.test.tsx

## 背景

规格 R3。设置页字段定义管理在 `CustomFieldsSettings.tsx`(表格 + 编辑弹窗,含选项管理/重排);字段目录来自 `GET /api/v1/custom-fields`。票据 01 落地后契约选项携带 `color: string | null`,更新走既有选项更新接口。色板常量从 contracts 导入。

## 改动清单

1. `CustomFieldsSettings.tsx`:
   - key=`remarks` 且 type=`single_select` 的字段:选项管理 UI 选项行显示当前色点(无色显示灰点或占位),编辑处提供色板选择器(8 色点选 + 「无色」清除),保存走既有选项更新路径(color 随 payload)。
   - 其他字段(含其他单选字段)完全不渲染配色控件。
   - 选项重命名/归档/重排等既有操作不丢已有 color(更新 payload 未涉 color 时不传)。
2. 测试(`CustomFieldsSettings.test.tsx`):
   - remarks 字段显示色板编辑器,选色/清除后调用选项更新接口且携带 color。
   - 其他单选字段不显示配色控件。
   - 既有设置页用例零回归。

## 验收

- 对应规格 R3 与验收标准 1 的设置页部分。
- `corepack pnpm --filter @workplan/web typecheck && corepack pnpm --filter @workplan/web test` 全绿。

## Comments

### 2026-09-09 实施完成

- `CustomFieldsSettings.tsx`：`OptionDraft` 增 color；仅 key=remarks 且 type=single_select 渲染色板行（`.option-color-picker`，8 色点选 + 「无色」清除，选中态 aria-pressed）；`syncOptions` 仅 remarks 随 payload 携带 color（更新路径 color-only 变化也触发 PATCH；其余字段不传不丢本地色）；创建路径 `activeOptions` 恒带 color（非备注草稿恒 null）。styles.css 增色板行样式（落在选项行第二行，不挤压既有网格）。
- 测试：新增 4 用例（选色/清除 payload 携带 color、未涉 color 的重命名不丢色、其他单选字段无配色控件）；remarks 夹具选项补 color。web 325 用例全绿，typecheck 绿。
- 隔离实例手工验收（临时 DATA_DIR，未动 ./data）：新建 remarks 单选 + 3 选项并经色板选色保存 → GET /custom-fields 三选项 color 分别 #3b82f6/#10b981/#f43f5e。
