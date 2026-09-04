# Spec: 全站配色切换到 Slate 体系（runtime-architecture 参考）

> Status: **已实施** — 票据 01–03 resolved（2026-09-05）；04（登录页主题偏好 quirk，既有问题）另立待分诊。typecheck/test 全绿，截图矩阵与对比度验收通过。

## Goal

把 web 端深浅两套主题的配色整体切换到 `docs/architecture/runtime-architecture.html` 使用的 Tailwind Slate 体系：中性底盘换成蓝调深空感（暗色）/纸感浅灰（浅色），强调色统一为 indigo 族，状态语义色采用参考页色相；同时把散落在 styles.css 里的硬编码颜色全部收敛为 CSS 变量，根治「新增类漏适配暗色主题」这类已复发两次的 bug。

## 决议记录（grilling Q1–Q8）

| # | 决策 | 结论 |
| --- | --- | --- |
| Q1 | 范围 | 暗色 + 浅色都换 |
| Q2 | 暗色中性底盘 | Slate 底盘，主文字降档 #e2e8f0（不照搬参考页纯白） |
| Q3 | 暗色强调色 | 冷蓝 indigo-400 #818cf8 |
| Q4 | 语义色 | 采用参考页色相（琥珀/翠绿/蓝灰/玫红），徽章 + Gantt 同步 |
| Q5 | 工程深度 | 换色与「收敛 CSS 变量」一起做 |
| Q6 | 浅色中性底盘 | 参考页浅色 Slate |
| Q7 | 浅色强调色 | 冷蓝 indigo-500 #6366f1 |
| Q8 | 浅色语义色 | 参考页浅色语义色 |

## Background facts

- 当前配色全部在 `apps/web/src/styles.css`：`:root`（浅色，L3-27）、`:root[data-theme="dark"]`（L455-477）+ 约 60 行暗色覆盖规则；除此之外有大量散落字面色（hover 面 `#22272d`、gantt 斑马纹 `#1d2227`、半透明表面 `rgb(16 19 22 / …)`、focus ring `#86a1ff`、goal-chip `#26304a` 等）。
- 历史教训（2026-09-01、2026-09-04 两次）：新增带浅色字面底的类如果不进暗色覆盖列表，暗色下就出白块——所以本次把颜色全部变量化。
- Gantt 第三方样式来自 `frappe-gantt/dist/frappe-gantt.css`（vite alias `frappe-gantt-style`），继续用 `.gantt-mount` 覆盖，不改第三方文件。
- 主题切换逻辑（localStorage `workplan:theme:v1`）不动。

## Requirements

### R1 设计基调

深浅两套统一切换为 Slate 体系 + indigo 强调色 + 参考页语义色相；布局、尺寸、字体、间距、交互全部不变。

### R2 暗色调色板

| 角色 | 值 | 说明 |
| --- | --- | --- |
| 画布 --canvas | `#020617` | slate-950 深藏青 |
| 表面 --surface | `#0f172a` | slate-900，卡片/抽屉/表格 |
| 浮层面 | `#1e293b` | slate-800，弹层/表头/hover 面/激活面 |
| 边框 --line | `#1e293b` | 主边框 |
| 弱边框 --line-soft | `#18202f` | 行分隔线（约 slate-800/60 叠在 surface 上的等效实色） |
| 主文字 --text | `#e2e8f0` | slate-200（不照搬参考页纯白，防大表格刺眼） |
| 弱文字 --muted | `#94a3b8` | slate-400；更弱一档 `#64748b`（slate-500） |
| 强调色 --accent | `#818cf8` | indigo-400；hover `#a5b4fc`（indigo-300）；软底同色 α≈15% |
| 待开始 | `#fbbf24` | amber-400；徽章文字 `#fcd34d`，软底 α≈13% |
| 进行中 | `#34d399` | emerald-400；徽章文字 `#6ee7b7`，软底 α≈13% |
| 已完成 | `#94a3b8` | slate-400；徽章文字 `#cbd5e1`，软底 α≈14% |
| 已取消 | `#fb7185` | rose-400；徽章文字 `#fda4af`，软底 α≈12% |

