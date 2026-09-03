# 11 — 统一工作台、提醒与准确统计

Type: task
Status: done
Blocked by: 10
Spec: ../spec.md
Scope: 工作台/提醒 Server 模块与路由、`apps/web/src/pages/OverviewPage.tsx` 及相关测试

## Background

工作台当前依赖有限列表在前端分组，提醒有独立排序规则。规格要求由服务端按同一求值时刻判定成员和准确数量，同时保留提醒的独立业务主序。

## Work

1. 在服务端实现三个互斥计划区块的成员查询：今日新开工、今日继续开工、接下来的计划。
2. 使用 `[startAt,endAt)` 和 `Asia/Shanghai` 日历边界，明确午夜、跨日、手动完成、取消及第七个工作日包含行为。
3. 返回每组完整准确计数；列表行使用排期顺序，不从最多 500 条普通列表推算。
4. 今日提醒保持独立入选，按检修单提醒、作业计划提交提醒排序，同类中的工作计划改用统一排期顺序；允许与计划组重复。
5. Overview 页面改用服务端结果，保持详情跳转和现有提醒交互；删除客户端重复成员/排序逻辑。
6. 添加边界矩阵和准确计数测试，包括恰好午夜、当天已经结束、跨日尚未结束、手动状态、周末和第七工作日。

## Acceptance

- 任一工作计划最多进入一个计划区块，同一工作计划可以同时出现在提醒中。
- 成员、计数和顺序由服务端在同一求值时刻产生。
- 超过旧 500 条上限时计数与组内结果仍准确。
- Overview 与 Reminder 相关自动化测试通过。

## Comments

## 实施记录（2026-09-03）

- **服务端工作台** `modules/workbench.ts` + `GET /api/v1/workbench/overview?limit=`：三区块在同一求值时刻（`engine.queryAt`）判定成员——今日新开工（开始本地日=今天，未取消，含已完成）、今日继续开工（开始本地日<今天且 `[startAt,endAt)` 与今天相交，未完成未取消）、接下来的计划（开始本地日 ∈ (今天, 第七个工作日]，含中间周末）；工作日=非周六/周日（与 reminders 同口径）。`Asia/Shanghai` 日界经 `Temporal` 计算；行序为排期兜底，`total` 为完整准确计数（limit 只截断行）。
- **有效状态语义**：筛选基于派生状态 CASE（manual 用存量、automatic 按求值时刻推导），手动完成/取消覆盖自动状态；今天已结束的计划不进入继续开工，今天完成的仍在今日新开工。
- **响应契约入 contracts**（`workbenchOverviewSchema`：区块 items/total + summary 四项准确计数 all/pending/inProgress/completed），服务端与 Web 共用。
- **提醒**：同类内计划改用统一排期顺序（快照补 `created_at`，ID 改码点比较）；`reminderPlanSchema` 附加 `endAt/createdAt`（向后兼容）；提醒保持独立入选，允许与计划区块重复（测试覆盖检修单提醒计划同时出现在接下来的计划区块）。
- **Web OverviewPage**：改用 `/workbench/overview`，删除客户端 500 条上限取数、分组、过滤与排序逻辑；汇总栏改为服务端准确计数；详情跳转与提醒交互保留。
- 测试：`test/workbench.test.ts` 5 项（恰午夜开始/结束、跨日未结束、手动完成/取消、今天已结束、窗口含周末与第七工作日、第八日排除、三区块互斥、超 limit 计数准确、summary、提醒与区块重叠）；reminders 测试 14 项随契约字段更新。server 160/160、web 259/259、全仓 typecheck 通过。

