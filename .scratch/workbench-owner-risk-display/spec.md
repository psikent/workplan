# Spec: 工作台展示负责人与风险等级（Workbench Owner & Risk Display）

> Status: **已实现**（e01991c，2026-09-08） — 票据索引：01 服务端负责人与风险标签投影 | 02 Web 负责人药丸与风险徽章。依赖：02 ← 01。
>
> 领域词汇：Risk Level（风险等级）、Work Plan 已入 CONTEXT.md，无需新增词条。无需 ADR：展示层规则、可逆，决策随本 spec 记录。

## Goal

工作台（OverviewPage）三个计划区块（今日新开工 / 今日继续开工 / 接下来的计划）的每一行，在标题下方第二行展示该作业的**负责人**（人名药丸）与**风险等级**（彩色药丸，四档四色）。今日提醒区块与顶部汇总保持现状。

## 决策记录（2026-09-08，与用户确认）

1. **展示范围**：仅三个计划区块；提醒区块、汇总栏不动。
2. **空值处理**：负责人未填显示灰色「未指定」；风险未填按词汇表默认值视为「低」。
3. **风险配色**：可接受=灰、低=绿、中=琥珀、高=珊瑚红——沿用状态徽章现有色板，不新增颜色。
4. **展示形式**：第二行小药丸（负责人中性药丸显示人名、风险彩色药丸），置于起止时间之前；与 StatusBadge 同款样式语言。

## Terms

See `CONTEXT.md`: **Work Plan**, **Risk Level (风险等级)**, **Work Owner Account**（本特性展示的是 owner 选项 label 即人名，不是映射账号）.

## Background facts

- 负责人与风险都是自定义字段（single_select）：key `owner`、key `risk`（选项 可接受/低/中/高，词汇表默认 低）。单选值持久化的是**选项 value**（`option_N`），语义在 label（`apps/server/src/modules/custom-fields.ts:353,409-414`）——展示人名/风险档位必须按定义把 value 换算成 label，不能直接渲染 `customFields` 里的原始值。
- 换算先例：提醒模块 `riskLabelOf()`（`apps/server/src/modules/reminders.ts:86-93`）按 `customFields.list(true)` 的定义做 value→label；工作台 `productionFilter()`（`apps/server/src/modules/workbench.ts:130-137`）是"按 label 解析定义"的同族先例。
- 工作台行由 `serializeRows` 产出完整 `workPlanSchema`（`apps/server/src/modules/work-plan-query.ts:719-761`）；`WorkbenchService.overview()`（`workbench.ts:41-125`）拿到行后可再投影。区块契约 `workbenchBlockSchema.items: WorkPlan[]`（`packages/contracts/src/index.ts:939-963`）。
- 前端约定（`OverviewPage.tsx:23`）：区块成员、计数与顺序全部来自服务端，前端不二次加工——**标签换算必须做在服务端**。
- 行现状（`OverviewPage.tsx:67`）：日期徽标 | 标题＋第二行起止时间 | StatusBadge | 箭头。第二行为 `upcoming-title` 内的 `<small>`。
- 可复用样式：StatusBadge 药丸＋圆点模式（`apps/web/src/components/StatusBadge.tsx`、`styles.css:255-260`）；reminder-type 内联药丸先例（`styles.css:531-532`）；四色 token `--slate/--green/--amber/--coral`（含 `-text/-soft` 变体，`styles.css:9-41`）。
- 词汇表已规定风险档位恰为四个 label；但字段定义是可配置数据——解析失败或 label 不在四档内时需要回退口径（见 R1/R3）。

## Requirements

### R1 服务端标签换算（代码级规则）

- 常量：字段 key `owner`、`risk`；风险四档 label 常量 `可接受/低/中/高`，默认 `低`（与提醒规则同为代码级规则，不做配置）。
- `overview()` 求值时经 `queryEngine.customFields.list(true)` 解析非归档 single_select 定义；对每个区块行的 `customFields.owner/risk` 值按选项 value→label 换算：
  - `ownerLabel: string | null` —— 值未填、字段/选项不可解析（缺失/归档/类型不符）均为 `null`；
  - `riskLabel: string` —— 值未填或不可解析一律回退默认 `低`；可解析则为该选项 label（可能是四档之外的自定义 label，原样下发）。

### R2 响应契约

- 新增工作台行 schema（`WorkPlan` 基础上加性字段 `ownerLabel`、`riskLabel`），`workbenchBlockSchema.items` 改用它；全局 `workPlanSchema` 不动（避免波及时间轴/抽屉等全部消费方，同提醒模块自有投影的先例）。

### R3 Web 展示

- 三区块每行第二行（起止时间之前）依次渲染：负责人药丸（`ownerLabel` 人名；`null` 显示灰色「未指定」）＋风险药丸（label 配色映射：可接受=灰、低=绿、中=琥珀、高=珊瑚红；label 不在四档内回退中性灰但保留文字）。
- 药丸样式沿用 StatusBadge 视觉语言（软底、圆点、小号），颜色复用现有 token；提醒区块、汇总栏、空状态无改动。

### R4 测试

- 服务端：值→label 换算正确（夹具选项 value 刻意≠label 钉死换算）；owner 未填/字段缺失 → `ownerLabel:null`；risk 未填/字段缺失/选项归档 → `riskLabel:"低"`；既有工作台用例零回归（无该字段的夹具走回退路径）。
- Web：四档配色各渲染一档＋未知 label 回退灰＋`null` 负责人显示「未指定」；第二行位置与既有元素不回归。

## 验收标准（Acceptance criteria）

1. 工作台三个计划区块每行第二行可见负责人药丸与风险彩色药丸；未填负责人显示「未指定」，未填风险显示绿色「低」。
2. 风险四档颜色：可接受灰、低绿、中琥珀、高珊瑚红；自定义档位 label 回退灰色仍显示文字。
3. 今日提醒区块与顶部汇总与改动前一致。
4. 标签换算在服务端完成（前端不访问字段定义）。
5. `pnpm typecheck` 与 `pnpm test`（server + web）全绿，既有用例零回归。
