# Spec: 工作任务负责人时段冲突校核(Owner Conflict Alerts)

> Status: **已实现** — 2026-09-05 实现并验收(票据 01–05 全部完成)。验证结论见文末「验收记录」。

## Goal

不同的工作任务,若同一**工作负责人**的计划时段精确相交,即构成**负责人时段冲突**。冲突不阻止保存,仅通过四处 UI 提醒:

1. **甘特条**:冲突任务的甘特条整条变为冲突警示色。
2. **工作计划列表**:冲突任务行背景变色。
3. **甘特条浮动提示**:强制展示工作负责人属性,并列出与其冲突的任务清单。
4. **详情抽屉**:工作负责人填写区域边框变色 + 小号文字提醒(编辑未保存时实时校核)。

## Terms

- **Owner Conflict(负责人时段冲突)**:两条不同任务,`customFields.owner` 值相同且非空,计划区间 `[startAt, endAt)` 精确相交,且双方状态均为活跃(`pending` / `in_progress`)。
- **Counterpart(冲突对象)**:与某任务构成冲突的另一条任务;一条任务的冲突清单是其全部冲突对象,不做传递闭包聚类。

实现时在 `CONTEXT.md` 词汇表登记(票据 01 交付)。

## Background facts

- 工作负责人不是原生列,而是保留键为 `owner` 的自定义字段(通常 `single_select`),值存于 `customFields.owner`;`ownerAccount` 是服务端派生的只读字段,且契约禁止其用于筛选/排序。冲突判定键用 `customFields.owner` 选项值,与账号映射无关。
- 时间字段 `startAt` / `endAt` 为带时区偏移的 ISO 字符串;`endAt > startAt` 已有校验,不存在零时长区间。
- 状态:`deriveWorkPlanStatus` 派生 `pending` / `in_progress` / `completed`;`cancelled` 仅手动设置。
- 前端列表与甘特共享同一查询 `plansQuery`(`POST /work-plans/query`),按可见周/月范围 + 状态筛选 + 分页(pageSize 200),30s 轮询。**纯客户端算冲突会有盲区**:冲突对象落在视野外或被筛掉时漏报——故冲突由服务端全局计算(决策 5)。
- 甘特:`GanttTimeline.tsx` 以 `custom_class: gantt-${status}` 着色,重渲染由 `ganttInputSignature` 驱动,浮动提示由 `formatGanttTooltip` 生成 HTML、提示属性用户可配置(localStorage `workplan:gantt-tooltip:v1`)。
- 列表行 `.plan-row` 目前只有 surface 背景 + hover 态;抽屉负责人是自定义字段控件 + 派生账号只读展示,表单只有表单级报错样式,无字段级警告样式。
- 警告色已有 **amber** 琥珀色板(离线横幅、待办状态在用)与 **coral** 珊瑚红(表单报错、危险操作在用);仓库规则:颜色只准走 `:root` 明暗两套 token,写死面色即回归。

## Requirements

### R1 冲突判定语义

- 冲突 = 任务 P1、P2 同时满足:
  1. `P1.customFields.owner === P2.customFields.owner`,且值非空;
  2. 区间半开相交:`P1.startAt < P2.endAt && P2.startAt < P1.endAt`(毫秒级精确时刻;端点相接不算冲突);
  3. 双方 `status ∈ {pending, in_progress}`(`completed` / `cancelled` 不参与)。
- 负责人为空(未指派)的任务不与任何任务冲突。
- 冲突是**成对**关系:A-B、B-C 冲突而 A-C 不重叠时,A 的清单只含 B,C 的只含 B,B 的含 A 与 C;不做连通分量聚类。

### R2 契约与服务端全局计算

- `workPlanSchema` 响应侧新增派生只读字段 `ownerConflict`:

  ```ts
  ownerConflict: {
    owner: string; // 命中的 owner 选项值
    counterparts: Array<{ id: string; label: string; startAt: string; endAt: string }>;
  } | null // 无冲突为 null;counterparts 按开始时间升序
  ```

  `label` 用列表/甘特现有展示的任务名称字段;创建/更新入参剥离或忽略该字段。
- 服务端查询管道(`work-plan-query`)在每次 `/work-plans/query` 执行**全局**冲突计算:取全部活跃且 owner 非空的任务最小投影,按 owner 值分组、组内按 `startAt` 排序扫描重叠对(O(n log n),团队量级数百条,开销可忽略),构建 id → counterparts 映射,`serializeRow` 时附加。
- 计算与请求的范围/筛选/分页无关;30s 轮询与 mutation 失效后自然刷新。

### R3 实时校核端点

- 新增 `POST /work-plans/conflict-check`(路径前缀随现有 v1 约定):
  - 入参:`{ id?: string; owner: string; startAt: string; endAt: string }`(`id` 用于编辑场景排除自身);
  - 出参:counterparts 清单,形状同 R2;
  - 语义与 R1 一致:对给定 owner + 区间返回与其相交的活跃任务;不落库、无副作用;权限同查询端点。

### R4 甘特条变色

- 冲突任务的甘特条 `custom_class` 叠加 `gantt-conflict`,条体与进度整体覆盖为冲突警示色,**优先于**状态配色;非冲突条维持状态色。
- `ganttInputSignature` 纳入冲突标记(如 counterparts id 串),冲突出现/消失必须触发甘特重渲染。