Gantt 暗色条：进行中 `#34d399`/`#059669`，待开始 `#fbbf24`/`#d97706`，已完成 `#64748b`/`#475569`，已取消 `#475569`/`#334155`，默认条 `#818cf8`/`#6366f1`；「今天」高亮沿用 --accent。

### R3 浅色调色板

| 角色 | 值 | 说明 |
| --- | --- | --- |
| 画布 --canvas | `#f8fafc` | slate-50 |
| 表面 --surface | `#ffffff` | 卡片纯白 |
| 边框 --line | `#e2e8f0` | slate-200；弱边框 --line-soft `#f1f5f9`（slate-100） |
| 主文字 --text | `#0f172a` | slate-900 |
| 弱文字 --muted | `#64748b` | slate-500 |
| 强调色 --accent | `#6366f1` | indigo-500；hover `#4f46e5`（indigo-600）；软底 `#eef2ff`（indigo-50） |
| 待开始 | `#d97706` | amber-600；徽章文字 `#92400e`，软底 α≈12% |
| 进行中 | `#059669` | emerald-600；徽章文字 `#065f46`，软底 α≈12% |
| 已完成 | `#64748b` | slate-500；徽章文字 `#334155`，软底 α≈12% |
| 已取消 | `#e11d48` | rose-600；徽章文字 `#9f1239`，软底 α≈10% |

Gantt 浅色条：进行中 `#10b981`/`#059669`，待开始 `#f59e0b`/`#d97706`，已完成 `#94a3b8`/`#64748b`，已取消 `#cbd5e1`/`#94a3b8`，默认条 `#a5b4fc`/`#818cf8`。

软底（-soft）统一改为同色低透明度叠加（浅色 α≈10–15%、暗色 α≈12–16%），不再为每个语义色维护深浅两套实色 hex；表格斑马纹、hover 面同理走 token。

### R4 颜色变量收敛（工程）

- `styles.css` 中所有字面颜色（含 focus ring、阴影色、auth-intro、offline-banner、toasts、update-prompt、goal-chip、sort-panel、annual-quick-edit、env-config、gantt fill/stroke/text、disabled 面、斑马纹等）全部迁入 `:root` / `:root[data-theme="dark"]` token；普通规则里不再出现字面色。
- 新增 token 至少包括：focus ring、hover 面、浮层面、斑马纹、gantt 条系列；命名沿用现有风格（`--surface-hover` 等），具体名单实现时定。
- 暗色覆盖规则里不再出现字面色；能通过变量在两套 `:root` 中表达的就删掉对应覆盖行，仅保留确有必要的结构型覆盖（如 gantt bar-label 描边翻转也改为 token）。

### R5 覆盖面

登录页（含 auth-intro）、开机屏、移动端顶栏（≤720px）、工作计划列表与周/月时间轴、工作台四分组、月目标（含年度快捷编辑）、设置各页（字段/账户/导出/env-config/Bark）、排序面板、各弹层与 toast 全部走新 token；桌面与移动 390px 均需截图抽查深浅两主题。

## Out of scope

- 布局/尺寸/间距/字体/圆角/阴影结构（仅允许阴影颜色随 token 微调）；交互与文案；后端；frappe-gantt 第三方 CSS 文件本身；主题切换逻辑与存储格式。

## 验收标准

1. `pnpm run typecheck` + `pnpm test` 全绿。
2. `styles.css` 中 `:root` 两套变量之外 grep 不到颜色字面量（`#[0-9a-f]{3,8}` / `rgb(` 白名单仅限变量定义区）。
3. 桌面 + 移动 390px 截图抽查（工作计划列表 + 周/月时间轴、工作台、月目标、设置、登录页）：深浅两主题下无不可读文本、无残留旧炭灰块或白块；Gantt 条颜色与状态语义一致。
4. 正文文字对比度对各自底盘 ≥ 4.5:1，弱文字 ≥ 3:1。
