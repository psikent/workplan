# 01 — Tab 壳、URL 与导航收敛
Type: task
Status: ready-for-agent
Blocked by: none
Spec: ../spec.md
Scope: `apps/web/src/pages/SettingsPage.tsx`、`apps/web/src/App.tsx`、`apps/web/src/components/AppShell.tsx` 及相关测试

## 背景

设置功能当前分散在 `/settings`、`/custom-fields` 和 `/accounts` 三个管理员入口。本票据先建立稳定的五 Tab 导航与 URL 契约，并把管理员侧栏收敛为单一“设置”入口；具体内容重组由票据 02 完成。

## 改动清单

1. 定义设置 Tab 的单一前端枚举/联合类型，值固定为 `environment`、`transfer`、`accounts`、`push`、`api-docs`；Tab 标签和顺序从同一只读定义生成，避免路由解析、按钮与面板顺序各自维护。
2. 在设置页读取和校验 `tab` 查询参数：
   - `/settings`、缺失值、空值和未知值均以 `replace` 规范化到 `/settings?tab=environment`。
   - 有效参数直接选中对应 Tab，不产生额外重定向。
   - 点击 Tab 使用普通历史导航，确保浏览器 Back/Forward 能回到前一个活动 Tab。
3. 在“设置”页面标题和说明文案下方渲染五个 Tab 控件，顺序严格遵循 spec；本票据可先提供面板插槽，内容迁移在 02 完成。
4. 管理员侧栏删除“自定义字段”和“账户管理”两个独立条目及不再使用的图标 import，只保留“设置”。
5. 保留旧地址兼容：
   - `/custom-fields` → `/settings?tab=environment`（replace）
   - `/accounts` → `/settings?tab=accounts`（replace）
6. 兼容跳转不得放宽权限：管理员可进入目标 Tab；非管理员继续按现有规则返回工作计划页。
7. 更新路由和 AppShell 测试，覆盖管理员只有一个设置入口、编辑者/只读账户看不到设置入口，以及旧地址的目标与 replace 行为。

## 验收

- 五个 Tab 标签、顺序和查询参数值完全符合 spec。
- `/settings` 与非法参数稳定落到环境配置 Tab，且不会产生重定向循环。
- 点击、刷新、直达、Back/Forward 均选中正确 Tab。
- 侧栏不再重复展示自定义字段和账户管理；旧书签仍可到达正确内容入口。
- 非 Administrator 无法通过旧路由或查询参数绕过管理权限。
- 相关路由、设置页和 AppShell 测试通过。

## Comments

- 2026-08-30：已完成。Tab 定义收敛在 `apps/web/src/pages/settings/tabs.ts`（`settingsTabs`、`SettingsTabKey`、`isSettingsTab`、`settingsPath`、`defaultSettingsTab`），路由、按钮与面板顺序共用同一来源。
- `/settings` 的 `tab` 解析放在 `SettingsPage`：合法值直接选中；缺失/空/未知在 effect 中以 `setSearchParams(..., { replace: true })` 规范化到 `?tab=environment`，渲染按 `environment` 立即出面板，无空白帧、无重定向循环。点击 Tab 走普通 push 历史。
- `App.tsx` 将认证后的路由表提取为导出组件 `AuthenticatedRoutes({ role })`，便于直接测试；`/custom-fields`、`/accounts` 对管理员 `<Navigate replace>` 到对应 Tab，非管理员仍回 `/work-plans`。
- 侧栏移除“自定义字段”“账户管理”条目及 `SlidersHorizontal`/`UsersRound` 图标 import，仅保留“设置”。
- 测试：`App.test.tsx` 新增 authenticated routes 组（覆盖旧地址目标、REPLACE 动作、非管理员回退、合法参数不重定向）；`AppShell.test.tsx` 断言管理员单一设置入口；`SettingsPage.test.tsx` 新增 tab shell 组（顺序/ARIA/规范化/回退/点击历史/Back-Forward/键盘焦点）。Web typecheck + 233 项测试全绿；全仓 typecheck/test 全绿（连跑两轮确认稳定）。