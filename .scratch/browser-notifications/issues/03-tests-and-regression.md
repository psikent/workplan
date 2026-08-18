# 03 — 测试与回归（调度器 + 铃铛控制 + 服务端回归）
Type: task
Status: ready-for-agent
Blocked by: 02
Spec: ../spec.md
Scope: apps/web/src/lib/notifications.test.ts（新增）、apps/web/src/components/AppShell.test.tsx（扩展或新增）、apps/server/test/app.test.ts（回归确认，只读不改）

## 背景
规格 R6。既有约定：服务端 /api/v1/tags、/api/v1/notifications 必须保持 404，tags/reminders 属性必须保持 422（app.test.ts:816 用例）。本特性不得触碰这些断言。

## 改动清单
1. 调度器单元测试（fake timers + mock Notification/文档可见性）：
   - 权限状态矩阵（granted/denied/default/不支持）；
   - tag 去重与触发次数；水平线（7 天）上限内布防；可见性降级（visible -> toast）；
   - 提前量触发；cancelled（手动覆盖）不触发；点击通知 -> 聚焦 + 打开对应计划。
2. RTL 测试：AppShell 铃铛控制（开启/关闭、denied 状态、不支持浏览器时隐藏/禁用、提前提醒输入持久化）。
3. 回归：确认服务端仍拒绝遗留 tag/reminder/notification 端点与属性（既有用例保持 green，不新增服务端存储）。

## 验收
- 新增用例全部通过；服务端「removes tag, reminder and notification APIs」用例保持 green。
- pnpm --filter @workplan/web typecheck 与 test 全绿；服务端测试无回归。