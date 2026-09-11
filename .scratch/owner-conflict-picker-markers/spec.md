# Spec: 负责人选择前冲突标记

> Status: **票据 01–03 已实现并验收** — 2026-09-10 完成交互式需求确认、服务端与 Web 实现、全仓回归和真实浏览器矩阵验收。

## Goal

在新建或编辑 Work Plan 时，用户展开「工作负责人」下拉框即可看出哪些负责人已在当前计划时段关联其他活跃工作，不必先逐个选择。冲突负责人仍可选择和保存；选中后继续显示现有的冲突对象与时间详情。

## Existing behavior

- `owner` 是 `single_select` Custom Field，抽屉当前使用原生 `<select>`，仅展示未归档选项并遵循 Option Order。
- 服务端已有 Owner Conflict 核心规则、查询响应派生字段和单负责人 `POST /work-plans/conflict-check`。
- 抽屉当前仅在负责人已经选中后调用单负责人校核；其他候选人在下拉列表中没有预先标记。
- 既有实时校核把假设目标恒视为 `in_progress`，因此编辑 completed/cancelled 计划时可能过度提醒。本需求同时收紧这一边界。

## Confirmed decisions

1. 下拉展开前即对所有可选负责人完成预览；选中后保留现有详细提醒。
2. 候选项文案为 `姓名（⚠ 冲突 N 项）`，其中 N 是与当前草稿成对冲突的 Counterpart 数量。
3. 保留原生下拉框、Option Order 和未归档选项过滤，不改为自定义组合框。
4. 冲突候选仍可选择，冲突永不阻止保存。
5. 新建、编辑均覆盖；编辑排除当前 Work Plan 自身。
6. 当前草稿的有效状态为 completed/cancelled 时不显示冲突；pending/in_progress 时才参与判定。
7. 打开抽屉、草稿时间或状态变化、定期刷新时重新校核。
8. 校核失败显示「负责人冲突信息暂不可用」，但不阻止选择和保存。
9. Recurring Series 只评估当前详情页这一 Occurrence，不预演未来 Occurrences。

## Requirements

### R1 统一判定口径

- 候选标记和选中后详情必须复用 Owner Conflict：同一非空 owner、两个半开 Work Plan Time Range 精确相交、端点相接不冲突、双方有效状态均为 pending/in_progress。
- 当前草稿的有效状态按 `statusMode` 解释：automatic 由服务端以本次求值时刻和草稿时间范围派生；manual 使用草稿状态。
- 编辑时按 `id` 排除当前持久化 Work Plan；新建无排除项。
- 只评估当前 Work Plan/Occurrence 的草稿，不扩展或模拟未来 Recurring Series。
- Counterparts 继续按开始时间、稳定 identity 顺序排列；计数等于清单长度。

### R2 全候选预览契约

- 新增无副作用查询 `POST /work-plans/conflict-preview`，权限与既有 Work Plan 查询一致。
- 严格入参：`{ id?, status, statusMode, startAt, endAt }`。服务端生成统一 `evaluatedAt`，automatic 状态以该时刻派生。
- 响应：`{ evaluatedAt, conflicts: Array<{ owner, counterparts }> }`；只返回存在冲突的 owner 分组，owner 唯一且稳定排序，Counterpart 形状复用既有契约。
- 当前草稿非活跃时返回空 `conflicts`；无写入、无副作用。
- 预览从全局活跃 Work Plan 的最小投影计算，不受当前页面时间范围、筛选、搜索或分页影响。
- 复用既有冲突纯函数或下沉后的共同核心；禁止在浏览器用当前页数据推算，也禁止对每个候选负责人逐项发请求。
- 保留既有 `/work-plans/conflict-check` 兼容，不扩大本票为公开接口移除。

### R3 抽屉状态与刷新

