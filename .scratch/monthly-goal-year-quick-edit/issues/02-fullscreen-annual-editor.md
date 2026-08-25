# 02 — 月目标全屏年度快速编辑器
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/MonthlyGoalsPage.tsx、apps/web/src/pages/MonthlyGoalsPage.test.tsx、apps/web/src/components/MonthlyGoalQuickEditDialog.tsx（新增）、apps/web/src/components/MonthlyGoalQuickEditDialog.test.tsx（新增）、apps/web/src/styles.css

## 背景

规格 R1–R5/R7。月目标页当前按单月查看和逐项编辑；本票增加右上角入口和全屏年度草稿表格，并接入票据 01 的原子批量接口，不改变现有新建、编辑、关联、归档和系列对话框。

## 改动清单

1. 在月目标页 `header-actions` 中、现有“显示已归档”和“新建月目标”之前增加次级按钮“快速编辑”，使用表格图标与 `aria-label="快速编辑月目标"`。
2. `MonthlyGoalsPage` 只负责打开状态、传入当前年份，以及保存成功后更新父页面年份；年度查询、草稿和提交逻辑封装到新增全屏对话框组件。
3. 对话框按 `GET /monthly-goals?year=<year>&includeArchived=true` 加载数据，按 `title.trim()` 聚合、以最早 `createdAt` 排序，并生成 12 个月勾选状态和完整 `{id, version}` baseline。
4. 包含普通、归档和系列实例；全年归档名称显示为空勾选行；同名同月多个实例显示一个勾选框。
5. 无数据时显示一个空白行；加号追加新行，减号只移除未保存的新行，并始终保留至少一个可用占位行。
6. 行名称可编辑且最长 200；实现行内校验：必填、规范化后唯一、新行至少选择一个月份；纯空白未勾选占位行忽略。
7. 维护初始状态与最终草稿，只在有效变更时启用保存；提交 spec R5 的批量载荷，`activeMonths` 升序且不重复。
8. 关闭、取消、遮罩、Escape 和切换年份共用脏数据确认；取消确认时保持当前弹窗和年份。
9. 保存成功后刷新 `monthly-goals`、`work-plans`、`monthly-goal-series` 查询，显示成功反馈，关闭弹窗，把父页面年份设为保存年份并保持月份。
10. 普通错误保留草稿；409 保留草稿并展示“重新载入”，用户确认放弃后才重新请求并重建 baseline。
11. 全屏容器使用模态 dialog 语义；表格横向滚动，表头与名称列 sticky，月份单元格保持可点击尺寸，每个复选框有包含行名和月份的可访问名称。
12. 为入口、聚合、行操作、校验、脏数据、提交、成功和错误恢复补齐页面/组件测试。

## 验收

- 入口位置与附图参考一致，不改变其余右上角操作。
- 弹窗继承当前年份，可切年；未保存切年和关闭均有确认保护。
- 普通、归档、系列和同名同月实例正确映射为年度表格。
- 新增、归档、恢复、改名生成准确 payload；快速编辑不提供说明、关联或系列规则控件。
- 保存成功关闭并更新父年份、保持月份；冲突不会自动丢弃草稿。
- 桌面和窄屏均能操作全部 12 个月，名称列在横向滚动时保持可见。
- 现有月目标新建/编辑/关联/归档/系列测试保持通过。
- 以下命令通过：
  - `corepack pnpm --filter @workplan/web test -- MonthlyGoalsPage.test.tsx MonthlyGoalQuickEditDialog.test.tsx`
  - `corepack pnpm --filter @workplan/web typecheck`
  - `corepack pnpm --filter @workplan/web build`

## Comments

- 详细说明、Goal-Plan Link 与 Goal Recurrence 规则不在该表格中编辑。
