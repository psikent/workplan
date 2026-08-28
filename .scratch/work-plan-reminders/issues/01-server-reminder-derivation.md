# 01 — 服务端提醒推导模块与 /api/v1/reminders
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: packages/contracts（提醒查询/响应 schema）、apps/server/src/modules/reminders.ts（新增）、apps/server/src/routes/reminders.ts（新增）、apps/server/test/（新增）

## 背景
规格 R1/R2。根据 Work Plan 与 Custom Field（\`ticket\`/\`risk\`）纯只读推导提醒日期，返回时间范围内的提醒列表。遵守旧约束修订：legacy \`/api/v1/notifications\` 与 \`/api/v1/tags\` 仍 404、\`tags\`/\`reminders\` 属性仍 422（app.test.ts:816 回归保持）；本模块零提醒存储、不接触 legacy \`notifications\`/\`reminder_rules\`/\`tags\` 表。

## 改动清单
1. packages/contracts：新增 reminders 查询参数（from/to，YYYY-MM-DD）与响应 schema（每日期 → 提醒数组：{ type: \`work-order\` | \`plan-submission\`, date, originalDate?, plans: [{ id, title, startAt, risk? }] }），沿用现有 route/contract 模式（参照 routes/work-plans.ts）。
2. 新增工作日回溯工具：workingDaysBefore(localDate, n)——排除周六周日，Asia/Shanghai 天粒度；留节假日表接缝（先常量，后续可换表）。
3. 规则常量表（模块内代码数组，数据驱动）：
   - rule1 检修单提醒：\`ticket\`=true 且有效状态 pending（未开始且未取消）；reminderDate = startAt 本地日回溯 7 个工作日（WORK_ORDER_LEAD_WORKING_DAYS=7）。
   - rule2 作业计划提交提醒：RISK_THRESHOLD_LABELS={中,高}；触发星期=周三；下周=下周一到周日；计划与下周时间范围重叠即触发。
4. 推导逻辑：
   - rule1：若今天 > reminderDate 且计划仍 pending，提醒改挂「今天」并携带 originalDate；计划开始或取消后不再产出。
   - rule2：今天 ∈ [本周三, 本周日] 时产出，提醒挂在本周三；一个日期一个提醒，汇总全部触发计划；过期周不产出。
   - 按 Custom Field **key** 匹配（ticket/risk，不按定义 id）；字段或选项缺失时该规则静默跳过（不报错）。risk 由标签 {中,高} 解析到当前选项值（\`custom_field_options\`）。
5. 路由：\`GET /api/v1/reminders?from=<date>&to=<date>\`，返回 [from,to] 内每天提醒列表；仅读，不写库。

## 验收
- 单测/集成：工作日回溯（跨周末）、rule1 提醒日、错过挂今天（注明 originalDate）、pending 条件（开始/取消后消失）、rule2 周三窗口与下周重叠、{中,高} 匹配、字段缺失静默、from/to 边界。
- legacy 回归保持：\`/api/v1/notifications\`、\`/api/v1/tags\` 404；\`tags\`/\`reminders\` 属性 422。
- packages/contracts build 通过；server typecheck/test 通过。

## Answer

- packages/contracts 新增提醒 schema：`reminderTypes`（work-order/plan-submission）、`reminderPlanSchema`、`reminderSchema`（type/date/originalDate/plans）、`reminderDaySchema`、`listRemindersQuerySchema`（from/to YYYY-MM-DD，from ≤ to）、`listRemindersResponseSchema`（days 数组，含无提醒日期）。
- 新增纯只读推导模块 `apps/server/src/modules/reminders.ts`：`workingDaysBefore`/`isWorkingDay`（Temporal，Asia/Shanghai 天粒度，节假日表接缝常量空集）、`WORK_ORDER_LEAD_WORKING_DAYS=7`、`RISK_THRESHOLD_LABELS={中,高}`、`PLAN_SUBMISSION_TRIGGER_WEEKDAY=3`；规则表为模块内常量数组（数据驱动，各规则谓词/提醒日计算独立函数）。
  - rule1：ticket=true 且有效状态 pending → 开始本地日回溯 7 个工作日；今天 > 提醒日时挂今天并附 originalDate；开始/取消后不产出。
  - rule2：今天 ∈ [本周三, 本周日] → 汇总下周（周一到周日）重叠的 risk 标签 ∈ {中,高} 计划，挂本周三；过期周不产出；无状态约束（按规格字面）。
  - 字段按 key 匹配（ticket 须 boolean、risk 须 single_select）；字段缺失、类型不符或 中/高 选项缺失时该规则静默跳过；risk 回传选项标签（如「中」）。
- 新增路由 `GET /api/v1/reminders?from=&to=`（不传 querystring schema，handler 内 safeParse——沿用 monthly-goals 模式），仅读不写库，不含 legacy 表。
- `apps/server/test/reminders.test.ts` 12 项：工作日回溯（跨周末/节假日接缝）、rule1 提醒日与错过挂今天（originalDate）、开始/取消消失、rule2 周三窗口（周二无/周三有/周日有/下周一过期）、{中,高} 标签→选项值匹配（低/可接受不触发、本周计划不触发）、字段或选项缺失静默、from/to 边界与非法参数 422。
- 回归保持：app.test.ts 的 legacy 404（/api/v1/tags、/api/v1/notifications）与 tags/reminders 属性 422 全部通过；server 101/101、根级 pnpm typecheck 全绿、contracts build 通过。

### 补充（2026-08-28，bug fix）

- **发现问题**：规则 1 按规格字面只匹配 key=`ticket`，但运行库（`data/workplan.db`）实际字段 key 为 `need_ticket`（「是否需起检修单」，boolean）；`risk` 一致。导致真实环境 rule1 静默跳过、无提醒产出。
- **修复**：`reminders.ts` 新增 `WORK_ORDER_FIELD_KEYS = ["need_ticket", "ticket"]`——rule1 按 key 数组匹配定义并读取计划值（`ticketValueOf`），兼容真实环境 key 与规格旧 key；两个 key 均有单测覆盖（`matches the work-order boolean field by its runtime key need_ticket`，reminders.test.ts 增至 13 项，13/13 绿）。
- 验证：真实库推导复测通过（9/10 开始 + need_ticket=true → 提醒挂 9/1）；server 全量 102/102、typecheck 绿。

### 补充 2（2026-08-28，用户确认移除旧 key）

- **移除规格旧 key `ticket` 的触发**：`WORK_ORDER_FIELD_KEYS` 现仅 `["need_ticket"]`（运行库真实 boolean 字段 key）；字段 key 为 `ticket` 时规则静默跳过、不再产出提醒。
- 测试更新：种子字段与计划引用全部改为 `need_ticket`；原「字段缺失静默」用例改为回归 `ignores the legacy ticket key when only need_ticket is recognized`（建 ticket 字段 + ticket=true 计划 → 无提醒）。reminders.test.ts 13/13 绿、server 全量 102/102、typecheck 绿；真实库复验：9/10 开始 + need_ticket=true 计划提醒仍挂 9/1。

### 补充 3（2026-08-28，用户确认：所有提醒提前挂）

- **规则 2 改为提前产出**（用户要求「提早就把铃铛挂在那里，而不是到了时间再提醒」）：推导不再按「今天所在周」只产出一个周三；而是对每个 risk ∈ {中, 高} 计划，在其开始日所在周的**上一周三**挂汇总铃铛，且**不要求今天已到达该周三**；过期（已过该周三所在周日）不产出。实现：`derivePlanSubmissionReminders` 从 `mondayOf(today)` 起按周遍历（终止于所有中/高计划的最晚 endAt 之后），每周三为触发日、其下周（周一~周日）为重叠窗口，聚合「一个日期一个提醒」。
- 规则 1 本就提前产出（未来提醒日也产出；错过挂今天），维持不变。
- 测试：reminders.test.ts 14 项——新增 `pre-places future submission reminders on their trigger Wednesday`（今天早于触发周三仍产出）；「周三窗口」用例的周二断言改为「提前已挂在本周三」。server 全量 103/103、typecheck 绿；真实库复验 8/28 可见 9/1（work-order）+ 9/2（plan-submission）。
- 规格：R2 与验收标准 3 的措辞同步更新为「提前可见」。
