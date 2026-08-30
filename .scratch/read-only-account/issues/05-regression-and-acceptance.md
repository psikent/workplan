# 05 — 回归与验收
Type: task
Status: resolved
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

## Answer

全部于 2026-08-30 在本机完成验证，证据如下。

### 1. 服务端权限矩阵（apps/server/test/viewer-authorization.test.ts，6 用例）

- 逐类覆盖：Administrator（全部能力）、Editor（查询+写入、admin 路由 403）、密码 Viewer（会话）、Token-only Viewer（Bearer）、未认证（401）。
- 两个 POST 查询被特别锁定：`POST /api/v1/work-plans/search` 与 `POST /api/v1/work-plans/export.xls` 对两类 Viewer 返回 200；JSON 导出、模板 XLS、提醒、全部业务 GET 均可用；登录/`/auth/me`/退出可用。
- 业务写入矩阵：Work Plan 新建/更新/日程/删除/排序、Recurring Rule 新建/附加/更新/停止、Monthly Goal 快速编辑/新建/更新/删除、Goal Recurrence 新建/更新/停止/解散（共 17 项）对两类 Viewer 均 `403 INSUFFICIENT_PERMISSION`；admin 矩阵（用户、Token、自定义字段、负责人映射、导入、导出模板、XLS 导入、环境配置，共 24 项）同样全部 403。
- 越权零副作用：矩阵执行前后业务快照（工作计划含排序与版本号、重复系列、月目标、目标系列、自定义字段、负责人映射、导出模板、用户与 Token）逐字段相等。
- 生命周期：停用即撤销会话与 Token；重新启用旧凭据不恢复；重设密码/重签 Token 后可用。

### 2. 数据库升级（apps/server/test/migrate.test.ts）

- v4→v9、v5→v9、v8→v9 三条升级路径均保留用户、密码哈希、会话、Token 的全部字段；既有凭据 JOIN 仍可关联。
- 升级后与全新数据库均可写入 `viewer`，`guest` 等非法角色仍被 CHECK 拒绝；`PRAGMA foreign_key_check` 无结果，外键开关恢复原状态。

### 3. 前端回归（212 个 web 测试）

- 新增：Viewer 写入口缺失与只读提示、账户管理两种 Viewer 创建 payload 与文案、无角色转换入口、抽屉只读、Gantt 只读不触发双击/拖拽 mutation（可写路径仍触发，双向回归）、Monthly Goal 无写入口、搜索与导出仍可用。
- 既有 Administrator/Editor 交互测试全部原样通过（含 editor 权限、列设置、排序、导出、环境配置等）。

### 4. 全仓命令结果

- `corepack pnpm typecheck` → 退出码 0（contracts/server/web 全部通过）。
- `corepack pnpm test` → 运行两次均全绿：contracts 5/5、server 7 文件 110/110（含 viewer-authorization 6 用例）、web 16 文件 212/212、scripts/workplan+release 50/50、env-config 1/1。
- `corepack pnpm build` → 退出码 0。

### 5. 手工验收（scripts/acceptance-viewer.mjs，对构建产物启动真实生产模式服务执行，37 项全部 PASS）

覆盖：一次性令牌初始化管理员；创建密码/Token-only Viewer；密码 Viewer 登录与两类 Viewer `/auth/me role=viewer`；10 类业务查询 + 高级搜索 + JSON/模板 XLS/自定义 XLS 导出（会话与 Token 双通道）；8 类越权请求（新建/修改/删除计划、新建目标、新建重复规则、用户列表、自定义字段、数据导入）均 403 `INSUFFICIENT_PERMISSION` 且数据零变化；Web 静态资源可访问；停用后 Token/会话立即失效、重新启用旧凭据不恢复、重设密码后可重新登录。脚本保留在 `scripts/acceptance-viewer.mjs` 可重复执行。

### 6. README

已在功能实现后更新「数据与安全」：新增只读账户能力与边界、角色固定的账户管理说明、停用撤销凭据语义，并注明前端限制仅为体验、服务端授权是最终边界。

### 待用户确认

- `spec.md` 状态按约定待用户确认后再从「待开发」改为「已实现」。
