# 02 — 服务端预览与原子解散
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/server/src/modules/monthly-goal-series.ts、apps/server/src/routes/monthly-goal-series.ts、apps/server/test/monthly-goals.test.ts

## 改动清单

1. 实现解散预览分类、统计与稳定快照令牌。
2. 新增预览 GET 与执行 POST 路由。
3. 在单个事务内完成快照校验、删除纯自动实例、保留项去系列化和删除系列。
4. 沿用 404/409/422 与现有权限语义。

## 验收

- 活跃/停止、单项/多项、零删除和各种使用痕迹均正确分类。
- 错误确认、错误发起目标及预览后变化不会产生部分修改。
- 原停止 API 与实例独立行为无回归。

## Comments

- `updated_at !== created_at` 表示实例生成后发生过写入。

## Answer

- 已实现 GET 预览与 POST 解散路由，并用稳定 SHA-256 快照覆盖系列、实例、关联计划及分类字段。
- 解散在单个 SQLite 事务内校验快照和名称、删除纯自动实例、将保护实例去系列化并删除系列。
- 服务端测试覆盖活跃/停止系列、单项/零删除、标题/说明/月度/归档恢复/关联解绑、编辑者权限，以及 404/409/422 和无部分修改。
