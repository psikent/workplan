# 01 — 服务端：工作台行投影负责人与风险标签
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: apps/server/src/modules/workbench.ts、packages/contracts/src/index.ts、apps/server/test/*

## Answer

实现于 e01991c。contracts 新增 `workbenchPlanSchema = workPlanSchema.extend({ ownerLabel, riskLabel })`（加性，全局 `workPlanSchema` 不动），`workbenchBlockSchema.items` 改用之。`WorkbenchService.overview()` 求值时 `customFields.list(true)` 只取一次定义（审核采纳 P3：与 productionFilter 共用，同提醒模块复用先例），`optionLabelIndex` 按非归档 single_select 建选项 value→label 映射；`projectRow` 投影三区块行——owner 不可解析（未填/字段缺失/归档/类型不符/选项归档/值非字符串）为 null，risk 同类回退「低」，可解析 label（含四档外自定义档）原样下发。

测试 `workbench-owner-risk.test.ts` 五例：value 刻意≠label 钉死换算（acct_zhang↔张三、opt_medium↔中）、owner/risk 未填、字段缺失、类型不符（short_text，审核采纳 P3 补例）、选项归档（owner 回退 null、risk 回退「低」、未归档行不受影响）。server 217 用例全绿（含既有 workbench/production-only 零回归），隔离实例 API 实测 overview 行携带正确 label。

## 背景

规格 R1/R2。单选自定义字段持久化的是选项 value（`option_N`），语义在 label；工作台行现为完整 `workPlanSchema`（`serializeRows`，`apps/server/src/modules/work-plan-query.ts:719-761`），`WorkbenchService.overview()`（`workbench.ts:41-125`）取得行后需自行换算。换算先例：`reminders.ts:riskLabelOf`（`:86-93`）、`workbench.ts:productionFilter`（`:130-137`）。前端约定不二次加工（`OverviewPage.tsx:23`），故必须服务端下发。

## 改动清单

1. contracts（`packages/contracts/src/index.ts:939-963`）：新增 `workbenchPlanSchema = workPlanSchema.extend({ ownerLabel: z.string().nullable(), riskLabel: z.string() })`；`workbenchBlockSchema.items` 改为 `workbenchPlanSchema[]`。全局 `workPlanSchema` 不动。
2. `WorkbenchService`：
   - 模块级常量：`OWNER_FIELD_KEY = "owner"`、`RISK_FIELD_KEY = "risk"`、风险默认 label `低`。
   - `overview()` 求值时经 `queryEngine.customFields.list(true)` 解析两字段非归档 single_select 定义，建立 value→label 映射。
   - 三个区块行逐一投影：`ownerLabel` = 值可换算的 label，否则 `null`；`riskLabel` = 值可换算的 label（含四档外自定义 label 原样下发），否则 `低`。
   - 字段缺失/归档/类型不符不报错，走上述回退；不改路由签名与过滤逻辑。
3. 测试（新文件，隔离库夹具，不动 `./data`）：
   - 换算正确：选项 value 刻意≠label（如 `option_2`↔「中」），断言行携带 `ownerLabel:"张三"`、`riskLabel:"中"`。
   - 回退：owner 未填→`null`；risk 未填 / 字段缺失 / 选项归档→`"低"`。
   - 既有 workbench 测试零回归（夹具无字段走回退路径）。

## 验收

- 对应规格 R1/R2/R4 与验收标准 2/4/5。
- `corepack pnpm --filter @workplan/server typecheck && corepack pnpm --filter @workplan/server test` 全绿。
