# 01 — 服务端+契约:单选选项 color 配置
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: packages/contracts/src/index.ts、apps/server/src/db/schema.ts、apps/server/src/db/migrate.ts、apps/server/src/modules/custom-fields.ts、apps/server/src/modules/env-config.ts、apps/server/test/*

## 背景

规格 R1/R2。`custom_field_options`(`schema.ts:108-120`)与 `customFieldOptionSchema`(contracts `:572-579`)均无颜色;选项写路径:定义创建 `createCustomFieldSchema.options`(value/label,`:606-609`)、选项创建 `createCustomFieldOptionSchema`(`:622-625`)、选项更新 `updateCustomFieldOptionSchema`(label/archived/version,`:627-631`);环境包选项形状继承自创建契约(`envConfigPackageFieldSchema`,`:769-771`),差异条目 `envConfigOptionPlanItemSchema`(`:856-862`)现仅 value/label。迁移为内联 DDL(`migrate.ts` migrations 数组)。色板见 spec「预设色板」(8 hex)。

## 改动清单

1. 契约(`packages/contracts/src/index.ts`):
   - 导出色板常量(如 `customFieldOptionColorPalette: readonly string[]`,8 个 hex)与色值校验(成员 `z.string().refine` 或 enum;null=无色)。
   - `customFieldOptionSchema` 增输出 `color: z.string().nullable()`。
   - `createCustomFieldSchema.options[]`、`createCustomFieldOptionSchema` 增可选 `color`;`updateCustomFieldOptionSchema` 增可选 `color`(可传 null 清除,未传保持现状,version 乐观锁沿用)。
   - `envConfigOptionPlanItemSchema`(result 经 extend 自动继承)增可选 `color` 携带。
2. DB(`schema.ts` + `migrate.ts`):`custom_field_options` 新增 `color TEXT NULL`;追加内联迁移,只加列不回填。
3. `custom-fields.ts`:定义创建(选项批量)、选项创建、选项更新路径写入 color;序列化输出 color;非法色值(非色板内且非 null)拒绝,错误信息含字段/选项定位。
4. `env-config.ts`:导出选项携带 color;Sync 差异比对纳入 color(color-only 差异 → `update_option`,grade=safe);Additive 跳过既有键时本地 color 不被覆盖。
5. 测试(`apps/server/test/`,隔离库夹具,不动 `./data`):
   - 定义创建带选项 color;选项创建带 color;选项更新设置/清除 color(含 version 冲突路径不回归);非法色值拒绝;序列化含 color(null 与值两态)。
   - 环境包导出含 color;Sync 对齐 color(safe);Additive 跳过不覆盖本地 color。
   - 迁移既有库加列后 color 全 null。
   - 既有 custom-fields / env-config / migrate 用例零回归。

## 验收

- 对应规格 R1/R2 与验收标准 1 的 server 部分。
- `corepack pnpm --filter @workplan/server typecheck && corepack pnpm --filter @workplan/server test` 全绿。

## Comments

### 2026-09-09 实施完成

- 契约：导出 `customFieldOptionColorPalette`（8 hex）与 `customFieldOptionColorSchema`（色板 refine 校验）；`customFieldOptionSchema` 输出 `color: string | null`；定义创建 options[]、选项创建、选项更新三写路径增可选 color（null=清除，未传=保持现状）；`envConfigOptionPlanItemSchema` 增可选 color（result 经 extend 继承）。
- DB：`custom_field_options.color TEXT NULL`（schema.ts）+ 内联迁移 v16 `custom_field_options_color`（migrate.ts），只加列不回填。
- 服务端：`assertOptionColor` 服务层复检（兜住环境包导入等绕过 HTTP 的路径）；创建/选项创建/选项更新写入 color，`updateOption` 未传保持现状、传 null 清除，乐观锁沿用；序列化输出 color。
- env-config：导出携带 color；Sync `planOptionDiff` 纳入 color（color-only 差异 → `update_option` grade=safe），执行路径写入 color；Additive 沿用 key_exists 跳过，本地 color 不被覆盖。
- 测试：新增 `apps/server/test/custom-field-option-color.test.ts`（创建带色、设置/清除/不传三态、version 冲突 409、非法色 422 三写路径、Sync 收敛为 safe update_option、Additive 跳过不覆盖、8 色板全接受）；migrate 断言 15→16 并新增加列不回填用例；env-config 导出/计划/结果断言随 color 形状同步。server 230 用例全绿，typecheck 绿。
