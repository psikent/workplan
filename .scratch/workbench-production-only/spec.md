# Spec: 工作台只展示生产类工作（Workbench Production Scope）

> Status: **已定稿，待批准开发** — 票据索引：01 服务端生产类过滤与 scope 标记 | 02 Web 仅生产类标注。依赖：02 ← 01。
>
> 领域词汇：Plan Nature（计划性质）、Production Work（生产类工作）已入 CONTEXT.md。无需 ADR：代码级规则、可逆，决策随本 spec 记录。

## Goal

工作台（OverviewPage）的三个计划区块（今日新开工 / 今日继续开工 / 接下来的计划）与顶部状态汇总，只统计与展示 **Production Work**（计划性质 = 生产类）；未填计划性质或非生产类的计划不再出现在工作台。今日提醒保持全量。过滤生效时页面标注"仅展示生产类工作"。

## Terms

See `CONTEXT.md`: **Plan Nature (计划性质)**, **Production Work (生产类工作)**, **Starting Today (今日新开工)**, **Continuing Today (今日继续开工)**, **Upcoming Window (接下来的窗口)**.

## Background facts

- 判别数据已存在：自定义字段 **计划性质**（key `plan_nature`，single_select，选项 生产类/非生产类）。选项 `value` 是 `option_N`，语义在 `label`；单选值持久化于 `custom_field_values.text_value`（存选项 value：`apps/server/src/modules/custom-fields.ts:353`，写入前按 `option.value` 校验 `:409-414`）——**按 label 生产类解析出 value 再过滤，不能直接拿"生产类"当 value**。
- 查询引擎已支持单选自定义字段过滤：`custom.<key>` eq 按 `text_value` 比较（`apps/server/src/modules/work-plan-query.ts:664`、`:682-683`）；未填（NULL）不命中 eq → 天然实现"未填隐藏"（已决策：隐藏）。
- 引擎目录来自 `customFields.list(true)`（`work-plan-query.ts:203`），目录缺字段时过滤直接 422（`:548`）——工作台必须先自行解析定义，仅当可解析时注入过滤（缺失即回退不过滤，已决策）。`WorkPlanQueryEngine.customFields` 是公开构造属性（`:179`），`WorkbenchService` 可直接取用。
- 工作台服务端 `WorkbenchService.overview()`（`apps/server/src/modules/workbench.ts:36-113`）：三个区块 filters 写死时间窗 + 状态（`:53-92`），四个汇总计数独立发起（`:94-101`），全部经 `queryEngine.queryAt`；时区 Asia/Shanghai。路由 `GET /api/v1/workbench/overview` 仅收 `limit`（`apps/server/src/routes/workbench.ts:8-11`），本特性不改路由签名。
- 今日提醒是独立端点 `GET /api/v1/reminders`（规则表驱动），与工作台区块无共享查询，天然不受影响（已决策：不过滤）。
- 前端页头副标题在 `apps/web/src/pages/OverviewPage.tsx:55`；区块成员与计数全部来自服务端，前端不二次过滤（`:23` 注释约定）——因此口径必须做在服务端。
- `workbenchOverviewSchema` 在 `packages/contracts/src/index.ts:944`；加性字段向后兼容。

## Requirements

### R1 服务端生产类过滤（代码级规则）

- 常量：字段 key `plan_nature`、选项 label `生产类`（与提醒规则同一先例：代码级规则，不做管理员配置）。
- `overview()` 每次求值解析：非归档 `plan_nature` 定义 + 其非归档选项中 label 为 `生产类` 者的 value；两者齐备时生成 `{ field: "custom.plan_nature", op: "eq", value: <选项 value> }`，注入三个区块请求与四个汇总计数的 filters。
- 任一环节不可解析（字段不存在/已归档、选项不存在/已归档）→ 不注入过滤（工作台回退为展示全部）。

### R2 响应契约

- `WorkbenchOverview` 新增只读字段 `productionOnly: boolean`：true 表示本次响应按生产类过滤（R1 命中），false 表示回退全量。

### R3 汇总同口径

- `summary.all/pending/inProgress/completed` 与区块注入同一 filter（已决策：汇总只统计生产类）；回退时同样不过滤。

### R4 今日提醒不受影响

- 无代码改动，回归确认提醒仍覆盖全部计划（含非生产类/未填）。

### R5 Web 标注

- `productionOnly === true` 时页头副标题体现"仅展示生产类工作"（如：`仅展示生产类工作——今天需要关注的工作计划，一眼看清。`）；false 时保持现有文案。不加"查看全部"开关（已决策：需要全量去工作计划页）。

### R6 测试

- 服务端：字段与选项齐备时区块与汇总只含生产类（未填/非生产类不出现）；按 label 解析出 value 过滤；字段缺失/归档、选项缺失/归档各自回退全量且 `productionOnly:false`；既有工作台用例零回归（无该字段的夹具走回退路径，行为不变）。
- Web：标注随 `productionOnly` 切换；其余渲染不变。

## 验收标准（Acceptance criteria）

1. 工作台三个计划区块与顶部汇总只出现/统计计划性质=生产类的活跃计划；未填或非生产类的计划不出现。
2. `plan_nature` 字段或"生产类"选项被归档/删除后，工作台自动回退为显示全部，页面无生产类标注。
3. 今日提醒区块不受计划性质影响，非生产类计划的提醒照常显示。
4. 响应携带 `productionOnly`，前端标注据实切换。
5. `pnpm typecheck` 与 `pnpm test`（server + web）全绿，既有用例零回归。

## Out of scope

- "查看全部（含非生产类）"开关（已决策不做）。
- 管理员可配置判别字段/选项（已决策代码级规则）。
- 工作计划页、时间轴、甘特图、导出的任何过滤（全局列表口径不变）。
- 环境配置包、计划性质字段的选项管理（已有能力）。
- 提醒规则变更。
