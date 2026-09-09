# Spec: 跨周/跨月工作计划在各周/月视图的甘特条内文字可见(Gantt Cross-Range Bar Label)

> Status: **已实施** — grilling 2026-09-09;第一轮 4 项用户确认(D1、D2、D3 核心「条段居中」、D4 核心「始终显示+省略号」);第二轮 3 项代理采用推荐答案、2026-09-09 用户审批确认(D3「统一适用于所有被跨及视图」、D4「画布判定」、D5 术语);票据 01–03 已建(01 → 02 → 03);2026-09-09 实施完成,双包自动化测试全绿 + 隔离实例浏览器验收通过(证据见 qa/README.md)。

## Goal

时间范围跨越当前呈现范围的工作计划(跨周/跨月),其甘特条内文字(Gantt Bar Label)必须在每一个被跨及的周视图/月视图里可见:锚定在该视图可见条段(Visible Segment)的水平中点,始终保持在画布内,画布放不下时单行省略号截断,完整内容仍由悬浮 tooltip 承载。条内文字的内容规则本身不变。

## Decisions(grilling 2026-09-09)

- **D1 内容不变(用户确认)**:只改锚定位置与可见性。属性串构成、工作内容 20 字截断、备注着色、冲突警示、tooltip 全部维持现状。
- **D2 范围(用户确认)**:周视图 + 月视图(同一机制,一并修复);UI 无日视图。
- **D3 位置规则(「条段居中」用户确认;「统一适用于所有被跨及视图」代理采用)**:每个视图里条内文字锚定于可见条段(计划时间范围 ∩ 当前视图呈现范围)的水平中点。代价:跨周/跨月计划在起始周/中间周的位置会从现状「全跨度中点」移动到该周条段中点;范围内计划(不跨周)条段 = 全跨度,行为与像素不变。
- **D4 省略号(「始终显示+省略号」用户确认;「画布判定」代理采用)**:文字允许溢出条外(现状窄条即如此,深字白边可读);仅当会超出当前画布([0, dayCount×columnWidth])时先平移钳入画布,画布宽容不下完整文字时才单行截断加「…」。附带改善:现状贴画布左/右缘的窄条(含不跨周)文字半边被裁的情况同样被钳回完整可见。
- **D5 术语(代理采用)**:CONTEXT.md 新增「Week View (周视图)」「Month View (月视图)」「Visible Segment (可见条段)」「Gantt Bar Label (甘特条内文字)」。

术语:见 CONTEXT.md 对应条目。

## Background facts

- 周视图机制:自定义 Day view mode + 强制 `gantt_start/gantt_end` = 呈现范围(`apps/web/src/components/GanttTimeline.tsx:182-236`),`infinite_padding: false`、`columnWidth = availableWidth / dayCount`(`:80-81`,周 7 列恰好填满容器)、SVG overflow hidden、无横向滚动;月视图同一机制,范围 = anchor 所在自然月(`apps/web/src/pages/WorkPlansPage.tsx:294`)。`view` prop 解构后未使用(`:67`)——周/月差异只剩 range。
- 跨周数据:服务端 overlap 查询 `end_at > @from AND start_at < @to`(`apps/server/src/modules/work-plan-query.ts:224-234`)→ 跨周计划在被跨及的每一周都返回;传入 gantt 的 start/end 为原始值不裁剪(`GanttTimeline.tsx:159-168`);条几何 x 可为负(`:790-797`),画布自然裁出残段(此行为正确,不动)。
- 条内文字:`formatGanttLabel`(`:469-475`)= 勾选的甘特条属性按序以「 · 」连接,工作内容截 20 字(`:454-459`);渲染为 frappe `.bar-label` SVG text;frappe 的 `.big` =「文字宽于条时移到条外」逻辑,现被应用层强制取消。
- 三处锚定逻辑全部 = 全跨度中点且无任何画布钳制:`applyWholeDayBarGeometry`(`:807-808`)、`keepGanttLabelsCentered`(`:664-691`,初始 + MutationObserver 强制居中/去 .big)、拖拽 `renderScheduleGeometry`(`:1054-1063`)。
- **根因**:跨周计划全跨度中点落在画布外(如跨 2 周计划在结束周:x 为负、中点 < 0)→ 条内文字整体在 SVG 视口外被裁,只剩无字残段;跨 3 周计划仅中间周可见;月视图跨月同理。次要:即使中点在画布内,长文字(11px、20 字约 150–220px)也可能跨出画布边缘被部分裁剪;贴左缘窄条文字左半出界是现状既有问题(D4 一并解决)。
- tooltip:`formatGanttTooltip`(`:485-516`)title 行为完整未截断 `plan.title` + 完整属性值——完整内容出口已存在,无需改动。
- 画布宽 = `dayCount × columnWidth`(渲染测试基准:range 08-03~08-10、columnWidth 100 → 画布 700)。
- 测试现状:`GanttTimeline.render.test.tsx` 标签用例(`:628-674` 居中、`:676-696` 20 字截断)全部为范围内计划,跨周几何零覆盖——现状缺陷无测试保护的原因。
- 历史教训:甘特视觉改动必须真实浏览器截图验收(jsdom 不应用样式表);条形样式覆盖须 !important(本次不改样式,不涉及)。

