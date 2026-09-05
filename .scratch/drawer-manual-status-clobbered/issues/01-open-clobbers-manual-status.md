# 抽屉打开手动状态计划时,状态下拉被派生值覆盖

Type: bug
Status: open
Found: 2026-09-05,冲突校核功能(票 05)浏览器 QA 期间发现

## 现象

打开一个 `status_mode = manual`、`status = pending` 的工作计划详情抽屉,状态下拉显示的是**按抽屉默认起止时间派生的状态**(QA 时段内为「进行中」),而不是该计划实际存储的「待开始」。列表徽标显示正确(待开始),仅抽屉不一致;此时若直接保存,错误状态会被写回。

复现:任意手动状态计划,其存储状态 ≠ `deriveWorkPlanStatus(抽屉默认起止, 当前时刻)` 时必现(如工作时段内打开一个手动「待开始」的历史计划)。

## 根因(初步)

`WorkPlanDrawer` 挂载首轮,表单重置 effect(写入 plan.status/statusMode)与自动状态刷新 effect 同帧执行:刷新 effect 的闭包仍是首帧的 `statusMode = "automatic"` 与默认起止,`refreshAutomaticStatus()` 以默认时间派生状态并 `setStatus`,其写入排在重置之后,把手动状态覆盖。第二轮起 `statusMode` 已是 manual,刷新 effect 提前返回,错误状态残留。

## 备注

- 与负责人冲突校核功能无关(该功能的 diff 未触碰这两个 effect);QA 截图 `../work-plan-conflict-alerts/qa/light-drawer.png` 中可见(计划为手动待开始,抽屉显示进行中)。
- 修复方向(供后续工单参考):刷新 effect 等待 statusMode 就绪后再派生(如在重置 effect 内联派生、或以 `plan` 就绪为前提跳过首轮)。
