# 02 — 时间轴铃铛渲染（表头注入 + 悬浮 + 点击）
Type: task
Status: resolved
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

## Answer

- `apps/web/src/lib/api.ts`：新增 `fetchReminders(from, to)` → GET `/api/v1/reminders?from=&to=`（复用 `api()`，承载 `ListRemindersResponse`）。
- `apps/web/src/pages/WorkPlansPage.tsx`：
  - `remindersRange`（from = rangeStart 本地日，to = rangeEnd-1 本地日，YYYY-MM-DD）随 `range`（anchor/view 切换）重算；
  - `useQuery(["reminders", from, to], refetchInterval: 30_000)` 与计划并行拉取，下传 GanttTimeline `reminders`；
  - `handleReminderSelect(planId)` 从全量 `plans` 按 id 解析后复用 `handleSelect` 打开抽屉（覆盖计划不在可见范围内/被筛选隐藏的情形，如 rule2 下周计划），作为 `onReminderSelect` 传入。
- `apps/web/src/components/GanttTimeline.tsx`：
  - 新 props `reminders?: ReminderDay[]`（默认 `[]`，签名 `remindersSignature` 入 effect deps）与 `onReminderSelect?`（ref 解耦）；
  - render 后处理中 `injectReminderBells`：按 `.lower-text` 的 `date_YYYY-MM-DD` class 匹配可见日期，日期数字下注入铃铛 `<button>`（Lucide Bell outline 内联 SVG，18px 圆角 outline 基线、stroke-width 1.8）；一日期最多一个铃铛——同一天多提醒合并展示；无提醒不注入；铃铛随 gantt 重渲染（容器 replaceChildren）重建，tooltip 与监听器由返回的 cleanup 清理；
  - 悬浮：共享 `.timeline-reminder-tooltip`（定位克隆 popup-wrapper 逻辑，随 container scroll 隐藏），检修单提醒 = 计划标题 + 开始日期，提交提醒 = 触发计划列表（标题 + 开始日期；跨年补年份）；鼠标进入/离开 + focus/blur 显示/隐藏；
  - 点击：单计划铃铛 → 优先 plansById 解析 WorkPlan 复用 `onSelect`，fallback `onReminderSelect`；多计划铃铛 `aria-disabled` 不绑定点击。
- `apps/web/src/styles.css`：铃铛（`--amber` 语义强调色，hover 转 `--accent`，focus-visible 描边）与 tooltip（`--surface`/border/阴影与 popup 协调，z-index 1002，pointer-events: none）。
- 测试：`lib/api.test.ts` +2（URL、422 错误冒泡）；`GanttTimeline.render.test.tsx` +6（按日注入、同日合并+双组悬浮、检修单 tooltip 文案、提交提醒计划列表、单击打开/多计划禁用、范围切换重放与范围外日期跳过）；`WorkPlansPage.test.tsx` +3（范围拉取与透传、onReminderSelect 开抽屉、切换下一周重拉）。
- 验证：web typecheck 通过；web 197/197（含新增 11 项）；根级 `pnpm test` 全绿（server/scripts 回归通过）。
