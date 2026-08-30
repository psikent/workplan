# 02 — Bark 配置 API 与设置页区块
Type: task
Status: resolved
Blocked by: 01
Spec: ../spec.md
Scope: apps/server/src/routes/settings.ts（或按现有路由组织新增）、apps/server/src/modules/（Bark 客户端小模块）、apps/web/src/pages/SettingsPage.tsx、apps/web/src/lib/api.ts、测试

## 背景
规格 R2 与决策 D2/D6。配置全局唯一、仅 Administrator 读写；不纳入环境配置包；Key 留空 = 推送关闭；提供测试推送按钮。

## 改动清单
1. 新路由（`config: { authorization: "admin" }`，参照 routes/env-config.ts）：
   - `GET /api/v1/settings/bark` → barkConfigSchema（无行时返回默认值）。
   - `PUT /api/v1/settings/bark` → 校验 URL（contracts schema），upsert 单行。
   - `POST /api/v1/settings/bark/test` → 用当前配置向 `{server_url}/{device_key}` 发送 GET（Bark 即为 URL 路径式 API），query 带 title/body/group；返回 success 与失败摘要；未配置 Key 时返回明确错误。
2. 服务端新增极小 Bark 客户端模块：`sendBark(config, { title, body, group })`，5s 超时，非 2xx 抛错（03 复用）。
3. `SettingsPage.tsx` 新增「Bark 推送」卡片：服务器 URL 输入、设备 Key 输入（占位提示「留空则关闭推送」）、保存按钮（PUT）、发送测试推送按钮（POST test，内联展示成功/失败）。
4. 环境配置包导出内容保持不含 Bark 配置（无需改动，补一条断言测试：exportPackage 结果无 bark 字段）。
5. 测试：路由鉴权（非 admin 403）、GET 默认值、PUT upsert 与非法 URL 4xx、test 端点成功/失败/未配置三种分支；SettingsPage 渲染与交互测试（参照现有 SettingsPage.test.tsx 模式）。

## 验收
- Administrator 可在设置页保存配置并成功收到测试推送（手动验收）。
- 非 Administrator 读写均被拒；环境配置包不含 Bark 配置。
- server/web typecheck/test 通过。

## Comments

## Answer

- 新增 `apps/server/src/modules/bark-client.ts`：`sendBark`（URL 路径式 API，`GET {server_url}/{device_key}?title=…&body=…&group=…`，5s 超时，非 2xx 抛错）。
- 新增 `apps/server/src/modules/bark-config.ts`：`BarkConfigService.get/save/sendTestPush` —— 无行返回默认值；PUT upsert 单行（id=1），deviceKey 空串归一化为 null；未配置 Key 时测试推送返回 400 `BARK_NOT_CONFIGURED`。
- 新增 `apps/server/src/routes/settings.ts`：`GET/PUT /api/v1/settings/bark` 与 `POST /api/v1/settings/bark/test`，全部 `authorization: "admin"`，PUT 用 contracts schema（zod）再解析校验 URL。
- `SettingsPage.tsx` 新增「Bark 推送」卡片：服务器 URL / 设备 Key（占位提示「留空则关闭推送」）/ 保存配置 / 发送测试推送（内联展示成功/失败），按钮命名避开既有「保存」冲突。
- 测试：`test/bark-settings.test.ts` 7 例（匿名 401、editor 403、默认值、upsert 与空 Key 归一化、非法 URL 422、未配置 400、成功/失败分支、env-config 包不含 bark 字段）；`SettingsPage.test.tsx` 新增 3 例（加载+保存、成功摘要、失败摘要）。
- 验收：server 127 测试、web 215 测试、全仓 typecheck 通过。
