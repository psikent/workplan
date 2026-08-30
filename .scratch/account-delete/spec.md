# Spec: 账户删除（Account Deletion）

> Status: **已交付** — 需求访谈收敛 Q1–Q3，票据 01–03 全部完成，全仓 typecheck/test 通过。

## Goal

在「账户与访问 Token」页面的账户管理能力之上增加**账户删除**：Administrator 可硬删除 Editor/Viewer 账户，级联撤销其全部会话与访问 Token；管理员与自身不可删。与现有「停用」（可逆）互补。

## Terms

见 `CONTEXT.md`：**Account Deletion (账户删除)**（本次新增）、**Disabled Account (停用账户)**（本次补充）、**Administrator**、**Editor**、**Viewer**、**Token-only Account**。

## 已定决策（拷问记录）

- **D1 删除语义**：硬删除——移除账户行，sessions/access_tokens 经既有 `ON DELETE CASCADE` 自动级联清除；与「停用」（可逆、保留记录与 Token）互补。
- **D2 删除边界**：仅 Administrator；仅可删非管理员账户（editor/viewer）；删除自己拒绝（400）。路由层 `authorization: "admin"` + 服务层双守卫。
- **D3 UI 呈现**：账户卡片头部操作「停用/启用」旁新增删除图标按钮（Trash2，与 Token 撤销风格一致）；点击 `window.confirm`（文案含用户名 + 提示会话与 Token 一并失效）；成功后刷新列表；失败（版本冲突/不存在）显示错误。带 `version` 乐观锁，与 `PATCH /users/:id` 一致。

## Background facts

- 现状：`GET /api/v1/users`、`POST /api/v1/users`、`PUT /api/v1/users/:id/password`、`POST /api/v1/users/:id/tokens`、`PATCH /api/v1/users/:id`（停用/启用）、`DELETE /api/v1/users/:userId/tokens/:tokenId`；**无删除用户端点**。
- `sessions.user_id`、`access_tokens.user_id` 外键均为 `ON DELETE CASCADE`——删除即撤销全部凭据，无需手工清理。
- 业务数据表（work_plans/monthly_goals/custom_field_values/owner_account_mappings）均无 `user_id` 外键，删除账户不影响任何业务数据。
- Web 端 `AccountManagementPage.tsx` 账户卡片操作区已有「停用/启用」文本按钮与 Token 撤销图标按钮；删除按钮并列新增。

## Requirements

### R1 服务端删除端点

- `DELETE /api/v1/users/:id?version=N`，`config: { authorization: "admin" }`（与 PATCH 同款路由配置）。
- 服务层校验：目标不存在 → 404；`role = admin` 或目标 = 当前请求者 → 400 `ACCOUNT_DELETE_FORBIDDEN`；`version` 不匹配 → 409（沿用 `VERSION_CONFLICT`）。
- 删除成功 → `204`（或无 body 的 200），sessions/access_tokens 级联清除。
- 删除后的 `listUsers` 不再包含该账户。

### R2 前端删除按钮

- 账户卡片头部操作区：停用/启用旁新增删除图标按钮（仅非 admin 卡片显示）。
- `window.confirm` 确认文案：用户名 + 「其全部会话与访问 Token 将一并失效」。取消则不请求。
- 成功 → 刷新 `users` 查询；失败 → 页面既有 form-error 展示（含 409/403 文案）。
- 删除进行中按钮禁用，防重复提交。

### R3 回归与验收

- 既有停用/启用、Token 生命周期、鉴权测试保持通过。
- 全仓 typecheck/test 通过。

## Out of scope（本期）

- 管理员账户的删除（D2，永远走停用）；批量删除；删除确认的两步输入（UI 仅 confirm）；审计/操作日志。

## 票据规划（按依赖顺序）

- 01 服务端：DELETE 端点 + 服务方法 + 测试（鉴权、边界、级联、版本冲突、404）。
- 02 Web 端：删除按钮 + 确认 + 错误展示 + 测试。
- 03 回归与验收：全仓 typecheck/test + 验收标准核对。

## 验收标准

1. Administrator 可删除任一非管理员账户；该账户会话与 Token 全部失效（列表不再出现、`/auth/me` 401、Token 调用 401）。
2. 非 Administrator 调用删除 → 403；删除 admin 或自己 → 400；不存在 → 404；版本过期 → 409。
3. Web 端删除需确认，成功后列表刷新，失败提示明确；删除后业务数据完好。
4. 既有停用/启用与 Token 管理功能无回归；全仓 typecheck/test 通过。
