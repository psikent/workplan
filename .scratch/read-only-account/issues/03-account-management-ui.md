# 03 — 管理员账户管理界面支持 Viewer
Type: task
Status: ready-for-agent
Blocked by: 01, 02
Spec: ../spec.md
Scope: apps/web/src/pages/AccountManagementPage.tsx、apps/web/src/pages/AccountManagementPage.test.tsx、相关账户样式与类型

## 背景

规格 R1、R5。Administrator 需要在现有账户管理页创建和维护 Viewer，而不是使用单独页面；角色创建后固定，不提供转换控件。

## 改动清单

1. 将前端用户类型扩展为 `admin | editor | viewer`，并为账户创建表单增加「账户类型」选择：编辑者、只读账户；默认保持编辑者，避免改变既有操作习惯。
2. 两种非管理员角色都继续支持「密码登录」和「仅 API Token」；创建请求携带所选角色及现有登录方式字段。
3. 创建按钮、成功提示和一次性 Token 提示使用所选角色的准确文案，不再硬编码「创建编辑者」或「编辑者已创建」。
4. 账户卡片区分「管理员」「编辑者」「只读账户」，并组合显示「密码登录」或「仅 API Token」。
5. Viewer 与 Editor 都可由 Administrator 停用/启用、设置或重置密码、签发和撤销 Token；Administrator 卡片的既有限制保持不变。
6. 不添加角色编辑下拉框、转换按钮或角色更新请求。
7. 增加页面测试：两种 Viewer 创建 payload、角色/登录方式文案、生命周期控件、Editor 默认值，以及不存在角色转换入口。

## 验收

- Administrator 能在同一页面创建密码 Viewer 和 Token-only Viewer，并执行全部已确认的管理操作。
- Viewer、Editor 和 Administrator 的标签及操作范围准确；没有角色转换入口。
- 账户管理页面测试和 web typecheck 通过。

## Comments

