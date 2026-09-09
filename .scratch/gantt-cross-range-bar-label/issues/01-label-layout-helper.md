# 01 — 纯函数:可见条段条内文字布局计算 + 单测
Type: task
Status: resolved
Blocked by: none
Spec: ../spec.md
Scope: apps/web/src/components/(新 helper 文件或并入 GanttTimeline.tsx)、对应测试文件

## 背景

规格 R1/R2。现状三处标签定位(`GanttTimeline.tsx:807-808、:672-680、:1058`)各自内联「全跨度中点」,跨周/跨月计划中点落画布外即整体不可见(根因见 spec Background facts)。本票据先落纯函数与单测,不动 DOM 接线。

## 改动清单

1. 新增纯函数(建议名 `layoutBarLabel`),签名近似 `layoutBarLabel({ barX, barWidth, canvasWidth, text, measureText }) → { x, text }`:
   - 可见条段 `[max(barX, 0), min(barX + barWidth, canvasWidth)]`,初始锚点 = 段中点;
   - `measureText(text)` 返回宽 w > 0 时:锚点 ± w/2 出 `[0, canvasWidth]` → 平移钳入画布(左缘 ≥ 0 且右缘 ≤ canvasWidth);w > canvasWidth → 单行截断(逐字或二分收敛)追加「…」后钳入;
   - `measureText` 缺失/返回 0/非有限值 → 仅返回段中点锚点与原文本(退化路径,jsdom 渲染测试依赖);
   - 不接触 DOM,measure 由调用方注入。
2. 单测:左出界(负 barX)/右出界(条尾超画布)/范围内(= 条中心,对齐既有断言语义)/整周段/钳制平移两向/截断含「…」/测宽 0 退化。

## 验收

- `corepack pnpm --filter @workplan/web test` 新用例全绿;函数无 DOM 依赖。
- 对应 spec R1/R2。

## Comments

### 2026-09-09 实施完成

- `GanttTimeline.tsx` 新增导出纯函数 `layoutBarLabel({ barX, barWidth, canvasWidth, text, measureText }) → { x, text }`：可见条段 `[max(barX,0), min(barX+barWidth, canvasWidth)]` 中点为初始锚点（对出界退化输入额外钳入 `[0, canvasWidth]` 保证全函数）；`measureText` 有效（有限且 >0）时先平移钳入（钳不住时左缘 ≥ 0 优先），`w > canvasWidth` 时逐字收敛为「前缀 + …」再钳入；测宽缺失/0/非有限 → 退化为仅锚定不改文本。无 DOM 依赖，measure 注入。
- 单测 7 例入 `GanttTimeline.test.tsx`（范围内=条中心、整周段=画布中点、左出界残段锚定、右出界钳入、贴左缘窄条钳回、截断收敛含…、退化三态）。TDD 红灯先行（函数未导出 7 失败 → 实现 → 44/44 绿）。首版测试两处钳制用例把 10 字 × 10px 误算为 200px 宽未触发钳制，属测试数据算术错误，修正为 20 字后全绿。
