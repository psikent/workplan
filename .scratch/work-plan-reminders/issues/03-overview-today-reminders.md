# 03 — 工作台「今日提醒」区
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/pages/OverviewPage.tsx、apps/web/src/pages/OverviewPage.test.tsx

## 背景
规格 R4。工作台「今天需要关注」区域追加「今日提醒」：今天提醒日的提醒 + 错过提醒日但仍未开始的计划（rule1 的「挂今天」已覆盖错过场景）。

## 改动清单
1. OverviewPage：拉取今日提醒（fetchReminders(today, today)），渲染「今日提醒」区块，与现有「接下来的工作计划」并列。
2. 每项显示：类型标识（检修单提醒 / 作业计划提交提醒）、触发计划标题 + 开始日期。
3. 交互：复用 Overview 现有的列表打开机制打开对应的 Work Plan 抽屉（若 Overview 目前无打开机制，本票顺带补齐最简版）。
4. 无今日提醒时不渲染该区块。

## 验收
- 工作台显示今日提醒（含错过挂今天的）；点击可打开对应计划；无提醒时无区块；web typecheck/test 通过。
