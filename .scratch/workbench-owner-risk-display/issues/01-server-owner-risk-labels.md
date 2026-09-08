# 01 — 服务端：工作台行投影负责人与风险标签
Type: task
Status: ready-for-agent
Blocked by: none
Spec: ../spec.md
Scope: apps/server/src/modules/workbench.ts、packages/contracts/src/index.ts、apps/server/test/*

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
