# 02 — 时间轴铃铛渲染（表头注入 + 悬浮 + 点击）
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/lib/api.ts（fetchReminders）、apps/web/src/pages/WorkPlansPage.tsx（拉取并透传提醒）、apps/web/src/components/GanttTimeline.tsx（表头注入铃铛 + 悬浮 + 点击）、apps/web/src/components/GanttTimeline.test.tsx / GanttTimeline.render.test.tsx、apps/web/src/styles.css

## 背景
规格 R3。提示方式：日期数字下方小铃铛、悬浮提示、点击打开计划。frappe-gantt 惰性渲染、天粒度、表头两行（月份/日期数字）、无第三副行；铃铛必须在 render 后处理中注入，并随范围变化/重渲染清理重放（复用现有 label 居中、今天标记等 DOM 修整模式）。

## 改动清单
1. lib/api.ts：新增 fetchReminders(from, to) → 调 \`/api/v1/reminders\`。
2. WorkPlansPage：与计划并行拉取可见范围提醒（随 rangeStart/rangeEnd 与 view 切换更新），下传 GanttTimeline。
3. GanttTimeline：render 后按日期在表头日期数字下方注入铃铛 DOM；日期在可见范围内即渲染（含未来提醒日，过期规则由派生自身消失）；一日期最多一个铃铛（汇总）。
4. 悬浮提示：检修单提醒 = 触发计划标题 + 开始日期；作业计划提交提醒 = 触发计划列表（标题 + 开始日期）。
5. 点击：单计划铃铛 → 复用 onSelect 打开对应 Work Plan 抽屉；多计划铃铛不绑定点击。
6. 样式：小铃铛与设计基线一致（参考 DESIGN.md 的 18px 圆角 outline 图标、ann-color 语义色），tooltip 浮层与现有 popup 风格协调。

## 验收
- 时间轴在提醒日期下显示铃铛；切换视图/滚动返回后重放正确；未来日期也显示。
- 悬浮显示正确文案；单计划铃铛点击打开抽屉。
- 无提醒/无计划时不渲染多余内容；web typecheck/test 通过。
