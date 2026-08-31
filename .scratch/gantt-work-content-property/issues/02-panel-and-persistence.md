# 02 — 设置面板新增“工作内容”选项与持久化

**What:** `apps/web/src/pages/WorkPlansPage.tsx`：`availableGanttProperties` 在列表顶部（“状态”之上）前置 `{ id: "title", label: "工作内容" }`（徽标走既有“内置属性”分支）；`loadGanttPreferences` 的 id 白名单接受 `title`，使 `workplan:gantt-properties:v1` 中含 `title` 的数据不再被丢弃。浮动提示分区（`workplan:gantt-tooltip:v1` 及其选项列表）完全不动。

**Why:** spec `.scratch/gantt-work-content-property/spec.md` R1/R2/D2/D3。

**Tests:** `WorkPlansPage.test.tsx`：
- 甘特条属性分区第一项为“工作内容”，徽标“内置属性”；浮动提示分区无此选项；
- 勾选后写入 localStorage、重载后保持；“清空”可取消；
- 旧格式数据（不含 `title`）加载行为不变的既有用例保持通过。

**Blocked by:** 01（复用其类型扩展）。

Status: resolved

- [x] 面板按 D3 置顶展示“工作内容”，勾选/排序/清空/持久化符合 R1、R2；`availableTooltipProperties` 过滤 `title` 保证浮动提示分区（含 `visibleTooltipProperties`）不出现该选项。
- [x] 浮动提示分区无变化（含 `title` 的浮提示持久化数据被白名单拒绝）；页面测试 43/43 通过。
