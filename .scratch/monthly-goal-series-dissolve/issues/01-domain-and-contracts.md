# 01 — 领域语言与解散契约
Type: task
Status: resolved
Spec: ../spec.md
Scope: CONTEXT.md、packages/contracts/src/index.ts

## 改动清单

1. 在 Goal Recurrence 词条中区分“停止生成”与“解散重复系列”。
2. 新增预览、执行请求、逐实例动作/原因和结果的共享 schema/type。
3. 保持既有系列、月目标与停止 API 契约不变。

## 验收

- 契约可表达发起目标、保护原因、统计、快照令牌与执行结果。
- Contracts build/typecheck 通过。

## Comments

- 本变更不需要 ADR 或数据库迁移。

## Answer

- 已在 `CONTEXT.md` 区分“停止生成”和“解散重复系列”。
- 已新增预览查询、逐实例动作/原因、快照令牌、执行请求和结果的共享契约。
- Contracts build 与全仓 typecheck 均通过，既有契约保持不变。