- 仅可编辑抽屉请求候选预览；owner 字段缺失、不是 `single_select`、起止不完整或区间非法时不请求且不显示候选标记。
- 打开抽屉开始一次预览，首轮沿用约 400ms 防抖以等待表单快照初始化；`startAt`、`endAt`、`status`、`statusMode` 或编辑 `id` 变化后同样防抖约 400ms 重新请求。
- 抽屉保持打开时每 30 秒刷新一次；刷新时间基准和响应中的 `evaluatedAt` 保持一致。
- 请求竞态以最后一次有效请求为准；抽屉关闭或输入变化时不得让旧响应覆盖新状态。
- 状态至少区分 loading、success、error。新一轮失败后清除本轮候选标记并显示「负责人冲突信息暂不可用」；不得把失败显示为“无冲突”。后续刷新成功时自动恢复。
- 同一预览响应同时驱动所有候选标记和当前已选负责人的详细提示；不再为选中负责人额外发起另一套实时校核请求。

### R4 下拉与详情呈现

- 无冲突选项保持原文；冲突选项显示 `姓名（⚠ 冲突 N 项）`。
- 标记只是 `<option>` 可见文本，不改变 option `value`、排序、禁用状态或保存载荷。
- 选中冲突负责人后，折叠状态下的 select 也显示同一标记；负责人区域继续使用现有 amber 警示边框和 Counterpart 详细文案。
- 选中无冲突负责人后不显示详细提醒；选中冲突负责人后详情与该选项 N 项严格一致。
- error 提示位于负责人区域并可被辅助技术感知；loading 不宣称“无冲突”，也不阻止选择。
- readOnly 抽屉沿用 Work Plan 响应中的既有只读冲突详情，不获取或展示候选预览。

## Out of scope

- 禁止选择或禁止保存冲突负责人。
- 未来 Recurring Series 冲突预演、负责人负载视图、冲突豁免、通知或导出。
- 修改 Owner Conflict 的半开区间、状态、owner identity 或成对关系语义。
- 替换原生 select、在 option 内展示工作名称/时间、改变自定义字段 Option Order。
- 删除既有 `/work-plans/conflict-check`。

## Acceptance criteria

1. 打开新建或编辑抽屉后，所有冲突的未归档负责人候选均显示准确数量；无冲突选项文本不变。
2. 同 owner 精确相交会标记；端点相接、different owner、空 owner、任一方 completed/cancelled 均不标记。
3. automatic/manual 草稿状态均按 R1 计算；编辑 completed/cancelled 计划不再出现既有过度提醒。
4. 编辑排除自身；当前 Occurrence 的判断不被未来系列实例汇总放大。
5. 打开抽屉或修改时间/状态后约 400ms 内更新，打开期间每 30 秒刷新；迟到响应不能覆盖最新结果。
6. 候选标记数量与选中后的 Counterpart 详情一致，冲突负责人可正常保存，提交载荷不包含派生预览数据。
7. 请求失败明确显示“暂不可用”、清除候选标记且不阻塞操作；重试成功后恢复。
8. 服务端契约、纯函数/路由集成、Web 组件测试与全仓 typecheck/test 通过。
9. 真实浏览器覆盖桌面与窄屏、亮色与暗色、新建与编辑、loading/error/恢复以及原生下拉可读性。

## Delivery tickets

1. `01-conflict-preview-contract-and-service.md` — 建立全候选预览契约、服务端计算与状态边界。
2. `02-owner-picker-markers.md` — 抽屉接入预览状态机、候选标记和详情共用结果。
3. `03-regression-and-browser-qa.md` — 完成回归矩阵、真实浏览器和文档结案。

## QA 记录（2026-09-10）

- 浏览器：Codex In-app Browser；页面身份 `http://127.0.0.1:5173/work-plans`，标题「工作计划」；使用系统临时目录隔离数据库，未触碰正式 `data/workplan.db`。
- 桌面亮色/暗色：新建与编辑抽屉均能看到 `冯铭倩（⚠ 冲突 1 项）`；选中后负责人区域显示 amber 边框、冲突工作名称和完整时间；冲突负责人仍可保存。
- 窄屏 390×844：抽屉无横向溢出，负责人标记与详情可滚动查看；原生 select 的 option value 与 Option Order 保持不变。
- 错误恢复：临时停止 API 后，抽屉显示「负责人冲突信息暂不可用」并清除标记；恢复服务后自动恢复候选标记和详情。
- 页面快照均有 meaningful 内容、无框架错误覆盖层；最终浏览器错误/警告日志为空。代表性截图已通过浏览器工具展示，未写入仓库。
