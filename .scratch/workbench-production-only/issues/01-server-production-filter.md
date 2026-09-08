# 01 — 服务端：工作台生产类过滤与 scope 标记
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: apps/server/src/modules/workbench.ts、packages/contracts/src/index.ts、apps/server/test/*

## Answer

实现于 ed2d164。`productionFilter()` 经 `customFields.list(true)` 解析非归档 single_select `plan_nature` 及其非归档 label=「生产类」选项，恰好一个匹配才注入 `custom.plan_nature eq <value>` 到三区块与四计数，否则回退全量；审查采纳 P3 收紧——多个非归档选项同 label 视为歧义回退（而非静默取 sort_order 第一项）。`workbenchOverviewSchema` 加性新增 `productionOnly`。测试 `workbench-production-only.test.ts` 六例：齐备过滤（value 刻意≠label 钉死解析陷阱）+ 四例回退（字段缺失/字段归档/选项归档/类型不符/同 label 歧义）。server 212 用例全绿，隔离实例 API 验收通过。

## 背景

规格 R1/R2/R3。工作台三区块与四计数全部由 `WorkbenchService.overview()`（`apps/server/src/modules/workbench.ts:36-113`）经 `queryEngine.queryAt` 产生；引擎已支持 `custom.plan_nature` eq 过滤（单选按 `text_value`，NULL 不命中）。关键陷阱：单选 `text_value` 存的是选项 value（`option_N`），语义在 label——必须按 label=`生产类` 解析出 value 再过滤。引擎目录缺字段时过滤直接 422（`work-plan-query.ts:548`），故须先自行解析、可解析才注入。`WorkPlanQueryEngine.customFields` 为公开构造属性（`:179`）。

## 改动清单

1. contracts（`packages/contracts/src/index.ts:944` 起）：`workbenchOverviewSchema` 增加只读字段 `productionOnly: z.boolean()`（加性变更）。
2. `WorkbenchService`：
   - 模块级常量：`PLAN_NATURE_FIELD_KEY = "plan_nature"`、`PRODUCTION_OPTION_LABEL = "生产类"`（代码级规则，注释说明与提醒规则同一先例）。
   - `overview()` 求值时经 `this.queryEngine.customFields.list(true)` 解析：`key` 匹配、`archivedAt` 为空、类型 single_select 的定义；其 `options` 中 label 精确等于 `生产类` 且未归档的选项。
   - 齐备 → 生成 `{ field: "custom.plan_nature", op: "eq", value: <选项 value> }`，追加到三区块请求 filters 与四个汇总计数 filters；`productionOnly: true`。
   - 任一环节不可解析（字段缺失/归档/类型不符、选项缺失/归档）→ 不注入任何过滤，`productionOnly: false`（回退显示全部）。
   - 不改路由签名与 limit 语义；今日提醒不动。
3. 测试（新文件，沿用既有 server 测试风格；夹具用隔离库，不动 `./data`）：
   - 建字段（选项 生产类/非生产类）+ 三类计划（生产类/非生产类/未填）铺进三个时间窗，断言：三区块 items 只含生产类、summary 四项只统计生产类、`productionOnly === true`。
   - 回退三例：无 `plan_nature` 字段、字段已归档、"生产类"选项已归档 → 区块与汇总含全部计划、`productionOnly === false`。
   - 既有 workbench 测试零回归（其夹具无该字段，走回退路径行为不变）。

## 验收

- 对应规格 R1/R2/R3/R6 与验收标准 1/2/4/5。
- `corepack pnpm --filter @workplan/server typecheck && corepack pnpm --filter @workplan/server test` 全绿。
