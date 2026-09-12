# 时间轴单指滑动导航 — 浏览器验收记录

日期：2026-09-12 · 分支 `main` · 隔离实例（独立 `DATA_DIR`，端口 server 3002 / web 5199）

## 环境

- 真实经 frappe-gantt 渲染的时间轴，触摸用 CDP `Input.dispatchTouchEvent`（非合成 JS 事件）。
- 视口：390×844（手机）、1024×768（平板）、1280×900 与 1600×900（桌面）。
- 主题：`Emulation.setEmulatedMedia prefers-color-scheme` 浅/深色。
- 账户：Administrator（另核对只读账户只读约束）。

## 验收结果

| # | 场景 | 结果 |
| --- | --- | --- |
| 1 | 390px 周视图左滑进入下一周 | PASS |
| 2 | 390px 周视图右滑返回上一周 | PASS |
| 3 | 月视图范围内部短滑只滚动不换月（画布按位移平移） | PASS |
| 4 | 月视图长滑越过边界接力进入下一月且落左端 | PASS |
| 5 | 月视图长滑越过左边界返回上一月且落右端 | PASS |
| 6 | 月视图无横向余量（收起列表、宽屏）时左滑直接进入下一月 | PASS |
| 7 | 月视图无横向余量时右滑返回上一月 | PASS |
| 8 | 极窄屏月视图范围内横滑只滚动不换月 | PASS |
| 9 | 纵向滑动不改变时间范围（原生纵向滚动保留） | PASS |
| 10 | 滑动过程显示方向箭头与「上一/下一周」文案，松手后清除 | PASS |
| 11 | 视口左边缘 24px 内起手不触发范围切换 | PASS |
| 12 | 窄屏与平板无额外横向溢出 | PASS |
| 13 | 浅色反馈提示显示「‹上一周」与左边缘位置 | PASS |
| 14 | 深色反馈提示可辨识 | PASS（截图 `hint-dark.png`） |
| 15 | 减少动态效果（prefers-reduced-motion）下仍显示静态提示 | PASS（截图 `hint-reduced-motion.png`） |
| 16 | 甘特全屏模式下滑动切换范围 | PASS |
| 17 | 抽屉未打开时同一点滑动可换范围（对照） | PASS |
| 18 | 抽屉打开时滑动不改变范围（识别暂停） | PASS（截图 `drawer-suspended.png`） |
| 19 | 空数据范围仍可滑动导航 | PASS |
| 20 | 滑动后立即显示目标范围标题与加载状态，且不绘制上一范围的计划 | PASS（截图 `loading-mobile.png`） |
| 21 | 加载中仍可继续逐次滑动（最终只呈现当前范围） | PASS |
| 22 | 加载完成后呈现最终范围数据，无旧范围混入 | PASS |
| 23 | 目标范围查询失败：停留目标范围、显示失败与重试、不显示旧数据、不误报空态 | PASS（截图 `failure-mobile.png`） |
| 24 | 失败后重试可恢复且无旧数据混入 | PASS |

## 无法完成的检查（明确保留限制）

- **真实 iOS / Android 实机原生边缘手势**未复核：本机无设备条件，未以浏览器触摸仿真冒充实机验证。
  仿真已覆盖 24px 视口边缘保留区不接管的逻辑（第 11 项），但系统级边缘返回手势仍待真机确认。
- 触控板双指、触控笔、鼠标拖动明确不属于本功能范围，仅通过单元/DOM 测试证明其不触发（非浏览器验收项）。

## 关键发现（已修复）

- **Chrome 触摸手势取消**：时间轴容器默认 `touch-action: auto` 时，Chrome 在横向拖动开始原生滚动并发出
  `pointercancel`，手势无法完成。修复：容器 `touch-action: pan-y pinch-zoom`，纵向交给浏览器、横向由应用判定；
  范围内的横向浏览改由 `GanttTimeline` 按同一手指位移平移 `scrollLeft`（视觉行为与原生一致）。见 `styles.css`
  与 `GanttTimeline.tsx`（`panBy` 分支）。
- **失败误报空态**：目标范围查询失败时列表/时间轴曾显示「这个时间范围还没有工作计划」，误导为真的没有计划。
  修复：新增 `rangeFailed`，失败期间不渲染空态文案。
- **兼容点击抑制原为死代码（code-reviewer P1）**：`pointerup` 里先摘监听器再置标志，而兼容 click 总在
  `pointerup` 之后到达，抑制一次都不会生效；且导航会替换 `.gantt-container`，挂在旧容器上的监听器也会失效。
  修复：抑制监听器挂到 `document` 捕获阶段，窗口结束时才摘除，并补 DOM 测试「成立手势后派发 click 被拦截」。
- **第二触点取消被绕过（code-reviewer P1）**：第二根手指若落在甘特条等非有效起点，`begin` 提前返回，
  跟踪中的手势不会被取消，仍可能提交翻范围。修复：触摸的 `pointerdown` 先判 `isTracking()` 并立即取消，
  并补 DOM 测试「第二指落在甘特条上时取消」。
