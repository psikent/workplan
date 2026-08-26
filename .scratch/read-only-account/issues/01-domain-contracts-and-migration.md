# 01 — 领域契约与认证迁移
Type: task
Status: ready-for-agent
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

