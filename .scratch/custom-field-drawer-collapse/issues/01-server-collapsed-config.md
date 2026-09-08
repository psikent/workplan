# 01 — 服务端+契约:字段定义新增 collapsed 配置
Type: task
Status: ready-for-agent
Blocked by: none
Spec: ../spec.md
Scope: packages/contracts/src/index.ts、apps/server/src/db/schema.ts、apps/server/src/db/migrate.ts、apps/server/src/modules/custom-fields.ts、apps/server/src/modules/env-config.ts、apps/server/test/*

## 背景

规格 R1/R2。字段定义表 `custom_field_definitions` 现无任何显隐列;契约 `updateCustomFieldSchema` 仅可更新 label/description/required/defaultValue/archived/version;环境包 `envConfigPackageFieldSchema` 已携带字段定义(含 sortOrder)。迁移为内联 DDL(`migrate.ts` 的 `migrations` 数组)。

## 改动清单

1. 契约(`packages/contracts/src/index.ts`):
   - `customFieldDefinitionSchema` 增输出字段 `collapsed: z.boolean()`。
   - `createCustomFieldSchema` 增可选 `collapsed`(缺省 false)。
   - `updateCustomFieldSchema` 增可更新 `collapsed`(与 required 同风格:可选键,显式传入才更新)。
   - `envConfigPackageFieldSchema` 增可选/必带 `collapsed`(与包内既有字段风格一致)。
2. DB(`schema.ts` + `migrate.ts`):`custom_field_definitions` 新增 `collapsed` 整数布尔列 NOT NULL DEFAULT 0;追加内联迁移 DDL。
3. `custom-fields.ts`:创建(写入 collapsed)、更新(可更新 collapsed,沿用 version 乐观锁与事务)、`serializeDefinition`/`list()` 序列化携带 collapsed。必填默认值等既有约束不动。
4. `env-config.ts`:导出包含每字段 `collapsed`;Additive Import 沿用"键已存在则跳过"现状;Sync Import 将 collapsed 作为安全(非破坏)变更对齐。
5. 测试(`apps/server/test/`,隔离库夹具,不动 `./data`):
   - 创建带 collapsed=true、缺省为 false;列表序列化包含 collapsed;更新切换 collapsed(含 version 冲突路径不回归)。
   - 环境包导出含 collapsed;Sync Import 对齐 collapsed;Additive Import 跳过既有键时本地 collapsed 不被覆盖。
   - 既有 custom-fields / env-config 用例零回归。

## 验收

- 对应规格 R1/R2 与验收标准 1 的 server 部分。
- `corepack pnpm --filter @workplan/server typecheck && corepack pnpm --filter @workplan/server test` 全绿。
