# 03 — 隔离实例真实浏览器验收
Type: task
Status: ready-for-agent
Blocked by: 02
Spec: ../spec.md
Scope: .scratch/gantt-cross-range-bar-label/qa/(证据目录)

## 背景

规格验收标准 2。历史教训:甘特视觉改动必须真实浏览器截图验收(jsdom 不应用样式表,测不出裁剪/层叠);真实库 `./data` 勿动,用临时 DATA_DIR + setup token + 临时账号。

## 步骤

1. 临时 DATA_DIR 起 server + web,setup token 建临时账号与字段(备注选项配色可顺带复验不回归)。
2. 造数:跨 2 周计划(如上周三 → 本周二)、跨 3 周计划、跨月计划、某周仅 1–2 天的计划、范围内对照计划。
3. 浏览器逐周/逐月打开截图核验:起始周/中间周/结束周条内文字均可见且居中于该周条段;月视图同验;窄段省略号 + 悬浮 tooltip 完整;范围内计划外观不变;浅/暗两主题复验。
4. 证据(截图 + 说明)存 `.scratch/gantt-cross-range-bar-label/qa/`,通过后在本文件 Comments 回填结论。

## 验收

- spec 验收标准 2 清单逐项通过并附截图证据。
