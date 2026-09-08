# 02 — Web：工作台行内负责人药丸与风险徽章
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/OverviewPage.tsx、apps/web/src/components/*、apps/web/src/styles.css、apps/web/test/*

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
