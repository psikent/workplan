# 01 — 领域契约与认证迁移
Type: task
Status: resolved
Spec: ../spec.md
Scope: CONTEXT.md、docs/adr/、packages/contracts/src/index.ts、apps/server/src/db/、apps/server/test/migrate.test.ts

## 背景

规格 R1、R4、R7。领域词汇和 ADR 已记录 Viewer 及按路由能力授权的决定；当前共享契约和数据库角色约束仍只接受 `admin | editor`，必须先建立兼容的 `viewer` 基础。

## 改动清单

1. 将共享 `UserRole` 扩展为 `admin | editor | viewer`，用户响应允许 `role: "viewer"`。
2. 将现有 Editor-only 创建契约泛化为「可管理的非管理员账户」创建契约：角色接受 `editor | viewer`，并继续按 `loginMode` 区分密码和仅 Token 两种输入；保持现有请求字段、密码长度、Token 名称和到期时间校验。
3. 不新增角色更新 schema、角色转换 API 或默认 Viewer；未显式选择时，现有调用和界面仍以 Editor 为默认账户类型。
4. 更新 Drizzle 用户角色类型，并新增下一版本数据库迁移，使用户表约束接受 `viewer`。
5. 因现有 SQLite `CHECK` 约束不能原地扩展，迁移须安全重建用户及受其外键约束的认证表，复制全部用户、会话和访问 Token 字段，恢复索引和级联外键；不得重发凭据、改变哈希、版本号、启停状态或角色。
6. 增加迁移测试：从当前版本数据库构造 Administrator、Editor、有效会话和有效 Token，升级后逐字段一致、既有凭据仍可关联、新增 Viewer 可写入，并且 `PRAGMA foreign_key_check` 无结果。
7. 更新契约类型测试或编译引用，确保 `@workplan/contracts` 构建产物包含 Viewer。

## 验收

- 共享契约可验证密码 Viewer 和 Token-only Viewer，同时保持既有 Editor 请求有效。
- 新数据库与升级数据库都接受 `viewer`；升级不改变任何现有认证数据。
- 不存在修改账户角色的契约或迁移副作用；迁移测试和 contracts typecheck 通过。

## Comments

- 后续发现（08-30）：迁移 9 的 `foreign_key_check` 曾做全库检查，会被与本迁移无关的历史脏数据（如指向已删除计划的 custom_field_values 遗留行，开发库 v8 阶段即存在）卡死，阻塞升级。已改为只校验重建的 users/sessions/access_tokens 三表（`verifyTables`）；migrate.test.ts 新增「历史悬挂引用不阻断迁移」回归用例。

## Answer

- `packages/contracts/src/index.ts`：`userRoles` 扩展为 `admin | editor | viewer`，新增 `manageableUserRoles`/`manageableUserRoleSchema`/`ManageableUserRole`；创建契约由 Editor-only 泛化为 `createManagedUserSchema`（`createPasswordManagedUserSchema` + `createTokenOnlyManagedUserSchema`），角色接受 `editor | viewer`、必须显式传入、拒绝 `admin`，密码/Token 校验规则不变；未新增角色更新 schema。`CreateManagedUser` 类型已导出。
- `apps/server/src/db/migrate.ts`：新增迁移 09 `viewer_role_support`。因事务内 `PRAGMA foreign_keys` 是空操作，迁移运行器新增 `requiresForeignKeysOff` 分支：开启事务前读并关闭外键，事务内执行重建并在提交前运行 `PRAGMA foreign_key_check`（有悬挂引用则回滚），finally 恢复原状态。SQL 按 SQLite 官方流程重建 `users`/`sessions`/`access_tokens`（新建 → 复制全字段 → 删旧 → 改名 → 恢复三个索引），CHECK 扩展为接受 `viewer`；不改哈希、版本号、启停状态和角色。
- `apps/server/test/migrate.test.ts`：版本号断言更新为 9；新增用例从 v8 数据库构造 Administrator、Editor、有效会话、有效 Token，逐字段断言升级后一致、凭据 JOIN 仍可关联、可插入 Viewer、拒绝 `guest` 角色、`foreign_key_check` 为空且外键开关恢复；v4/v5 fixture 补齐真实 v1+ 库一直存在的 `sessions`/`users` 表。
- `apps/server/src/routes/auth.ts` 仅将导入改用 `createManagedUserSchema`（编译修正）；创建/密码/Token 生命周期逻辑归票据 02。
- 新增 `packages/contracts/test/contracts.test.mjs`（node --test 直接从 src 导入）验证构建源包含 Viewer：密码/Token-only Viewer 可解析、Editor 请求仍有效、`admin`/未知角色被拒、无默认角色。
- 验证：`corepack pnpm typecheck` 全绿；contracts 测试 5/5、server 测试 104/104 通过。

CONTEXT.md 与 ADR-0003 在规格阶段已记录 Viewer 词汇与按路由能力授权的决定，本票无需再改。
