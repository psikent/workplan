# 03 — 甘特条 / 计划列表 / 浮动提示三处提醒
Type: task
Status: resolved
Blocked by: 02
Spec: ../spec.md
Scope: apps/web/src/components/GanttTimeline.tsx、apps/web/src/pages/WorkPlansPage.tsx、apps/web/src/styles.css、web 测试

## 背景

规格 R4/R5/R6/R8。前端三处静态提醒:甘特条整条变色、列表行背景变色、浮动提示强制负责人 + 冲突清单。数据源是查询响应携带的 `ownerConflict`(02 已交付)。

## 改动清单

1. **甘特条**(`GanttTimeline.tsx`):
   - bar `custom_class` 在冲突时叠加 `gantt-conflict`,CSS 覆盖优先于 `gantt-${status}` 配色;条体与进度整体警示色;
   - `ganttInputSignature` 纳入冲突标记(counterparts id 串或等价稳定序列),冲突出现/消失触发重渲染。
2. **列表行**(`WorkPlansPage.tsx` PlanRow):冲突行叠加 `plan-row-conflict` 修饰类;行内其余内容不变。
3. **浮动提示**(`formatGanttTooltip`):
   - 冲突任务**强制**展示「工作负责人」属性行(不管用户提示属性配置是否勾选),警示色着色;
   - 追加冲突清单区块,逐条 `label + 日期区间`(日期格式沿用现有 tooltip 格式化);
   - 非冲突任务提示完全维持用户配置。
4. **样式**(`styles.css`):新增 `--gantt-bar-conflict` 等所需 token 与 `.gantt-conflict` / `.plan-row-conflict` 规则,明暗两套 `:root` 全覆盖,hover 态定义冲突对应色;禁止写死面色(含浮动提示 HTML 内的着色,走 class 不走内联色值)。
5. **web 测试**:签名含冲突标记的用例;冲突/非冲突两种 tooltip HTML 断言(强制行与清单只在冲突时出现)。

## 验收

- 规格验收标准 3、4、5;web typecheck 与测试通过;明暗主题下四处置(本票三处)均人工核对无写死面色。
