# 02 — 前端:字段定义页呈现「折叠」配置
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/settings/CustomFieldsSettings.tsx、apps/web/src/pages/settings/CustomFieldsSettings.test.tsx

## 背景

规格 R3。字段定义页表格现有列:拖拽把手/字段名称/稳定键/字段类型/必填(是/否文本)/默认值/操作;编辑弹窗唯一开关为「必填」。票据 01 落地后契约携带 `collapsed`。

## 改动清单

1. 表格新增「折叠」列:显示「是/否」,风格对齐「必填」列(`CustomFieldsSettings.tsx:289` 附近)。
2. 编辑弹窗新增「折叠」开关(默认关):说明文案表明效果——字段收入计划抽屉底部「更多信息」折叠区,展开后仍可查看/编辑;新建(POST 携带 collapsed)与编辑(PATCH 携带 collapsed)均生效。
3. 测试(`CustomFieldsSettings.test.tsx`):
   - 表格列随定义 collapsed 呈现是/否。
   - 弹窗开关切换后保存,请求体携带 collapsed。
   - 既有用例零回归。

## 验收

- 对应规格 R3 与验收标准 1 的 web 部分。
- `corepack pnpm --filter @workplan/web typecheck && corepack pnpm --filter @workplan/web test` 全绿。
