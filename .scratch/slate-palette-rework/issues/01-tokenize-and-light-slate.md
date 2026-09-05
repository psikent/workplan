# 01 — 颜色 token 化重构 + 浅色 Slate 落地
Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/src/styles.css

## 背景

规格 R3/R4。styles.css 里浅色主题大量字面色（hover、auth-intro、offline-banner、toasts、goal-chip、sort-panel、annual-quick-edit、env-config、gantt fill/stroke、focus ring `#86a1ff`、斑马纹等）绕过了 `:root` 变量，暗色只能靠平行覆盖列表硬补——已两次复发漏适配 bug。本票把颜色全部变量化，同时按新浅色调色板填值。

## 改动清单

1. `:root`（浅色）token 按规格 R3 全量更新：画布 `#f8fafc`、表面 `#fff`、边框 `#e2e8f0`/`#f1f5f9`、文字 `#0f172a`/`#64748b`、强调色 `#6366f1`/hover `#4f46e5`/软底 `#eef2ff`、语义四色 amber-600/emerald-600/slate-500/rose-600（徽章文字与软底按规格）。
2. 新增 token：focus ring、hover 面、浮层面、斑马纹、gantt 条系列（默认条 + 四状态条/进度条、行线、刻度、bar-label 填充/描边）等；软底改同色低透明度。
3. 全文件字面色替换为 `var()`；涉及新 token 的规则就地改写，不改选择器与布局属性。
4. 暗色覆盖列表同步瘦身：凡变量能表达的暗色差异删除对应覆盖行。

## 验收

- 浅色主题下工作计划（列表 + 周/月时间轴）、工作台、月目标、设置各页、登录页截图无异常，观感为浅 Slate + indigo。
- grep 检查：两套 `:root` 变量区之外无颜色字面量。
- `corepack pnpm --filter @workplan/web build` 通过。

## Comments

- 2026-09-05 grilling 拍板（Q5：换色与收敛一起做；Q6/Q7/Q8：浅色 Slate 底盘、indigo-500 强调、参考页语义色）。

## Answer

- `:root` 全量替换为浅色 Slate + indigo-500 token（画布 #f8fafc、表面 #fff、边框 #e2e8f0/#f1f5f9、文字 #0f172a/#334155/#64748b、强调 #6366f1/#4f46e5、语义 amber-600/emerald-600/slate-500/rose-600）。
- 新增 token：--accent-soft-hover/--accent-line/--accent-ring/--accent-glow/--accent-contrast/--accent-panel-{bg,border}/--text-soft/--line-strong/--surface-{raised,hover,muted,veil}/--backdrop/--stripe/--focus-ring/--switch-{track,knob}/--shadow-{soft,medium,strong}/--gantt-*（bar、四状态、label、handle）。
- 软底全部改为同色低透明度；全文件字面色清零（grep 校验 0 处，白名单仅两套 :root）。
- 顺手修复：var(--ink)/var(--surface-soft) 两个从未定义的引用 → --text/--surface-muted；登录输入框 .input-with-icon 补 background: var(--surface)（旧代码从未设底色，暗色下露出 UA 灰底）。
- BrandMark.tsx 描边 #fff → var(--accent-contrast)；index.html theme-color 更新为 #f8fafc/#020617。
- web build 通过；浅色截图（计划周/月、工作台、月目标、设置、抽屉、登录、移动 390）验收通过。

## Comments（追加）

- 2026-09-05 强调色改判：用户实机后否决 indigo（#818cf8/#6366f1，不在参考页配色内），两套主题强调色一族（accent/hover/soft/line/ring/glow/panel/focus-ring/Gantt 默认条）整体换为参考页青色（暗 #22d3ee、浅 #0891b2，hover 分别 #67e8f9/#0e7490）。浅色按钮白字对比 ~3.7:1（13px 加粗标签，较原 indigo 4.46 略降，记录备查）。已确认所有字面 indigo 清零、token 完整性校验通过。
