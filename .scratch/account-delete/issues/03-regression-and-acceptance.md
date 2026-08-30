# 03 — 回归与验收
Type: task
Status: resolved
Blocked by: 01, 02
Spec: ../spec.md
Scope: 全仓（必要时）

## 背景
规格 R3。收尾：确认删除功能未破坏既有账户管理语义，验收标准逐条核对。

## 改动清单
1. 回归确认：停用/启用、Token 生命周期（签发/撤销/过期）、角色鉴权（viewer 403）既有测试保持通过。
2. 全仓 `pnpm typecheck` 与 `pnpm test` 通过（contracts/server/web/scripts 全量）。
3. 对照 spec「验收标准」1–4 逐条核对，结果记入本票 Comments。

## 验收
- 验收标准 1–4 全部满足；回归全绿。

## Comments

## Comments

### 验收标准逐条核对（2026-08-30）

1. **删非管理员账户后会话与 Token 全失效** — `account-delete.test.ts`：删除后 `GET /users` 不含、cookie `/auth/me` 401、Bearer `/auth/me` 401、被删用户 sessions/access_tokens 行归零 ✅
2. **403/400/404/409 边界** — editor 删除 → 403；删 admin → 400 `ACCOUNT_DELETE_FORBIDDEN`；不存在 → 404；版本过期 → 409（先 PATCH 停用使 version+1）✅
3. **Web 确认流程** — confirm 含用户名与凭据失效提示；取消无请求；成功后列表刷新 + toast；失败展示 detail；业务数据行数不变 ✅
4. **回归** — 既有停用/启用、Token 生命周期、角色鉴权测试保持通过（server 132/132、web 219/219）；全仓 typecheck 通过 ✅（注：web 全量并发首次跑出现 3 个与本次改动无关的既有 flake，独立重跑即全绿）

## Answer

- 全仓回归全绿：contracts build、server 132、web 219、scripts 50、env-config-export 1；`pnpm typecheck` 通过。
- spec.md Status 更新为「已交付」；仅剩管理员用户删除（spec Out of scope）未覆盖。
