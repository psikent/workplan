# Spec: Bark 推送（Work Order Reminder 的每日推送通道）

> Status: **已交付** — 需求访谈（grill-with-docs）收敛 D1–D6，票据 01–04 全部完成，全仓 typecheck/test 通过。

## Goal

在现有小铃铛提醒功能之上增加 Bark 推送：**检修单提醒（Work Order Reminder）**从挂铃当天开始，每天 09:30（Asia/Shanghai）向配置的 Bark 设备推送一条提醒，直到计划开始前一天为止；计划中途被手动标记完成或取消则立即终止推送。设置页新增 Bark 配置项。

## Terms

见 `CONTEXT.md`：**Bark Push (Bark 推送)**（本次新增）、**Work Order Reminder**、**Reminder (提醒)**、**Reminder Date (提醒日)**、**Manual Status Override**、**Administrator**。

## 已定决策（拷问记录）

- **D1 推送范围**：只推送检修单提醒；作业计划提交提醒不推送（铃铛已有）。
- **D2 配置形态**：全局唯一一份 Bark 配置（服务器 URL，默认 `https://api.day.app` + 设备 Key + 测试推送按钮），由 Administrator 在设置页维护；不做按账户推送。
- **D3 防重发**：新增推送日志表，唯一键 = (推送日, 提醒类型, 计划 id)；scheduler tick 先查表再推；这是对「提醒零存储」原则的唯一破例（见 ADR-0005）。
- **D4 终止边界**：终止线 = 计划开始日 0 点，最后一次推送是开始前一天的 09:30（与开始时刻无关）；提醒日当天即开始推；错过提醒日仍 pending 的从「今天」起照常每日推。
- **D5 推送内容**：纯文案不跳转；title「检修单提醒」；body = 计划标题 + 开始日期（如「3 月 5 日开始」）+ 提示语；group 固定 `work-order-reminder`。
- **D6 配置归属**：Bark 配置不纳入环境配置包，仅存本环境数据库、仅 Administrator 读写；设备 Key 留空 = 推送关闭；推送失败按 tick 自然重试并记 warning。

## Background facts

- 提醒由 `apps/server/src/modules/reminders.ts` 纯只读推导，时区 Asia/Shanghai；`GET /api/v1/reminders` 返回按日期的提醒列表（type=`work-order`，含触发计划 id/title/startAt）。
- 规则 1 只对有效状态 pending 的计划产出提醒；手动标记完成（Manual Status Override）或取消后，推导自然停止产出——「手动完成即终止推送」免费得到。
- `app.ts` 已有 60 秒一次的 scheduler tick（`setInterval`，unref），推送检查挂载其上。
- 仓库目前没有通用设置表；Bark 配置与推送日志需要新表 + migration。
- 一个边界：计划开始当天 09:30 时若开始时刻未到，计划仍是 pending，推导会产出提醒——因此**推送侧必须额外过滤「计划开始本地日 > 今天」**，否则违反 D4。
- 设置页 `SettingsPage.tsx` 已有环境配置导入导出区块，Bark 区块并列新增。

## Requirements

### R1 存储（contracts + migration）

- 新表 `bark_config`（单行）：`server_url`（默认 `https://api.day.app`，写入时校验为合法 URL）、`device_key`、`updated_at`。
- 新表 `bark_push_log`：`push_date`（YYYY-MM-DD 本地日）、`reminder_type`、`plan_id`，三者唯一；`pushed_at`。仅记录成功推送。
- contracts 新增 Bark 设置与测试推送的请求/响应 schema。

### R2 配置 API 与设置页

- `GET /api/v1/settings/bark`、`PUT /api/v1/settings/bark`：仅 Administrator（`authorization: "admin"`）；GET 返回配置（设备 Key 可整体返回，本系统无多租户泄露面）；PUT 校验 URL。
- `POST /api/v1/settings/bark/test`：向当前配置发送一条固定测试文案，返回成功/失败原文摘要，供设置页按钮展示。
- `SettingsPage` 新增「Bark 推送」区块：服务器 URL、设备 Key（留空提示=关闭推送）、保存、发送测试推送（展示结果）。

### R3 每日推送调度

- 挂载现有 60 秒 scheduler tick：本地（Asia/Shanghai）时间 ≥ 09:30 且今天尚无推送记录时执行。
- 执行逻辑：取今天的检修单提醒 → 过滤掉 `计划开始本地日 ≤ 今天` 的（D4 终止线）→ 逐计划查 `bark_push_log`，未推过的向 Bark 服务器推送（title/body/group 按 D5）→ 成功落日志一行。
- 设备 Key 为空 → 直接跳过（功能关闭），不报错。
- 单个推送失败：记 warning，不落日志（下个 tick 自然重试，等效每分钟重试直到成功或条件消失）；不做额外退避；不影响其余计划与调度器。
- 推送请求设短超时（如 5s），防止 Bark 服务器无响应拖住 tick。

### R4 回归与验收

- legacy 回归保持：`/api/v1/notifications`、`/api/v1/tags` 404；`tags`/`reminders` 属性 422。
- 全仓 typecheck 与测试通过。

## Out of scope（本期）

- 作业计划提交提醒的推送（D1）；按账户的推送配置（D2）；推送点击跳转工作台（D5）；Bark 配置进环境配置包（D6）；节假日表；推送历史的 UI 展示。

## 票据规划（按依赖顺序）

- 01 服务端存储与契约：`bark_config`/`bark_push_log` 表 + migration + contracts schema + 测试。
- 02 Bark 配置 API 与设置页：settings 路由（含测试推送端点）+ SettingsPage Bark 区块 + 测试。
- 03 每日推送调度：tick 挂载、过滤、去重、Bark 请求、日志落库 + 测试（幂等、边界日期、失败重试、空 Key 关闭）。
- 04 回归与验收：legacy 404/422 保持、全仓 typecheck/test。

## 验收标准

1. `need_ticket`=true 且 pending 的计划，从其提醒日当天起（含错过提醒日的）每天 09:30 收到一条 Bark 推送，文案含计划标题与开始日期。
2. 计划开始当天起不再推送（与开始时刻无关）；计划被手动标记完成或取消后立即停止。
3. 同一天同一计划只收到一条推送（重启服务、tick 重复触发均不重推）。
4. 设备 Key 留空时零推送、零报错；配置后可用设置页「发送测试推送」验证连通性。
5. 非 Administrator 无法读写 Bark 配置；环境配置包导出内容不含 Bark 配置。
6. 验收标准 R4 回归全部保持。
