# 02 — 删除按钮与确认流程（账户卡片）
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/AccountManagementPage.tsx、apps/web/src/pages/AccountManagementPage.test.tsx

## 背景
规格 R2 与决策 D3。服务端端点就绪后，在账户卡片操作区并列新增删除入口。

## 改动清单
1. `AccountManagementPage.tsx`：
   - 新增 `deleteUser` mutation：`DELETE /users/:id?version=N`（api helper 已支持 query），成功后 `invalidateQueries(["users"])`。
   - 卡片头部操作区（停用/启用文本按钮旁，仍仅非 admin 显示）加 Trash2 图标按钮，`aria-label`「删除 {username}」，禁用态与停用按钮一致。
   - 点击 → `window.confirm`（含用户名 + 「其全部会话与访问 Token 将一并失效，且不可恢复」）→ 确认后 mutate；取消不请求。
   - `deleteUser.error` 走既有 form-error 展示（区分 400/409 文案，显示服务端 detail）。
2. 测试（AccountManagementPage.test.tsx 模式）：
   - 渲染删除按钮仅出现在非 admin 卡片；
   - 点击后 confirm 被调用，取消 → 无请求；
   - 确认 → 调 `DELETE /users/{id}?version={version}` → 列表刷新（apiMock 返回更新后 users）；
   - deleteUser 失败 → 错误信息展示。

## 验收
- web typecheck/test 通过；删除按钮交互（确认/取消/失败）用例全绿。

## Comments

## Answer

- `AccountManagementPage.tsx`：新增 `deleteUser` mutation（`DELETE /users/{id}?version={version}`，成功 invalidate `["users"]` + toast「账户已删除」）；非 admin 卡片操作区新增 Trash2 图标按钮（`aria-label`「删除 {username}」，危险样式，pending 禁用）；点击先 `window.confirm`（含用户名 + 凭据一并失效且不可恢复），取消不请求；`deleteUser.error` 走页面底部 form-error。
- `AccountManagementPage.test.tsx` 新增 4 例：非 admin 卡片渲染删除按钮 / admin 无；取消 → 无请求且 confirm 文案正确；确认 → DELETE 调用 → 列表刷新 + 成功 toast；失败 → 错误信息展示。apiMock 新增 `DELETE /users/:id?version=` 分支。
- web 全量 219/219 通过。