- **首次加载路径的失败契约（code-reviewer P2）**：`appliedQuery` 为 null（从未成功查询）时范围契约整体失效，
  首次加载失败会误报空态。修复：改用「最近一次成功应用的范围是否等于目标范围」判定，并补页面测试。
- **候选撤销后未抑制兼容点击（code-review 规格轴 R4）**：此前只有成立提交才抑制点击，锁定候选后反向撤销
  未提交的动作仍会派发兼容 click/dblclick，可能误开甘特条或新建。修复：候选一成立即记 `lockedCandidate`，
  松手无论是否提交都抑制窗口内的点击。
- **指针捕获（规格轴 D16）**：补上锁定候选后 `setPointerCapture`。注意 `lostpointercapture` 会冒泡——
  子元素的隐式触摸捕获在应用接手捕获时丢失，若直接取消会误杀刚锁定的手势；取消只认 `event.target === mount`
  的捕获丢失（该问题在浏览器验收中被 `swipe-acceptance` 捕获并修复）。
- **浮层暂停遗漏筛选面板与提示强度（规格轴 D9/D7）**：`swipeSuspended` 补入 `showAdvancedFilters`；
  边缘提示强度改为随进度单调增强（`0.3 + 0.7×progress`），不再在低进度封顶。`isSwipeStartTarget` 补
  `.timeline-reminder-tooltip` 排除。

## 真机第二轮修复（2026-09-12，iOS 反馈"到边缘仍不翻页 + 卡"）

首轮按 Pointer Events + `touch-action: pan-y` 实现，在 Chromium 触摸仿真下全部通过，但真机（iOS WebKit）仍"到边缘
无法翻页、滚动卡"。根因是 **WebKit 对 Pointer Events + `touch-action` 的实现不可靠**：横向拖动时 `pointercancel`
乱发、`touch-action: pan-y` 也不能彻底阻止原生横向滚动，于是浏览器原生滚动与应用的 JS 平移互相打架，表现为卡顿
与边缘判定失效；`pointercancel` 还会把已锁定的手势整个取消。

修复：接线**整体改用 Touch Events**（`touchstart/touchmove/touchend/touchcancel`，`touchmove` 用
`{ passive: false }` 并在锁定横向后 `preventDefault()`）。这是 iOS 上唯一可靠的方案，且：
- 鼠标/触控板/触控笔不产生 touch 事件，天然满足"非触摸不触发"（spec R2）；
- touch 事件对起手元素隐式捕获，手指移出时间轴仍持续收到 `touchmove`，替代了原先的 `setPointerCapture`；
- `preventDefault` 能真正压住 WebKit 原生横向滚动，消除卡顿与冲突。

`pointer*` 相关监听（含 `lostpointercapture` 与指针捕获）已全部移除。DOM 测试相应改为构造 Touch 事件；
Chromium 仿真（CDP `Input.dispatchTouchEvent` 会同时产生 touch 与 pointer 事件）复测全部通过。

## 行为决定（需知悉，可回退）

- **月视图边界交接修订（2026-09-12，真机反馈后）**：原规格 D4/R3 要求"先滚到边界、松手、再滑一次"才翻月，
  真机体验是连滑几下都只滚动、到边缘再滑也不翻页、且间歇性失效。已改为：**画布平移到某端后继续外滑，
  越界距离达阈值即翻月**——单次手势滑到边缘不松手继续滑即可接力翻页，无需松手重来。同时修复两处：
  纵向判定改为对称的 1.5 倍（起手轻微纵向抖动不再误杀整次手势，对应"间歇性失效"）；手势锁定为横向
  （翻页候选或月内平移）后即 `preventDefault`，避免 iOS 原生滚动与 JS 平移叠加并抛 `pointercancel`。
  规格 D4/R3 相应条款以本节为准。
- **「今天」与周/月 Tab 现在也走目标范围的加载契约**：这些控件同样改变查询范围，因此切换时会立即显示目标
  日期网格与「正在加载…」，不再把上一范围数据画到新网格上（D12 的同一问题）。搜索、状态/自定义字段筛选、
  排序、分页不改变 `requestRange`，仍保留占位数据、行为不变（ticket 01 第 6 条列出的这些项未受影响）。
  若希望「今天」/Tab 保留旧的占位呈现，可将严格契约限定为上一/下一范围与手势。
- **`touch-action: pan-y` 的交叉影响**：从甘特条起手的横向单指拖动不再滚动画布（走既有的排期拖动），
  与背景起手的滚动路径不同。实测既有甘特条点击/拖动/双击新建无回归，判定为可接受。

## 复现脚本

- `swipe-acceptance.mjs`：手势方向、边界交接、反馈、边缘保留区、溢出。
- `states-acceptance.mjs`：反馈外观、减少动态效果、全屏、抽屉暂停、空态。
- `failure-acceptance.mjs` / `role-loading-acceptance.mjs`：加载、失败、重试、连续滑动。
- 运行：先以覆盖会话/密码的独立库启动 server 与 web，再 `ego-browser nodejs < 脚本`。
