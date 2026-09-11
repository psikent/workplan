# 02 — 负责人下拉预标记与详情联动
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/components/WorkPlanDrawer.tsx、相关样式与组件测试

## 背景

抽屉当前只在 owner 已选中后执行实时校核。需要在不替换原生 select、不改变 Option Order 或保存载荷的前提下，为所有冲突候选追加数量标记，并让候选标记和选中后详情共用一次服务端预览。

## 改动清单

1. 为可编辑抽屉建立 conflict-preview 状态机：打开后约 400ms 防抖请求；时间、状态模式或状态变化后同样防抖；保持打开时每 30 秒刷新。
2. owner 字段缺失/非 single_select、区间不完整或非法、抽屉只读时不请求候选预览。
3. 对并发请求使用序号或取消机制，保证最后一次输入对应的响应才可落入 UI；关闭抽屉后不更新状态。
4. 以 owner option value 关联响应分组；未归档冲突候选的可见文本追加 `（⚠ 冲突 N 项）`，不改 value、顺序、disabled 或提交数据。
5. 当前已选 owner 的 amber 边框和详细 Counterpart 文案改由同一预览结果驱动；数量与详情清单必须一致，移除抽屉对单 owner conflict-check 的重复请求。
6. loading 不显示“无冲突”；error 清除候选标记并在负责人区域显示「负责人冲突信息暂不可用」，不阻止选择或保存；后续成功自动恢复。
7. 编辑非活跃计划时不显示候选或选中后冲突提醒；新建/编辑排除自身、周期当前实例等语义由服务端结果保持。
8. 补充 Web 测试：初始预览、多个候选及计数、选择后详情、时间/状态变化、防抖、30 秒刷新、迟到响应、error/恢复、原生值与保存载荷、readOnly 和未归档过滤。

## 验收

- 规格验收标准 1、3、5–8 中的 Web 部分全部通过。
- 冲突负责人始终可选可存；无冲突选项及非 owner 自定义字段完全不变。

## Answer

已完成：WorkPlanDrawer 接入全候选 `conflict-preview`，打开及时间/状态变化后约 400ms 防抖请求，保持打开每 30 秒刷新；候选选项追加 `（⚠ 冲突 N 项）`，选中后详情复用同一响应。请求竞态按每次请求独立序号处理，非活跃草稿即时清除旧标记，失败显示「负责人冲突信息暂不可用」且不阻止保存；保留原生 select、Option Order、value 和只读行为。

验证证据（2026-09-10）：WorkPlanDrawer 专项 32/32、Web 全套 339/339、Web typecheck 通过；代码审查复核未发现 P0/P1。票据 03 的真实浏览器矩阵尚未执行。

## Comments

- 预览响应同时驱动候选计数和已选负责人 Counterpart 详情，已移除抽屉对单 owner `conflict-check` 的重复请求。
