# 04 — 回归与整体验收
Type: task
Status: resolved
Blocked by: 02, 03
Spec: ../spec.md

## 改动清单

1. 补齐 Contracts、Server、Web 正向/边界/冲突测试。
2. 使用一次性测试数据完成浏览器端解散流程验收。
3. 执行全量测试、类型检查、构建与差异检查。
4. 将四张票据更新为 `resolved` 并记录 Answer。

## 验收

- 仅纯自动实例被删除，所有保护实例转为普通月目标。
- 操作原子、不可绕过名称确认、并发变化安全中止。
- 现有停止生成、规则编辑、实例管理无回归。
- `corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build`、`git diff --check` 全部通过。

## Comments

- 浏览器验收不得使用正式数据。

## Answer

- 已用唯一标题的一次性系列和临时工作计划完成浏览器验收：点击项、已编辑且已关联项保留为普通目标，纯自动实例删除，关联和重复徽标状态正确；月目标与临时计划随后全部清理。
- `corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build` 与 `git diff --check` 全部通过。
- 根级测试结果为 Server 79 项、Web 173 项及脚本级 6 项全部通过；现有停止生成回归保持通过。
