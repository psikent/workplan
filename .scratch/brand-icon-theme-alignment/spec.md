# Spec: 静态网站图标与青色主题对齐

> Status: **待审批** — 已完成 grilling；Q1/Q2 采用推荐方案，等待用户批准实施票据。

## Goal

让添加到 iOS 主屏幕、浏览器标签页和 PWA 安装入口看到的静态品牌图标，与当前 WorkPlan 网站的青色强调色一致，消除截图中旧靛蓝图标与页面主题不搭的问题。

## 已确认决议

| 决策 | 结论 |
| --- | --- |
| 品牌主色来源 | 以当前网站主题 token 为准；静态资源使用浅色主题强调色 `#0891b2`（cyan-600）。 |
| 深色主题 | 应用内 `BrandMark` 继续由 CSS token 使用深色强调色 `#22d3ee`（cyan-400）；静态安装图标保持单一稳定的 `#0891b2`，不创建按系统主题切换的第二套图标。 |
| 更新范围 | favicon SVG/ICO、iOS `apple-touch-icon`、PWA 普通图标、PWA maskable 图标、品牌预览图，以及生成这些资源的脚本。 |
| 图形范围 | 保留现有圆角日历图形、白色线稿、尺寸与 maskable 几何；只同步底色。 |

## Background facts

- `apps/web/src/components/BrandMark.tsx` 已使用 `var(--accent)`，因此应用内图标已跟随当前主题。
- `apps/web/scripts/generate-favicons.mjs` 仍把静态底色硬编码为 `#3157df`；`apps/web/public/favicon.svg` 也保留该旧值。
- 当前浅色主题 `--accent` 为 `#0891b2`，深色主题 `--accent` 为 `#22d3ee`；PWA manifest 已引用现有静态资源，不需要新增入口。
- 最近的青色主题提交已更新界面 token，但未重新生成静态品牌资源；本需求只补齐这一遗漏。

## Requirements

### R1 — 单一静态品牌色

生成器中的静态图标底色必须是 `#0891b2`；所有由它生成的静态品牌资源都必须由同一几何和颜色来源产生，不保留 `#3157df`。

### R2 — 入口完整覆盖

以下入口必须使用更新后的资源：浏览器 SVG/ICO favicon、iOS `apple-touch-icon`、PWA 192/512 普通图标、PWA 192/512 maskable 图标和品牌预览图。manifest 的文件名与 purpose 语义保持不变。

### R3 — 视觉与主题边界

保留当前日历 glyph、白色线稿、圆角和透明边缘；不把深色 CSS token 直接写进静态图标，也不引入第二套系统主题图标。`BrandMark` 代码不需要改动。

### R4 — 文档一致

设计说明中的强调色描述必须反映当前浅色/深色青色主题，避免以后依据旧的 `#3157df` 再生成资源。

## Out of scope

- 不改应用内 `BrandMark` 的图形或主题切换逻辑。
- 不改 PWA manifest 的安装行为、缓存策略、图标文件名或尺寸。
- 不改界面布局、状态色、Gantt 颜色或其他品牌文案。
- 不发布生产环境；实施阶段仅修改仓库资源并做构建/资源验收。

## Acceptance criteria

1. 生成脚本不再包含旧靛蓝 `#3157df`，静态资源生成后颜色与 `#0891b2` 一致，几何结构和尺寸未变化。
2. `favicon.svg`、ICO、Apple touch icon、四个 PWA 图标和预览图均已更新；manifest 仍能解析并引用这些文件。
3. `docs/design/DESIGN.md` 不再把 `#3157df` 作为当前强调色，并明确浅色 `#0891b2` / 深色 `#22d3ee`。
4. `corepack pnpm --filter @workplan/web build`、`git diff --check` 通过；必要时用构建产物核对 manifest 和静态资源可访问性。
5. 应用内 `BrandMark` 在浅色和深色主题仍分别显示当前 CSS token 颜色，且没有引入回归。

## Implementation tickets

- [01 — 对齐生成器并重生成静态品牌资源](issues/01-align-static-brand-assets.md)
- [02 — 更新设计说明并完成资源验收](issues/02-document-and-acceptance.md)

## Domain impact

本需求不新增或改变 WorkPlan 领域术语、业务规则、数据模型和 API 契约，因此不修改 `CONTEXT.md` 或新增 ADR。

