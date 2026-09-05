# 02 — 暗色主题 Slate 落地
Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/src/styles.css

## 背景

规格 R2。暗色 `:root[data-theme="dark"]` 从中性炭灰（#101316/#181c20）整体切换为 Slate 深藏青系。依赖票据 01 的 token 化结构。

## 改动清单

1. 暗色 token 全量更新：画布 `#020617`、表面 `#0f172a`、浮层面 `#1e293b`、边框 `#1e293b`/`#18202f`、文字 `#e2e8f0`/`#94a3b8`（更弱 `#64748b`）、强调色 `#818cf8`/hover `#a5b4fc`、语义四色 amber-400/emerald-400/slate-400/rose-400（徽章文字 `#fcd34d`/`#6ee7b7`/`#cbd5e1`/`#fda4af`）。
2. Gantt 暗色条、今天高亮（沿用 --accent）、bar-label 描边等按规格 R2 填值。
3. 残余暗色覆盖规则中不得再出现字面色；hover/激活面等一律走 01 定义的 token。

## 验收

- 暗色主题下与票据 01 相同页面集合截图无异常：无白块、无旧炭灰残留、Gantt 条与状态徽章颜色符合语义。
- 移动端 390px 抽查（顶栏、抽屉、弹层）。
- `corepack pnpm --filter @workplan/web build` 通过。

## Comments

- 2026-09-05 grilling 拍板（Q2/Q3/Q4：Slate 底盘 + 文字降档、indigo-400 强调、参考页语义色）。

## Answer

- `:root[data-theme="dark"]` 全量替换为 Slate 深藏青 token（画布 #020617、表面 #0f172a、浮层 #1e293b、边框 #1e293b/#18202f、文字 #e2e8f0/#cbd5e1/#94a3b8、强调 #818cf8/#a5b4fc、语义 amber-400/emerald-400/slate-400/rose-400）。
- 原约 40 条「background/color 平行覆盖」暗色规则全部删除——颜色差异由两套 :root token 表达，暗色块仅剩 token 定义 + 「今天」高亮 3 条结构性规则（字面色已 token 化）。
- Gantt 暗色条：待开始 #fbbf24、进行中 #34d399、已完成 #64748b、已取消 #475569，今天高亮沿用 --accent。
- dark 模式截图（计划周/月、工作台、月目标、设置、抽屉、登录、移动 390）验收通过：无白块、无旧炭灰残留。

## Comments（追加）

- 2026-09-06 微调：「今天」药丸内提醒铃铛从琥珀改为 var(--accent-contrast)（与日期数字统一深藏青），hover 用透明度变化提示；琥珀在亮青底上撞色，用户在两个方向中选定「内容统一深色」。
