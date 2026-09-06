# 02 — 更新设计说明并完成资源验收

Type: task
Status: ready-for-agent
Spec: ../spec.md
Blocked by: 01
Scope: docs/design/DESIGN.md, web build and static asset acceptance

## 背景

规格 R4 与验收标准。设计说明仍把 `#3157df` 描述为当前强调色，而代码实际采用浅色 `#0891b2`、深色 `#22d3ee`；文档漂移会让后续品牌资源再次生成错误颜色。

## 改动清单

1. 将设计系统的强调色说明更新为浅色/深色青色主题值，并注明静态安装图标使用稳定的浅色品牌底色。
2. 检查 Vite PWA manifest 仍引用更新后的图标文件，且构建产物包含这些资源。
3. 运行 web build、`git diff --check`，并对生成资源做尺寸/格式/颜色抽查。
4. 记录验收结果；若发现与本规格无关的主题或布局问题，单独记录而不扩大本票范围。

## 验收

- `corepack pnpm --filter @workplan/web build` 通过。
- 构建产物的 manifest、favicon、Apple touch icon 和 PWA 图标均存在且可解析。
- `docs/design/DESIGN.md` 与 `styles.css` 的浅色/深色强调色定义一致。

## Comments

- 2026-09-06 grilling Q1/Q2：用户确认采用当前青色主题并全量更新静态品牌资源。

