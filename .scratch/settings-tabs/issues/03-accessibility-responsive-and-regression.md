# 03 — 可访问性、响应式与回归验收
Type: task
Status: ready-for-agent
Blocked by: 02
Spec: ../spec.md
Scope: `apps/web/src/styles.css`、设置相关前端测试、全仓验证与浏览器 QA

## 背景

五个中文长标签、吸顶行为和嵌入后的宽表都需要专门的可访问性及响应式处理。本票据在 01、02 功能完成后补齐交互契约、自动化回归和真实浏览器验收。

## 改动清单

1. 完成 WAI-ARIA Tabs 语义：
   - Tab 容器为带可理解名称的 `tablist`。
   - 每个 Tab 具有稳定 id、`role=tab`、`aria-selected`、`aria-controls` 和正确 `tabIndex`。
   - 每个内容区具有 `role=tabpanel`、稳定 id、`aria-labelledby`；非活动内容不可见、不可聚焦。
2. 实现键盘操作：Left/Right 在五项间循环移动焦点，Home/End 跳到首尾，Enter/Space 激活并更新 URL；鼠标点击后焦点与活动状态一致。
3. 实现 Tab 条视觉与布局：
   - 位于页面标题下方，设置内容区滚动时吸顶。
   - 使用不透明主题背景、底边界或阴影和适当 z-index；不得覆盖弹窗、Toast 或侧栏。
   - 活动、hover、focus-visible、disabled（如存在）状态在浅色与深色主题下均有足够区分。
4. 保持设置页现有 1080px 最大宽度；不因自定义字段迁入而切换页面宽度。
5. `<=720px` 时 Tab 条单行横向滚动、不换行，点击或键盘激活后将活动项滚入可视区域；现有自定义字段表、负责人映射表和 Excel 模板列表继续在各自容器内横向滚动。
6. 自动化测试至少覆盖：
   - 五项标签/顺序、默认项、唯一可见面板和 ARIA 关联。
   - 合法/非法查询参数、旧路由、点击历史及 Back/Forward。
   - 键盘焦点与激活行为。
   - 环境配置草稿和账户一次性 Token 跨 Tab 保留。
   - 现有环境配置、导入导出、模板、映射、自定义字段、账户、Bark 和侧栏回归。
7. 验证命令：Web typecheck/test 后运行全仓 typecheck/test；不得用更新快照或弱化断言替代修复。
8. 浏览器 QA 覆盖桌面与 `<=720px`：Tab 吸顶、横向滚动、活动项可见、宽表内滚动、深浅主题、旧地址跳转、Back/Forward、草稿和一次性 Token 保留。真实 Token 不得写入截图、日志或票据。

## 验收

- 鼠标、键盘和辅助技术均能确定当前活动 Tab，并可在五项间完整导航。
- 吸顶 Tab 在桌面和窄屏无抖动、遮挡或层级错误；活动项始终可见。
- 设置页宽度稳定，宽表只在自己的容器内横向滚动。
- URL、旧入口、状态保留及所有既有设置功能自动化测试通过。
- Web 与全仓 typecheck/test 全绿，浏览器 QA 结果记录在本票 `## Comments`。

## Comments

- 2026-08-30：已完成。WAI-ARIA Tabs：`tablist`（`aria-label="设置分区"`）+ 5 个 `role=tab`（稳定 id `settings-tab-*`、`aria-selected`、`aria-controls`、活动项 `tabIndex=0` 其余 `-1`）+ `role=tabpanel`（`aria-labelledby`、非活动 `hidden` 且不可聚焦）。
- 键盘：Left/Right 循环移动焦点（基于当前聚焦项）、Home/End 跳首尾、方向键不改变活动项（手动激活模式）；Enter/Space 走按钮原生点击激活并更新 URL；点击后显式 `focus()` 保证焦点与活动一致。激活时 `scrollIntoView({block:"nearest",inline:"nearest"})`（可选调用，jsdom 无实现时跳过）。自动化覆盖：五项标签/顺序、默认项、唯一可见面板、ARIA 关联、合法/非法参数、旧路由、点击历史、Back/Forward、键盘焦点、草稿与一次性 Token 跨 Tab 保留。
- 视觉：`.settings-tabbar` 吸顶（`position:sticky; top:0; z-index:15`，低于弹窗 z-80/100 与 Toast z-200），不透明 `var(--canvas)` 背景自动适配深浅主题；活动项下划线、hover/focus-visible 均有区分。设置页保持 `narrow-page`（1080px）。
- 响应式：`<=720px` Tab 条 `overflow-x:auto` + `flex-wrap:nowrap` + 隐藏滚动条，激活项自动滚入可视区域；宽表（自定义字段 780px、负责人映射 700px、Excel 列表 610px）继续各自容器内横向滚动。
- QA 中发现并修复既有缺陷：`.settings-stack` 为 grid 时子项 `min-width:auto` 会让 700px 负责人映射表把轨道撑到 740px、造成整页横向溢出（旧版 `/settings` 同样存在）。新增 `.settings-stack > * { min-width: 0 }` 修复；修复后 390px 视口 `app-main` scrollWidth=clientWidth=375，三个宽表全部内部滚动。
- 浏览器 QA（隔离实例：`NODE_ENV=production`、端口 3997、全新数据目录、构建产物静态托管；QA 后实例与临时数据已删除，令牌未写入任何文件）：完成初始化 → 侧栏仅“设置”；`/settings` 规范化为 `?tab=environment`；五 Tab 顺序正确；点击 push 历史记录、浏览器后退/前进恢复；`/custom-fields`→`?tab=environment`、`/accounts`→`?tab=accounts`（replace）；`?tab=bogus` 安全回退；环境配置草稿与一次性 Token 跨 Tab 保留、整页刷新后按 spec 不保留；桌面深浅主题吸顶正常；390px 单行滚动、激活项滚入可视区域、宽表内部滚动；账户面板嵌入无重复 h1，创建/停用/删除/Token 操作齐全。
- 验证命令：Web `pnpm typecheck`/`pnpm test`（16 文件 233 测试）全绿；全仓 `pnpm typecheck`/`pnpm test`（contracts + server 132 + web 233 + scripts）全绿，连跑两轮确认无不稳定用例。