## Requirements

### R1 可见条段居中锚定

- 新增纯函数(建议 `layoutBarLabel`):输入条几何 `{barX, barWidth}`、画布宽 `canvasWidth`、文字与测宽函数,输出 `{x, text}`。可见条段 = `[max(barX, 0), min(barX + barWidth, canvasWidth)]`,锚点 = 其水平中点。
- 条几何(负 x / 全跨度宽)与画布裁剪行为不变;仅 `.bar-label` 的定位改走此规则。`text-anchor` 维持 `middle`,`.big` 继续被移除。

### R2 画布钳制与省略号(D4)

- 文字宽经真实 DOM 测量(`getComputedTextLength`/`getBBox`);若 `[锚点−半宽, 锚点+半宽]` 超出 `[0, canvasWidth]`,先平移钳入画布(左缘 ≥ 0 且右缘 ≤ canvasWidth);文字宽 > 画布宽时单行截断追加「…」后钳入。
- 测宽不可用或为 0(jsdom 环境)→ 退化为仅 R1 锚定,不平移不截断;纯函数以注入 measure 函数做单测,不依赖真实 DOM。

### R3 三处定位点统一(含拖拽)

- `applyWholeDayBarGeometry`(`:807-808`,需新增画布宽入参,调用点 `:244` 同步)、`keepGanttLabelsCentered`(`:664-691`,语义从「强制全跨度居中」改为「强制新规则」,函数名随之更名)、拖拽 `renderScheduleGeometry`(`:1054-1063`)三处全部走同一纯函数;拖拽期间随 `nextX/nextWidth` 实时重算。
- frappe 自身 `draw_label`/`update_label_position` 的初始定位与 `.big` 逻辑继续被「后渲染同步 + MutationObserver」覆盖(既有模式不变)。

### R4 月视图

- 同一代码路径自动生效(`dayCount` = 当月天数),不写月视图专有逻辑;测试至少一条跨月用例。

### R5 不影响范围

- 条形几何与裁剪、备注着色、冲突警示、图例、tooltip 内容、20 字截断、日期表头与提醒铃铛、双击新建、只读模式全部不变。
- 表头 `.date-range-highlight`(悬停日期范围块,`:809-813`)维持全跨度定位,不随条内文字新规则——它是日期范围指示,画布外裁剪语义可接受。
- 接受的侧效应:贴画布左/右缘窄条(含不跨周)的文字由「半边被裁」变为「钳入画布完整可见」。

### R6 测试

- 纯函数单测:可见条段中点(左出界/右出界/范围内/整周段)、钳制平移、截断追加「…」、测宽为 0 的退化路径。
- 渲染测试:跨 2 周计划在结束周视图(x = 该周条段中点、∈ [0, canvasWidth]、无 `.big`、`middle`);跨 3 周计划首/中/尾三个周视图;月视图跨月计划;贴左缘窄条钳入;范围内计划既有断言零回归;20 字截断回归;(可复用既有拖拽测试模式则)拖拽期间标签随新规则移动。

## 验收标准

1. `corepack pnpm --filter @workplan/web typecheck && corepack pnpm --filter @workplan/web test` 全绿(改动仅 apps/web,server 与 contracts 不动);新增 R6 用例,既有标签居中/截断/几何用例零回归。
2. 隔离实例(临时 DATA_DIR,勿动 `./data`)真实浏览器验收:跨 2 周计划在起始周与结束周视图截图,两周边条内文字均可见且居中于该周条段;跨 3 周计划三周均可见;月视图跨月计划同验;某周仅 1–2 天窄段文字省略号且悬浮 tooltip 完整;范围内计划外观不变;浅/暗两主题复验。
