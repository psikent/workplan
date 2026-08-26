# 05 — 回归与验收
Type: task
Status: ready-for-agent
Blocked by: 01, 02, 03, 04
Spec: ../spec.md
Scope: apps/server/test/、apps/web/src/、README.md、全仓构建与测试

## 背景

规格验收标准 1–7。最终票据负责证明迁移安全、权限矩阵完整、Viewer 界面确实只读，并确认 Administrator 与 Editor 无回归。

## 改动清单

1. 汇总服务端权限矩阵，逐类覆盖 Administrator、Editor、密码 Viewer、Token-only Viewer 和未认证请求；特别锁定两个使用 `POST` 的查询操作可供 Viewer 使用。
2. 对每类 Viewer 越权请求验证 HTTP 403、`INSUFFICIENT_PERMISSION` 及数据库零变化，覆盖 Work Plan、Recurring Rule、Monthly Goal 和 Goal Recurrence。
3. 验证数据库升级前后的用户、密码哈希、会话、Token、版本和外键完整性，并验证新数据库可创建 Viewer。
4. 汇总前端角色、账户管理、只读提示、详情、时间轴、Monthly Goal 和业务导出回归；确认 Viewer 没有角色转换或凭据自助入口。
5. 功能实现并验证后更新 README 的账户与安全说明，加入 Viewer 能力和边界；在实现前不得将 README 描述为已可用。
6. 运行 `corepack pnpm typecheck`、`corepack pnpm test`、`corepack pnpm build`，记录命令与结果。
7. 手工验收密码 Viewer 和 Token-only Viewer：登录/认证、业务查询、高级搜索、JSON/XLS 导出、Web 写入口缺失、直接写 API 返回 403、停用后凭据失效。
8. 全部通过后在本票追加 `## Answer` 记录证据，并经用户确认后把 `spec.md` 状态更新为已实现。

## 验收

- 规格验收标准 1–7 全部有自动化或手工证据。
- 全仓 typecheck、test、build 全绿；Administrator 和 Editor 无权限或交互回归。
- README 只在功能实际可用后更新，规格和票据状态与实现事实一致。

## Comments

