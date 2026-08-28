# Spec: 时间轴提醒（Work Plan Reminders）

> Status: **已提交** — 票据 01–04 全部 resolved；实现与文档已随 `2ab7396 feat: add work plan reminders (work-order & plan submission)` 提交并推送 origin/main。legacy 404/422 回归保持、全仓 typecheck/test 连续多轮全绿（2026-08-28 核实）。

## Goal

在时间轴视图的日期下方用铃铛提示两类提醒，并在工作台汇总今日提醒：

1. **检修单提醒**：标记了「是否需起检修单」（Custom Field `need_ticket` = true）且尚未开始、未取消的 Work Plan，在其开始日回溯 7 个工作日的那天，日期下方显示小铃铛，悬浮提示起检修单。
2. **作业计划提交提醒**：本周三，若下周（周一至周日）存在 Risk Level 为「中」或「高」的 Work Plan，在本周三日期下方显示一个汇总铃铛，提示提交下周作业计划。

后续阶段接入 Bark 推送；本期只保证服务端提醒推导可被推送通道复用（接缝）。

## Terms

见 `CONTEXT.md`：**Reminder / Reminder Rule / Reminder Date / Working Day / Work Order Reminder / Plan Submission Reminder / Maintenance Work Order / Work Order Required / Risk Level**。

## Background facts

- 触发字段是**已存在**的 Custom Field（运行库 `data/workplan.db` 已查证）：
  - `need_ticket`「是否需起检修单」：boolean，默认 false。
  - `risk`「风险等级」：single_select，取值 可接受/低/中/高，默认 低；「中及以上」= {中, 高}。
- 服务端 legacy reminder/notification API 已移除且回归锁定：`/api/v1/notifications`、`/api/v1/tags` 返回 404，`tags`/`reminders` 属性返回 422（`apps/server/test/app.test.ts`）。本功能**不恢复**这些存储与端点；新增的只读推导端点走新路径 `/api/v1/reminders`，零提醒存储。
- 旧规格 `.scratch/browser-notifications/spec.md` 已被本规格取代（顶部已标注）；其「不新增任何服务端提醒端点」约束按本规格修订。
- 时间轴为 frappe-gantt 惰性渲染、天粒度，表头两行（月份 / 日期数字），无第三副行；铃铛注入日期数字下方（复用现有 render 后修整 DOM 的模式，参考 `GanttTimeline.tsx` 的 label 居中/今天标记代码）。
- 前端一次性拉取全部计划（`/work-plans?limit=500`，30s 轮询）；提醒由服务端计算，前端只渲染可见范围的结果。

## Requirements

### R1 规则表（代码级）

- 规则表为代码内常量数组，每条规则：{ 名称, 触发条件(计划谓词), 提醒日计算, 文案模板 }。本期两条规则；参数集中为常量：提前工作日数 = 7、风险阈值 = {中, 高}、触发星期 = 周三。
- 规则按 Custom Field **key** 匹配（`need_ticket`、`risk`），不按定义 id。规则引用的 Custom Field 在环境中不存在时，该规则静默不产出提醒（不报错）。部署到新环境时，这两个字段须通过 Environment Configuration Package 导入或手工创建。

### R2 服务端推导

- 新端点 `GET /api/v1/reminders?from=<date>&to=<date>`，返回 [from, to] 内每个日期的提醒列表（类型、触发计划 id/title/startAt/risk）。
- 工作日 = 非周六且非周日（时区 Asia/Shanghai，按天粒度，忽略时刻）；代码留节假日表接缝。
- **规则 1**：reminderDate = startAt 本地日回溯 7 个工作日；仅有效状态为 pending（未开始且未取消）的计划产出。若今天 > reminderDate 且计划仍 pending，提醒改挂「今天」并注明原提醒日，直到计划开始；计划开始或取消后不再产出。
- **规则 2**：对每个与「某周（周一至周日）」时间范围重叠的 risk ∈ {中, 高} 计划，提醒挂在该周的**上一周三**；提醒**提前产出**——不必等到周三当天，今天早于触发日期时铃铛也已就位（时间轴按可见范围渲染，未来日期同样显示）；已过期的提醒周不再产出；一个日期一个提醒，汇总全部触发计划。
- 纯只读推导，不写任何表，不接触 legacy `notifications`/`reminder_rules`/`tags` 表。

### R3 时间轴铃铛

- 铃铛注入表头日期数字下方；日期在可见范围内即渲染（未来提醒日也显示；过期规则按 R2 自然消失）。
- 悬浮提示：检修单提醒 = 触发计划标题 + 开始日期；提交提醒 = 触发计划列表（标题 + 开始日期）。
- 点击铃铛（单计划）复用现有抽屉打开对应 Work Plan；多计划铃铛不绑定点击。
- 无已处理/消除状态；所有账户看到相同铃铛（全局无状态）。

### R4 工作台

- OverviewPage「今天需要关注」区域追加「今日提醒」：今天提醒日的提醒 + 错过提醒日但仍未开始的计划。

## Out of scope（本期）

- Bark 推送（阶段 2，届时只加输出通道）；节假日表；按用户的已读/消除状态；规则管理界面；规则环境配置包化。

## 票据规划（待建，按依赖顺序）

- 01 服务端提醒推导模块 + `/api/v1/reminders` + 测试（工作日回溯、周三窗口、错过挂今天、字段缺失静默）。
- 02 时间轴铃铛渲染（表头注入、悬浮提示、点击开抽屉）+ 测试。
- 03 工作台「今日提醒」+ 测试。
- 04 回归与验收（legacy 404/422 保持、全仓 typecheck/test）。

## 验收标准

1. `need_ticket` = true 且 pending 的计划，时间轴在其开始日前 7 个工作日的日期下显示铃铛；悬浮显示标题与开始日期；点击打开抽屉。
2. 提醒日已过且计划仍 pending 时，铃铛显示在今天、注明原提醒日，直到计划开始或取消。
3. 对每个 risk ∈ {中, 高} 的计划，其所在周的上一周三日期下显示一个汇总铃铛（提前可见，不等到周三当天）；过期周不显示。
4. 工作台显示今日提醒（含错过但未开始的）。
5. 服务端回归保持：`/api/v1/notifications`、`/api/v1/tags` 仍 404；`tags`/`reminders` 属性仍 422。
6. 全仓 typecheck 与测试通过。
