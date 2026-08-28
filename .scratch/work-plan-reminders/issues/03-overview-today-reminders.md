# 03 — 工作台「今日提醒」区
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/OverviewPage.tsx、apps/web/src/pages/OverviewPage.test.tsx

## 背景
规格 R4。工作台「今天需要关注」区域追加「今日提醒」：今天提醒日的提醒 + 错过提醒日但仍未开始的计划（rule1 的「挂今天」已覆盖错过场景）。

## 改动清单
1. OverviewPage：拉取今日提醒（fetchReminders(today, today)），渲染「今日提醒」区块，与现有「接下来的工作计划」并列。
2. 每项显示：类型标识（检修单提醒 / 作业计划提交提醒）、触发计划标题 + 开始日期。
3. 交互：复用 Overview 现有的列表打开机制打开对应的 Work Plan 抽屉（若 Overview 目前无打开机制，本票顺带补齐最简版）。
4. 无今日提醒时不渲染该区块。

## 验收
- 工作台显示今日提醒（含错过挂今天的）；点击可打开对应计划；无提醒时无区块；web typecheck/test 通过。

## Answer

- `apps/web/src/pages/OverviewPage.tsx`：新增 `fetchReminders(today, today)`（本地日 YYYY-MM-DD，queryKey `["reminders", today, today]`、30s 轮询），取 `days.find(date === today)` 的提醒；`reminderRows` 按提醒展平为每计划一行（类型标识 + 计划标题 + 开始日期；`originalDate` 存在时附注「原提醒日」）。
- 区块与「接下来的工作计划」放入 `.overview-panels`（auto-fit 网格，宽屏并列、窄屏堆叠）；仅当 `reminderRows.length > 0` 时渲染，无提醒不出现在页面上。
- 每行复用现有 `workPlanTimelineLink`（`/work-plans?view=week&date=<startAt>&plan=<id>`，经 WorkPlansPage 的 `plan` 参数打开对应抽屉）——即 Overview 现有的列表打开机制，多功能计划也按行可点。
- 类型标识：`work-order` → 检修单提醒（amber 软底），`plan-submission` → 作业计划提交提醒（accent 软底）；`styles.css` 新增 `.overview-panels`/`.reminder-list`/`.reminder-type-*`（含 dark 主题 hover 规则、CSS 变量语义色与既有基线一致）。
- `apps/web/src/lib/format.ts`：新增共享 `toLocalDateString(date)`。
- `apps/web/src/pages/OverviewPage.test.tsx`（+4）：今日提醒展示并打开对应计划（URL 参数断言）、plan-submission 多计划逐行列出、错过提醒附原提醒日、无提醒时无区块；原有 upcoming 链接测试保持。
- 验证：web typecheck 通过；web 202/202（含新增 4 项）；根级 `pnpm test` 全绿（server 101/101、scripts 回归通过）；根级 `pnpm typecheck` 通过。