### R5 工作计划列表行背景

- 冲突任务行叠加 `plan-row-conflict` 修饰类:背景改用 amber 软底,hover 态定义对应冲突 hover 色;行内其余单元格内容不变。

### R6 甘特浮动提示

- 冲突任务的浮动提示:
  1. **强制**展示「工作负责人」属性行——无论用户提示属性配置是否勾选负责人——并以警示色着色;
  2. 追加冲突清单区块,逐条列出冲突对象 `label` 与日期区间。
- 非冲突任务的提示维持用户配置,行为不变。

### R7 详情抽屉实时提醒

- 工作负责人填写区域(自定义字段控件与派生账号展示的外层容器)在冲突时边框变警示色,下方以**小号文字**列出冲突对象(如「该负责人在此时段已有其他任务:与【XX】时间冲突」)。
- **编辑中实时校核**:表单内 owner / startAt / endAt 任一变化后防抖(约 300–500ms)调用 R3 端点,以返回结果驱动边框与文字;owner 为空或起止未填齐时不查询、不提醒。打开抽屉的初始态可直接用响应携带的 `ownerConflict`,首次防抖查询到达后覆盖。
- 仅提醒:不阻止保存,不进入表单必填校验链。

### R8 色彩与主题

- 四处置色统一走 amber 警告色板(与表单报错的 coral 拉开层级),甘特条新增 token(如 `--gantt-bar-conflict`)与行背景/hover/边框全部落在 `:root` 明暗两套 token 中;禁止写死面色。

## Out of scope

- 工作台(OverviewPage)展示冲突;导出列;按负责人负载/资源视图;冲突豁免白名单;Bark 推送冲突提醒;阻止保存;按自然日粒度判定;`ownerAccount` 参与判定;冲突计算缓存优化。

## 验收标准

1. 语义:同 owner 精确相交的活跃任务互为冲突对象;端点相接不算;`completed` / `cancelled` / 空 owner 不产生冲突;成对不传递。
2. 服务端:`/work-plans/query` 每项含 `ownerConflict`(无冲突为 null);冲突对象在被筛掉的状态或视野外时,任务本身仍被正确标记。
3. 甘特:冲突条整条警示色(明暗一致),非冲突条维持状态色;冲突出现/消失后甘特条随刷新变色。
4. 列表:冲突行软底背景,明暗一致,hover 正常。
5. 浮动提示:冲突任务强制显示负责人行 + 冲突清单;非冲突任务提示配置不受影响。
6. 抽屉:打开冲突任务即有边框 + 小字;编辑负责人/日期造成或解除冲突时防抖刷新;不阻止保存。
7. 回归:web / server typecheck 与测试全绿;四处置无写死面色,明暗主题均验收。

## 验收记录(2026-09-05)

1. **语义**:纯函数单测 11 例(端点相接/毫秒相交/状态与空 owner 排除/成对不传递/多任务两两清单)+ 服务端集成测试全绿。
2. **服务端**:`/work-plans/query` 与按 id 详情每项携带 `ownerConflict`;范围筛选、状态筛选、分页视野外/被筛掉的冲突对象仍被正确标记(集成测试覆盖)。
3. **甘特**:冲突条整条 `gantt-conflict` 警示色、优先于状态色;`ganttInputSignature` 纳入 counterparts,冲突增删触发重渲染。实现备注:frappe 的 `custom_class` 仅支持单 token(内部 `classList.add` 不接受空格),冲突类改由渲染后几何校正阶段 `classList.toggle` 同步——多 token 写法会让整图甘特条渲染失败(已在真机暴露并修复)。
4. **列表**:冲突行 `plan-row-conflict` amber 软底,hover 对应 `--amber-soft-hover`。
5. **浮动提示**:冲突任务强制负责人行(警示色)+ 冲突清单;非冲突提示维持用户配置(单测 + 真机)。
6. **抽屉**:初始态用响应 `ownerConflict`;owner/起止变化防抖 400ms 调 `conflict-check`(编辑传 id 排除自身,竞态最后一次为准);改期后提醒即时消失;新建冲突任务提醒出现且保存不被阻止。
7. **回归**:全仓 typecheck + 测试全绿(contracts 20 / server 181 / web 281 / scripts 52);styles.css 新增规则仅引用 token,字面色只出现在 `:root` token 定义;明暗两套主题真机核对通过。

浏览器 QA(基于复制真实库的隔离实例,亮/暗两主题,截图见 `qa/`):链条 A-B-C 成对标记正确、端点相接不标记、completed/空 owner 对照组不标记;改期解除冲突、新建冲突保存成功均通过。QA 期间另发现一个与本功能无关的存量 bug:抽屉打开手动状态计划时状态被派生值覆盖,已登记 `.scratch/drawer-manual-status-clobbered/issues/01-open-clobbers-manual-status.md`。

Code review 备注(2026-09-05,双轴):Standards 无硬性违规;Spec 唯一偏差为 R2「入参剥离或忽略」实际是 strict 拒绝(422)——与既有派生字段 ownerAccount 的入参先例一致(回写完整响应本就会因 strict 被拒),不为削弱契约而放宽。
