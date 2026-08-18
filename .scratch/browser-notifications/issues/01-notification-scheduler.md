# 01 — Web: 通知调度器（lib/notifications.ts）
Type: task
Status: ready-for-agent
Blocked by: none
Spec: ../spec.md
Scope: apps/web/src/lib/notifications.ts（新增）

## 背景
规格 R2/R3。纯客户端调度：从已获取的 Work Plan 列表计算下一次「有效状态变为 in_progress」或提前提醒的触发时刻，布防 setTimeout；事件驱动重排；去重；可见性降级。禁止任何服务端存储或推送基础设施。

## 改动清单
1. 计算触发时刻：对每个计划取 startAt（忽略被手动覆盖抑制的开始通知，respect Manual Status Override），支持 leadMinutes 提前量；有效状态推导复用 deriveWorkPlanStatus 语义。
2. 调度：仅在 7 天水平线内布防（避免 timer 溢出），取最近下一触发点 setTimeout；触发后立即重排到下一个计划。
3. 重排时机：数据刷新（暴露刷新接口）、window focus、visibilitychange、页面唤醒；触发后清理旧 timer。
4. 发送策略：document.visibilityState 可见时走应用内 toast 回调（不弹系统通知）；隐藏时 new Notification(title, { body, tag: workplan:<planId>:start, icon })；permission 非 granted 或 Notification 不存在时完全跳过系统通知。
5. 点击通知：聚焦窗口（window.focus）并回调打开对应 Work Plan 抽屉（以 planId 回调给调用方）。
6. 不写任何 localStorage（持久化属于票据 02）；模块只负责调度与派发。

## 验收
- 到达开始时间且标签页隐藏时只弹一次系统通知（tag 去重）；可见时只出现应用内 toast。
- 手动状态覆盖为 cancelled 的计划不触发开始通知。
- 提前量（默认 5 分钟）生效；刷新/聚焦/可见性变化后重排正确。
- 点击通知聚焦窗口并打开对应计划。