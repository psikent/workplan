# 02 — 服务端能力授权与 Viewer 生命周期
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/server/src/app.ts、apps/server/src/types.ts、apps/server/src/modules/auth.ts、apps/server/src/routes/、apps/server/test/

## 背景

规格 R1–R3、R7 与 ADR-0003。当前服务端只识别普通认证和 Administrator 专属路由；Viewer 需要读取全部业务数据，同时被可靠地挡在每个业务 mutation 之外。由于高级搜索和自定义 XLS 导出使用 `POST`，权限不能按 HTTP 方法推断。

## 改动清单

1. 将 Fastify 路由授权元数据扩展为 `authorization?: "write" | "admin"`，默认表示已认证查询能力。
2. 在统一认证钩子中落实矩阵：Administrator 允许全部；Editor 允许默认查询和 `write`；Viewer 只允许默认查询。越权统一抛出 HTTP 403、`INSUFFICIENT_PERMISSION`，沿用现有中文错误信息。
3. 为全部非管理员业务 mutation 显式标记 `write`：Work Plan 新建、更新、日程更新、删除、排序；Recurring Rule 新建、附加、更新、删除；Monthly Goal 新建、更新、归档、关联、删除；Goal Recurrence 新建、更新、停止和解散。
4. 保持既有全局定义、导入、环境配置、用户和 Token 管理路由为 `admin`。
5. 保持 Work Plan 高级搜索、JSON 导出、模板 XLS 导出、自定义 XLS 导出及所有业务 GET 路由为查询能力；`POST /api/v1/work-plans/search` 和 `POST /api/v1/work-plans/export.xls` 不标记 `write`。
6. 登录、`/auth/me` 和退出继续可供 Viewer 使用；Cookie 会话的 CSRF/Origin 校验不因查询能力而放宽。
7. 泛化 AuthService 的账户创建与密码设置逻辑，使 Administrator 可创建和管理 Editor 或 Viewer；Administrator 自身不可停用/在此重设密码的限制保持不变。
8. Viewer 停用时复用现有语义：撤销会话和 Token；重新启用后旧凭据不恢复，由 Administrator 设置密码或签发新 Token。
9. 增加 API 测试矩阵：密码 Viewer、Token-only Viewer 的认证；全部查询/搜索/导出成功；全部 `write` 和 `admin` 请求返回 403；拒绝后表内容、排序和版本号不变；Administrator/Editor 行为无回归。

## 验收

- 服务端授权由路由能力决定，不依赖 HTTP 方法或前端状态。
- Viewer 可完成规格中的全部查询和导出；任何业务写入或管理员操作都稳定返回 403 且零副作用。
- Viewer 的创建、密码、Token、启停和认证生命周期与规格一致；server typecheck 和权限测试通过。

## Comments

