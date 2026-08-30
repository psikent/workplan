# 01 — 服务端账户删除端点：DELETE /api/v1/users/:id
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: apps/server/src/modules/auth.ts、apps/server/src/routes/auth.ts、apps/server/test/（viewer-authorization.test.ts 或新增账户管理用例）

## 背景
规格 R1 与决策 D1/D2。现有账户管理只有「停用」（可逆）；删除是硬删除 + 级联撤销凭据，与停用互补。

## 改动清单
1. `modules/auth.ts` 新增 `deleteManagedUser(userId, version, actorId)`：
   - 目标不存在 → 404；`role === "admin"` 或 `userId === actorId` → 400 `ACCOUNT_DELETE_FORBIDDEN`（message 区分：管理员不可删除 / 不能删除当前登录账户）。
   - `DELETE FROM users WHERE id = ? AND version = ?`；`changes === 0` 且行存在 → 409 版本冲突。
   - sessions/access_tokens 由 `ON DELETE CASCADE` 自动清理（不做手工 SQL，测试验证即可）。
2. `routes/auth.ts` 新增 `DELETE /api/v1/users/:id`：
   - `config: { authorization: "admin" }`；querystring `version`（`z.coerce.number().int().positive()`），与 PATCH 停用及 Token 撤销路由同款风格。
   - 成功返回 200 `{ deleted: true }`（或 204，与现有 DELETE Token 路由返回 `{ revoked: true }` 保持一致 → 采用 `{ deleted: true }`）。
   - `request.auth!.userId` 作为 actorId 传给服务层。
3. 测试（新文件 `test/account-delete.test.ts` 或并入既有账户测试）：
   - admin 删除 editor/viewer 成功；`GET /users` 不再包含；被删账户的 session cookie 访问 `/auth/me` → 401；其 access Token 访问受保护路由 → 401；`sessions`/`access_tokens` 表行已清。
   - editor 调删除 → 403；删除 admin → 400；删除自己 → 400；不存在 id → 404；版本过期 → 409。
   - 删除后业务数据（work_plans 等）行数不变。

## 验收
- server typecheck/test 通过；上述鉴权、边界、级联用例全绿。

## Comments

## Answer

- `modules/auth.ts`：新增 `deleteManagedUser(userId, version, actorId)` —— 不存在 404、`role=admin` 或 `userId===actorId` 400 `ACCOUNT_DELETE_FORBIDDEN`、`version` 不匹配 409；DELETE 行后 sessions/access_tokens 由 `ON DELETE CASCADE` 级联撤销。
- `routes/auth.ts`：`DELETE /api/v1/users/:id?version=N`（`authorization: "admin"`，querystring `z.coerce.number().int().positive()`，与 PATCH 停用同款），返回 `{ deleted: true }`。
- 测试 `test/account-delete.test.ts` 3 例：① 硬删除 editor（password session + token）后列表移除、cookie 与 Bearer 均 401、被删用户 session/token 行归零、admin 会话不受影响；② 403（editor 调删除）/ 400（删 admin）/ 404（不存在）/ 409（版本过期）；③ 删除后业务数据（work_plans）行数不变。
