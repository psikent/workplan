# 01 — 服务端提醒推导模块与 /api/v1/reminders
Type: task
Status: ready-for-agent
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
