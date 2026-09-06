# 01 — 对齐生成器并重生成静态品牌资源

Type: task
Status: resolved
Spec: ../spec.md
Scope: apps/web/scripts/generate-favicons.mjs, apps/web/public/* icon assets

## 背景

规格 R1–R3。网站界面已从旧靛蓝切换到青色，但静态品牌生成器仍使用 `#3157df`，导致 iOS 添加到主屏幕时显示旧蓝色图标。

## 改动清单

1. 将生成器的静态底色改为浅色主题强调色 `#0891b2`。
2. 保留现有日历 glyph、白色线稿、圆角、透明边缘、普通/`maskable` 几何和全部尺寸。
3. 使用仓库现有的 web favicon 生成脚本重生成 `favicon.svg`、`favicon.ico`、`apple-touch-icon.png`、四个 PWA 图标和 `brand-preview.png`。
4. 不修改 `BrandMark.tsx`、PWA manifest 文件名/尺寸/purpose 或主题切换逻辑。

## 验收

- 生成器和 SVG 中无旧 `#3157df`。
- 所有生成资源的尺寸、格式和透明/白色 glyph 结构保持有效；静态底色为 `#0891b2`。
- 脚本重复运行不会产生额外差异。

## Comments

- 2026-09-06 grilling Q1/Q2：用户确认采用当前青色主题并全量更新静态品牌资源。

## Answer

- 生成器与 SVG 底色已切换为 `#0891b2`，日历 glyph、白色线稿、透明边缘和全部尺寸保持不变。
- 已重生成 favicon SVG/ICO、Apple touch icon、四个 PWA 图标和 `brand-preview.png`。
- 生成脚本二次运行保持幂等；生成资源均通过 `file` 尺寸/格式检查，预览图人工确认视觉与当前主题一致。
