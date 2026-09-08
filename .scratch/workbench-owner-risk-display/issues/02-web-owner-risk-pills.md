# 02 — Web：工作台行内负责人药丸与风险徽章
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/OverviewPage.tsx、apps/web/src/components/*、apps/web/src/styles.css、apps/web/test/*

## Answer

实现于 e01991c。新组件 `RiskBadge.tsx`：`RiskBadge` 按label 映射 `risk-acceptable/low/medium/high` 四档配色（复用状态徽章 token），未知档回退 `risk-unknown` 中性灰保留文字；`OwnerBadge` 非空显示人名（slate 中性药丸＋圆点），null 显示虚线「未指定」（更弱中性）。三区块行第二行 `<small>` 内、起止时间之前插入 `.plan-meta-pills` 药丸组（`OverviewPage.tsx:68`）；提醒区块、汇总栏、空状态零改动；移动端规则只隐藏 `.status-badge`，药丸在 1fr 列内不受影响。

测试：`RiskBadge.test.tsx` 四档各一例＋未知回退＋null→未指定；`OverviewPage.test.tsx` 夹具升级 `WorkbenchPlan` 并新增用例钉住药丸位置（第二行内、时间之前）与状态徽章/起止时间不回归。web 308 用例全绿；隔离实例浏览器双主题（深/浅）截图验收：张三+中(琥珀)、未指定+低(绿)、李四+高(珊瑚红)、王五+可接受(灰)、张三+极高(未知回退灰) 全部正确。

## 背景

规格 R3/R4。三区块行标记在 `OverviewPage.tsx:67`：第二行为 `upcoming-title` 内 `<small>`（起止时间）。可复用 StatusBadge 药丸＋圆点模式（`components/StatusBadge.tsx`、`styles.css:255-260`）与四色 token（`styles.css:9-41`，含 `-text/-soft` 变体）；内联药丸先例 `reminder-type`（`styles.css:531-532`）。`ownerLabel`/`riskLabel` 由票据 01 随区块行下发。

## 改动清单

1. 新组件 `RiskBadge`（或与负责人药丸同文件的小组件）：接收 `label: string`，按 label 映射 class——可接受=slate、低=green、中=amber、高=coral（`risk-acceptable/risk-low/risk-medium/risk-high`）；未知 label 回退中性灰（保留文字）。
2. 负责人药丸：`ownerLabel` 非空显示人名（中性灰）；`null` 显示「未指定」（更弱的中性样式）。
3. `OverviewPage.tsx:67` 三区块行的 `<small>` 内、起止时间之前插入两枚药丸；提醒区块（`:61`）与汇总栏（`:56`）零改动。
4. `styles.css`：新增药丸样式（软底＋圆点＋小号，尺寸适配第二行），颜色全部复用现有 token，不新增色值。
5. 测试：四档配色各渲染一档；未知 label 灰色回退；`null` → 「未指定」；第二行仍含起止时间、StatusBadge 位置不变。

## 验收

- 对应规格 R3/R4 与验收标准 1/2/3/5。
- `corepack pnpm --filter @workplan/web typecheck && corepack pnpm --filter @workplan/web test` 全绿。
