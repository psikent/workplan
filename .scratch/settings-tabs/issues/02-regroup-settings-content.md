# 02 — 设置内容提取与五分区重组
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: `apps/web/src/pages/SettingsPage.tsx`、`apps/web/src/pages/CustomFieldsPage.tsx`、`apps/web/src/pages/AccountManagementPage.tsx` 及相关测试

## 背景

票据 01 提供 Tab 和 URL 壳。本票据把现有设置卡片、自定义字段完整管理界面和账户管理完整界面提取为可嵌入内容，按产品确认的五组重新排列，同时保持当前工作区尚未提交的 Bark、Viewer 和账户删除功能。

## 改动清单

1. 将自定义字段页面拆分为“页面壳”和可复用的设置内容组件：
   - 嵌入环境配置 Tab 时保留字段列表、创建/编辑弹窗、拖拽与按钮排序、归档和选项管理。
   - 去掉嵌入场景中的重复页面级 `h1`/说明，保留清晰的区块标题和“新建字段”入口。
2. 将账户管理页面拆分为“页面壳”和可复用的账户访问设置组件：
   - 保留 Administrator、Editor、Viewer 展示及当前所有创建、停启用、密码、Token、一次性密钥和删除能力。
   - 去掉嵌入场景中的重复页面级标题，不改 API payload、React Query key、Toast 或权限判断。
3. 按以下顺序组装面板：
   - `environment`：环境配置 → 工作负责人账号映射 → 自定义字段。
   - `transfer`：数据导入导出 → Excel 导入导出模板。
   - `accounts`：账户与访问 Token 管理。
   - `push`：Bark 推送。
   - `api-docs`：接口文档说明卡片和新窗口 `/api/docs` 按钮。
4. 实现“首次访问时挂载、之后保持挂载”的面板生命周期：
   - 初始 visited set 只包含 URL 指定的活动 Tab。
   - 首次激活其他 Tab 时加入 visited set；后续切换使用 `hidden` 或等价机制隐藏，不销毁组件实例。
   - 隐藏面板不可被键盘聚焦或辅助技术误读。
5. 明确保留以下临时状态：环境配置 JSON/校验预览、表单输入、mutation 反馈、自定义字段弹窗及草稿、账户一次性 Token；离开设置路由后可正常卸载。
6. 不修改服务端、contracts、数据库、权限、Environment Configuration Package 或 OpenAPI；Excel 模板继续属于环境配置包。
7. 将既有 Settings、Custom Fields、Account Management 测试迁移到新的组件边界，不能通过删除断言来掩盖行为缺失。

## 验收

- 五个 Tab 只显示各自规定内容，内容顺序正确且没有重复页面标题。
- 自定义字段和账户管理能力与迁移前一致，包括当前工作区中的未提交增强。
- 面板首次访问才加载；返回已访问面板时，草稿、弹窗、校验结果和一次性 Token 均保留。
- 非活动面板不可见、不可聚焦，但重新激活后立即恢复原现场。
- 数据导入导出、环境配置包、Excel 模板、负责人映射、账户和 Bark 的既有 API 调用与反馈不变。
- 相关行为测试通过。

## Comments

- 2026-08-30：已完成。8 个内容组件提取到 `apps/web/src/pages/settings/`：`DataTransferSettings`、`EnvironmentConfigSettings`、`OwnerAccountMappingSettings`、`ExportTemplateSettings`、`BarkPushSettings`、`ApiDocsSettings`、`CustomFieldsSettings`、`AccountAccessSettings`，全部为逻辑原样搬移（React Query key、mutation、Toast、确认文案均未改）。
- 面板顺序按 spec：`environment` = 环境配置 → 负责人映射 → 自定义字段；`transfer` = 数据导入导出 → Excel 模板；`accounts` = 账户与访问 Token；`push` = Bark；`api-docs` = 接口文档卡片。
- 生命周期：`visitedTabs` 以“渲染期同步补集”方式维护（首次激活立即挂载、之后仅 `hidden` 隐藏），无选中帧与挂载帧的错位闪烁；`settings-tabpanel[hidden]` 显式 `display:none` 防止 `settings-stack` 的 `display:grid` 覆盖 `hidden`。
- 决策说明：由于 `/custom-fields`、`/accounts` 已改为重定向，旧页面组件不再有可达入口，故删除 `CustomFieldsPage`/`AccountManagementPage` 而非保留死代码页面壳；“页面壳”职责由重定向与设置页头部承担。自定义字段的“新建字段”入口移入字段定义面板头（`.settings-panel-header-actions`）。
- 嵌入式内容不含页面级 h1（QA 与测试断言页面唯一 h1 为“设置”）。
- 测试迁移：`CustomFieldsSettings.test.tsx`（新增“新建字段入口打开弹窗”）、`AccountAccessSettings.test.tsx`（去掉旧页面 h1 断言、其余断言原样保留）、`SettingsPage.test.tsx`（四个行为 describe 按所在 Tab 渲染 + 新增草稿/一次性 Token 跨 Tab 保留测试）。全仓 typecheck/test 全绿。