# 02 — Web: AppShell 铃铛控制与本地持久化
Type: task
Status: ready-for-agent
Blocked by: 01
Spec: ../spec.md
Scope: apps/web/src/components/AppShell.tsx（页脚铃铛控制）、apps/web/src/lib/notifications.ts（偏好读写的补充）

## 背景
规格 R1/R4/R5。控制必须对两种角色（Editor/Administrator）都可见，位置在 AppShell 页脚（与主题/侧栏偏好同级）；偏好按版本化 localStorage 模式（workplan:notifications:v1）持久化，属于浏览器级偏好而非账号设置。

## 改动清单
1. 新增偏好读写：键 workplan:notifications:v1，形状 { version: 1, enabled: boolean, leadMinutes: number, permission: granted|denied|default }；与 theme/sidebar 相同的防御式解析，存储失败回退默认。
2. AppShell 页脚新增铃铛开关（两种角色可见）：
   - !("Notification" in window) 时隐藏控制；
   - 开启手势内调用 Notification.requestPermission()；denied 时禁用开关并显示「浏览器通知已被拒绝」说明；
   - 提前提醒分钟数输入（默认 5，0 关闭提前提醒），不超过合理上限（如 120）。
3. 将授权状态与开关状态接入票据 01 的调度器：enabled 且 permission granted 时启动调度，否则只保留应用内 toast 降级。

## 验收
- 铃铛开关请求权限、denied/不支持时禁用并有中文说明；granted/denied 状态刷新后仍保持。
- 提前提醒可配置且持久化；关闭通知后不再触发系统通知。
- 两种角色在页脚都能看到并操作；文案符合规格 R4（开启通知 / 提前提醒 / 浏览器通知已被拒绝 / 当前浏览器不支持通知）。