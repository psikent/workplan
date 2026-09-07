# 18 — 真实浏览器排序验收矩阵（无头自动化）

Type: task
Status: done
Blocked by: 无 — 可立即开工
Spec: ../spec.md
Scope: 无头 Chromium 自动化矩阵的执行与证据记录，覆盖三种 Web 角色、桌面/窄屏、鼠标/键盘、URL/偏好/加载失败、表格/甘特/XLS 一致性

## Background

规格验收要求"浏览器矩阵覆盖三种 Web 角色、桌面/窄屏、鼠标/键盘、URL/偏好、加载/失败、表格/甘特和导出一致性"。票据 15/16 中该矩阵经用户确认按文档闭环跳过，未实际执行；本票把它真正跑一遍。自动化测试已覆盖其中功能点，本票验证的是真实浏览器端到端体验。

## Work

1. 用仓库已验证的无头 QA 配方（playwright-core + 系统 Chromium，隔离 DATA_DIR + 临时账号）搭建矩阵执行脚本；Token-only Account 无 Web 工作台，按规格排除在矩阵外。
2. 矩阵格：Administrator / Editor / Viewer 三角色 × 桌面 / 窄屏 × 鼠标 / 键盘。
3. 每格覆盖的用例（对应规格 Work Plan Page Sorting UI 节）：
   - 排序面板：添加、删除、上移、下移、方向切换、恢复默认（清空）；
   - URL `sort=` 参数：合法生效、非法整体回退排期顺序并显示说明；
   - 账户偏好：修改后保存、下次进入恢复；偏好含失效字段时逐项清理并提示一次；
   - 加载与失败：请求期间保留上次结果并显示加载；失败保留结果/排序/页上下文并提供重试；
   - 一致性：表格与甘特共享同一服务端顺序；XLS 导出携带页面已生效的查询与排序，顺序与表格一致；
   - 授权：Viewer 可排序但无任何写入口；Editor/Administrator 全功能。
4. 证据：每个矩阵格的关键步骤截图 + 结论写入本票 Comments；发现的缺陷当场修复，或另开子票并在此链接。

## Acceptance

- [x] 矩阵全格执行完毕，截图与逐格结论记录在本票 Comments。
- [x] 规格 Work Plan Page Sorting UI 节的全部可观察行为（面板管理、URL/偏好优先级、降级提示、加载/失败、控件可聚焦有标签）在真实浏览器中符合规格。
- [x] 三角色授权边界符合规格（Viewer 可排序不可写；前端隐藏写入口仅是体验）。
- [x] XLS 导出顺序与表格当前排序一致（同一已生效查询）。
- [x] 缺陷零遗留：全部修复或子票化并链接。（发现 1 个缺陷已当场修复并带回归测试）

## Comments

### 2026-09-07 执行完成：矩阵 12/12 格全过（每格 15 项断言），发现并修复 1 个缺陷

**执行方式**：按仓库无头 QA 配方（playwright-core + 系统 Chromium `/opt/homebrew/bin/chromium`，headless），隔离 DATA_DIR 的本地服务（:4173，v14 迁移后构建）+ 三角色临时账号（qa-admin/qa-editor/qa-viewer）+ 种子数据（3 个自定义字段 + 12 条计划，含自然序样例、缺失值、失效单选场景）。Token-only Account 无 Web 工作台，按规格排除。执行脚本 `../prototype/qa-matrix.mjs`，证据截图 168 张于 `../qa-evidence/`（每格 13–14 张关键步骤截图 + 逐格导出文件），逐格结论 `../qa-evidence/matrix-report.txt`。

**矩阵**：Administrator / Editor / Viewer × 桌面(1440×900) / 窄屏(390×844) × 鼠标 / 键盘，共 12 格，全部 ✅（15 项/格）。

每格断言（对应规格 Work Plan Page Sorting UI 节）：

1. URL `sort=` 合法生效：`custom.stage:asc` 自然序（任务1 < 任务2 < 任务10 < 任务100）+ ASCII 先于中文 + `任务01/任务1` 同键并列回排期链 + 缺失值置后，顺序与统一查询 API 实测完全一致。
2. URL `sort=` 非法：`custom.not_exists:asc` 整体回退排期顺序、显示"链接中的排序参数无效，已恢复默认排期顺序"、参数从 URL 移除（冷加载期字段目录未就绪的瞬时 422 由客户端清理兜底，最终态正确）。
3. 排序面板：添加（select 可聚焦有标签）、方向切换（升↔降）、下移/上移（首末禁用态正确）、移除、恢复默认（清空 + URL 移除 sort=）。
4. 账户偏好：设置排序后写入 localStorage 与 URL，刷新后恢复；注入含 `custom.deleted_long_ago` 的失效偏好 → 逐项清理、写回、提示"浏览器偏好中的失效排序字段已清理"一次，剩余字段排序生效。
5. 加载：请求延迟期间保留上次结果且页脚显示"正在加载…"。
6. 失败：查询失败保留上次结果/排序/页上下文，错误横幅 + 重试按钮，重试恢复。
7. 一致性：表格 `.plan-row[data-plan-id]` 与甘特 `.bar-wrapper[data-id]` 月视图下 12/12 行同序；XLS 导出（真实下载文件经 SheetJS 解析）顺序与表格当前排序一致。
8. 授权：Viewer 可排序/查询/导出，无新建入口且有只读提示；Editor/Administrator 全功能。

**发现并当场修复的缺陷（1 个，已带回归测试）**：

- **查询失败后列表清空，违反"失败保留结果"规格与页面自身横幅承诺**。根因：`@tanstack/react-query` v5 的 `placeholderData: keepPreviousData` 仅在 `status === "pending"` 期间生效（query-core queryObserver.js:265），查询进入 error 态后 placeholder 被丢弃，`plans` 回退为空数组——而横幅文案承诺"当前显示的是最近一次成功结果"。修复：`WorkPlansPage.tsx` 以 `lastSuccessQueryRef` 固化最近一次真实成功响应（`isSuccess && !isPlaceholderData`），错误态回退展示；同一守卫同时修复 `appliedQueryRef` 被 placeholder"伪成功"污染的问题（该 ref 声称仅固化真实成功查询，供导出与 appliedSort 使用）。回归测试加入 `WorkPlansPage.test.tsx`（失败保留结果 + 重试恢复 + 面板失败态提示），web 套件 301/301 全绿。

**口径说明（如实记录）**：键盘格的"添加排序字段"下拉：closed `<select>` 的方向键/首字母导航由平台原生菜单实现，无头 Chromium（darwin）无法驱动，属平台自有行为；键盘格改为断言该控件可聚焦且带标签（activeElement 验证），选值用原生 select API，面板全部按钮仍以键盘 focus+Enter 驱动。其余全部断言两种输入模式均真实执行。
