# Spec: 设置页五分区 Tab 重构

> Status: **已确认，待实现** — 本目录只交付需求规格与实施票据；本轮不修改应用代码、样式、路由或测试。

## Goal

将 Administrator 当前分散、纵向堆叠的全局管理功能统一收进“设置”页面，并在页面标题下方以五个横向 Tab 分区。重构只改变前端信息架构和导航方式，不改变任何管理功能的业务行为或数据边界。

## 已定决策

- **D1 Tab 数量与顺序**：采用五个 Tab，固定为“环境配置”“数据导入/导出”“账户管理”“推送配置”“接口文档”；需求中的“3 个 tab”为笔误。
- **D2 入口收敛**：管理员侧栏只保留“设置”，移除“自定义字段”和“账户管理”独立入口；旧地址继续兼容跳转。
- **D3 URL 状态**：Tab 状态写入 `tab` 查询参数，支持复制地址、刷新、浏览器前进和后退。
- **D4 临时状态保留**：面板第一次访问时挂载，之后切换 Tab 只隐藏、不卸载；未保存输入、环境配置校验结果、弹窗和一次性 Token 在本次设置页会话内保留。
- **D5 展示方式**：设置页保持现有 `narrow-page`（最大 1080px）宽度；Tab 条吸顶；窄屏保持单行并横向滚动。
- **D6 接口文档**：保留现有说明卡片和“打开 OpenAPI”按钮，在新窗口打开 `/api/docs`；不在设置页内嵌 OpenAPI UI。
- **D7 配置包边界**：本次仅重组界面。Environment Configuration Package 仍包含 Custom Field、Work Owner Account mapping 和 XLS export template，不改变 schema、导入模式或导入语义。

## Information Architecture

### 1. 环境配置（`environment`）

按以下顺序展示现有完整功能：

1. 环境配置
2. 工作负责人账号映射
3. 自定义字段

“自定义字段”应复用当前独立页面的完整管理能力，包括创建、编辑、归档、排序和选项管理；并入后不再显示第二个页面级标题。

### 2. 数据导入/导出（`transfer`）

按以下顺序展示：

1. 数据导入导出（现有完整 JSON 备份导出、校验和导入流程）
2. Excel 导入导出模板

Excel 模板虽然在此 Tab 编辑，但仍属于 Environment Configuration Package 的组成部分。

### 3. 账户管理（`accounts`）

展示现有完整账户与访问 Token 管理能力，包括 Administrator、Editor、Viewer 的展示，以及当前已实现的创建、停用/启用、密码、Token 和账户删除行为。并入后不再显示独立的“账户管理”页面级标题。

### 4. 推送配置（`push`）

展示现有完整 Bark 推送配置，包括服务器 URL、设备 Key、保存配置、测试推送及结果反馈。

### 5. 接口文档（`api-docs`）

展示现有接口文档说明卡片；按钮继续以新窗口打开 `/api/docs`。

## URL 与导航契约

- 五个可用地址分别为：
  - `/settings?tab=environment`
  - `/settings?tab=transfer`
  - `/settings?tab=accounts`
  - `/settings?tab=push`
  - `/settings?tab=api-docs`
- 直接访问 `/settings` 时，以 `replace` 规范化为 `/settings?tab=environment`。
- `tab` 缺失、为空或为未知值时，以 `replace` 回退到 `/settings?tab=environment`，不显示空白页或错误页。
- 用户点击不同 Tab 时产生正常浏览器历史记录；前进/后退恢复相应活动 Tab。
- `/custom-fields` 以 `replace` 重定向到 `/settings?tab=environment`。
- `/accounts` 以 `replace` 重定向到 `/settings?tab=accounts`。
- Administrator 权限边界保持不变；非 Administrator 访问设置或旧管理地址时继续遵循现有重定向策略，不得借兼容跳转获得管理页面访问权。

## Interaction and Accessibility

- Tab 条使用完整的 `tablist`、`tab`、`tabpanel` 语义，并建立 `aria-controls` / `aria-labelledby` 关联。
- 活动 Tab 设置 `aria-selected=true`；非活动 Tab 的面板使用原生 `hidden` 或等价不可见、不可聚焦机制。
- 支持鼠标点击、Enter/Space 激活，以及 Left/Right/Home/End 键移动 Tab 焦点；焦点样式必须清晰可见。
- 窄屏下 Tab 不换行、不压缩为难以点击的小按钮；容器可横向滚动，并保证活动项进入可视区域。
- Tab 条滚动离开初始位置后吸附于设置内容区顶部，具有不透明背景和合适层级，不能遮挡弹窗、Toast 或页面内容。

## State and Loading Rules

- 初次进入设置页只需挂载当前 URL 对应的面板；首次切换到另一 Tab 时再挂载该面板。
- 已访问面板在后续 Tab 切换中保持挂载，避免丢失表单草稿、校验预览、错误/成功摘要、正在编辑的弹窗或一次性 Token。
- 离开设置路由后允许组件按正常路由生命周期卸载；不要求跨页面或浏览器刷新恢复未保存状态。
- 不得为了保留面板而复制查询或业务状态；继续复用现有 React Query keys、mutation、Toast 和权限逻辑。

## Compatibility and Change Protection

- 不新增或修改服务端 API、contracts、数据库 schema、迁移、鉴权规则或环境配置包格式。
- 不改变数据导入的确认流程、Excel 模板行为、账户管理行为、Bark 配置行为或 OpenAPI 地址。
- 当前工作区的 Bark、Viewer 和账户删除相关改动尚未提交。实现时必须基于现工作区提取和重组组件，不得用 HEAD 版本覆盖这些改动。
- 本需求不新增领域概念，不修改 `CONTEXT.md`；信息架构调整可逆，不创建 ADR。

## Out of Scope

- 重新设计各配置表单或卡片的视觉样式。
- 修改账户角色、权限或 Token 生命周期。
- 拆分 Environment Configuration Package，或调整 JSON/XLS 数据格式。
- 内嵌、定制或重新生成 OpenAPI 文档。
- 为非 Administrator 开放任一设置功能。
- 跨路由、刷新或重新登录后恢复未保存草稿。

## Acceptance Criteria

1. Administrator 进入设置页时看到五个顺序正确的横向 Tab，默认活动项为“环境配置”，且任一时刻只有活动面板可见和可聚焦。
2. 五个 Tab 的内容完整、顺序符合本规格，各现有创建、编辑、导入导出、推送和 Token 操作行为无变化。
3. Tab 地址可直接访问、刷新和复制；点击产生历史记录，浏览器前进/后退恢复正确活动项；非法参数安全回退。
4. 管理员侧栏只显示“设置”；两个旧管理地址跳转到对应 Tab；非管理员权限边界不变。
5. 切换 Tab 后返回，未保存输入、校验结果、弹窗和一次性 Token 仍在；离开设置页后不承诺保留。
6. 桌面端保持现有设置页宽度；Tab 条滚动吸顶；`<=720px` 时五个 Tab 单行横向滚动，宽表继续使用各自内部横向滚动。
7. Tab 的 ARIA 关系、焦点顺序和键盘操作通过自动化测试与人工浏览器验收；深浅主题下均清晰可用。
8. Web 与全仓 typecheck/test 通过，现有 Settings、Custom Fields、Account Management、AppShell 行为测试无回归。

## Ticket Plan

- [01 — Tab 壳、URL 与导航收敛](./issues/01-tab-shell-routing-and-navigation.md)
- [02 — 设置内容提取与五分区重组](./issues/02-regroup-settings-content.md)
- [03 — 可访问性、响应式与回归验收](./issues/03-accessibility-responsive-and-regression.md)

