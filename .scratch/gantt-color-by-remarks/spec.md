# Spec: 甘特颜色编码改用备注,状态退出甘特视觉(Gantt Color Coding by Remarks)

> Status: **待实施** — grilling 2026-09-09 用户确认;票据 01–03 已建(01 → 02/03);架构决策见 `docs/adr/0012`。

## Goal

甘特条颜色从「状态」切换为「备注」选项色:管理员在字段设置页为备注(key `remarks`)的选项配色,甘特条按计划的备注值着色;状态退出甘特的一切视觉编码(条色、按状态的进度暗条),退化为纯数据属性,由列表徽章、筛选器、工作台等既有入口承载。

## Decisions(grilling 2026-09-09,用户已确认)

- **D1 范围**:仅甘特图。列表状态徽章列、状态筛选器、工作台统计与色条、月目标徽章、抽屉状态下拉全部维持现状。
- **D2 颜色来源**:选项级颜色属性——单选选项新增可选 `color`,取值限定预设色板(8 色,浅/暗两主题单值通用,不维护主题色对);色板之外的自由 hex 不接受。
- **D3 绑定方式**:固定绑定 `remarks` key(与 owner/ticket/risk 的 key 约定同模式),不做「甘特颜色跟随字段」的可配置项;数据层 `color` 列对所有单选字段通用,仅 UI 与甘特消费定向备注。
- **D4 空值与归档**:备注未设置或值为归档选项 → 中性灰(沿用现有默认条色 `--gantt-bar`,浅暗自适应);归档选项不进图例;字段不存在/已归档或没有任何选项配色 → 图例整体消失。
- **D5 冲突覆盖**:负责人冲突警示色保留,优先级高于任何备注色。
- **D6 状态退出甘特视觉**:移除 `gantt-<status>` 状态着色与按状态的进度差异(进度统一 0,即无暗条);甘特可选显示属性中的「状态」文本保留(默认关,用户主动勾选才出现)。
- **D7 已取消/已完成不可辨识**:接受甘特画面无法区分已取消/已完成计划;出口是状态筛选器与可选「状态」文本。
- **D8 设置页**:仅备注字段(key=`remarks`)的选项显示配色编辑器,其他单选字段不显示,避免无消费方的「死控件」。
- **D9 迁移**:`custom_field_options` 只加 `color` 列,不回填任何业务数据;上线后管理员在设置页为 值班/自动化/网络安全 配色。
- **D10 环境配置包**:选项 `color` 随包携带;Sync Import 将 color 差异归入 `update_option` 且 grade=safe(非破坏);Additive 沿用「键已存在则跳过」,不覆盖本地 color。

术语:见 CONTEXT.md「Remarks (备注)」「Option Color (选项颜色)」「Gantt Color Coding (甘特颜色编码)」。

## Background facts

- 着色机制:甘特条经 frappe-gantt `custom_class` 注入 `gantt-${plan.status}`(`apps/web/src/components/GanttTimeline.tsx:158-161`,单 token 约束见处内注释);状态色规则 `apps/web/src/styles.css:302-305`,变量浅色 `:56-67`、暗色 `:616-623`;默认条色 `--gantt-bar`(`:294-295`)。空时间轴占位条 `gantt-empty`(`GanttTimeline.tsx:170`)。
- 进度暗条按状态硬编码两处:`GanttTimeline.tsx:157`(completed=100/in_progress=50/其余 0)与 `:789`(1/0.5/0)。
- 冲突覆盖:`gantt-conflict` 类在 `GanttTimeline.tsx:775` 切换,规则 `styles.css:307-308` 特异性高于默认条规则;`--gantt-bar-conflict` 浅 `#b45309`(`:614` 暗 `#d97706`)。
- 甘特可选属性「状态」:`WorkPlansPage.tsx:237` 注册,渲染 `GanttTimeline.tsx:455-461`。
- 备注字段(生产数据):`key=remarks,type=single_select`,选项 option_1 值班/option_2 自动化/option_3 网络安全(sort 0/1/2)。`custom_field_options` 表(`apps/server/src/db/schema.ts:108-120`)与输出契约 `customFieldOptionSchema`(`packages/contracts/src/index.ts:572-579`)均无 color。
- 选项写路径契约:定义创建 `createCustomFieldSchema.options`(:606-609,value/label)、选项创建 `createCustomFieldOptionSchema`(:622-625)、选项更新 `updateCustomFieldOptionSchema`(:627-631,label/archived/version 乐观锁)。
- 环境包:`envConfigPackageFieldSchema = createCustomFieldSchema.extend({sortOrder})`(:769-771),选项形状继承自创建契约,color 加入后者即自动随包;差异计划条目 `envConfigOptionPlanItemSchema`(:856-862)现仅 value/label;ADR 0009 记录包内选项仅携带 value/label 的现状。
- 迁移为内联 DDL(`apps/server/src/db/migrate.ts` 的 `migrations` 数组)。
- 前端字段目录:`WorkPlansPage.tsx:155` 已取 `GET /api/v1/custom-fields`;计划值经 `WorkPlan.customFields` key→原始 value(`option_N`),甘特已消费 `custom:remarks` 做标签/悬浮(`GanttTimeline.tsx:455-461`),label 换算 `apps/web/src/lib/format.ts:66`。
- 图例:全库无既有图例组件。

## 预设色板(8 色,浅暗单值)

| 名称 | hex |
| --- | --- |
| 蓝 | `#3b82f6` |
| 青 | `#06b6d4` |
| 翠绿 | `#10b981` |
| 黄绿 | `#84cc16` |
| 琥珀 | `#f59e0b` |
| 橙 | `#f97316` |
| 玫红 | `#f43f5e` |
| 紫 | `#8b5cf6` |

## Requirements

### R1 单选选项 color 配置(服务端+契约)

- 契约(`packages/contracts/src/index.ts`):导出色板常量与校验 schema(color 必须为色板内 hex 或 null);`customFieldOptionSchema` 输出 `color: string | null`;`createCustomFieldSchema.options[]`、`createCustomFieldOptionSchema`、`updateCustomFieldOptionSchema` 增可选 `color`(传 null 清除,未传保持现状,乐观锁沿用)。
- DB:`custom_field_options` 新增 `color TEXT NULL`;内联迁移只加列,存量数据 color 全 null。
- 服务端(`apps/server/src/modules/custom-fields.ts`):定义创建(带选项)、选项创建、选项更新路径持久化 color;序列化输出;非法色值(非色板内)拒绝并返回明确错误。

### R2 环境配置包

- 导出的选项携带 `color`;Sync Import 差异比对纳入 color,color-only 差异归入 `update_option` 且 grade=safe;Additive Import 沿用「稳定键已存在则跳过」,本地 color 不被覆盖。计划/结果条目 schema 随之携带 color。

### R3 设置页配色编辑器(仅备注)

- `CustomFieldsSettings` 的选项管理 UI:key=`remarks` 的单选字段,选项行显示当前色点,编辑处提供色板(8 色点选 + 「无色」清除);保存走既有选项更新接口。
- 其他字段(含其他单选字段)不显示配色 UI;选项重命名/归档/重排路径不丢已有 color(未传保持现状)。

### R4 甘特条颜色编码

- `WorkPlansPage` 将备注选项 value→color 映射随 plans 传入 `GanttTimeline`(字段目录已在手)。
- 条形填充 = 备注选项色;备注未设置/值为归档选项/字段缺失 → 默认灰(`--gantt-bar`)。实现走 CSS 自定义属性:后渲染同步在 bar 元素上设 `--gantt-bar-fill`,样式 `.gantt-mount .bar { fill: var(--gantt-bar-fill, var(--gantt-bar)); }`;遵守 `custom_class` 单 token 约束,不新增状态类。
- 冲突覆盖保持:`gantt-conflict` 规则特异性高于默认条规则,覆盖任何备注色;移除冲突规则对 `.bar-progress` 的着色(暗条不复存在)。`gantt-empty` 占位条维持灰。

### R5 状态退出甘特视觉

- 移除 `custom_class: gantt-${status}` 注入与 styles.css 中 `.gantt-pending/.gantt-in_progress/.gantt-completed/.gantt-cancelled` 条形规则(浅、暗两套)。
- 进度统一 0:删除两处按状态的 progress 赋值(completed=100/in_progress=50/其余 0 与 1/0.5/0),恒 0(即无暗条)。
- 甘特可选显示属性「状态」文本保留,默认关,行为不变。

### R6 图例

- 甘特面板头部图例:按选项顺序(Order Order,见 CONTEXT.md「Option Order」)列出未归档备注选项(色点 + label),末尾附「未设置」灰点项。
- 隐藏条件:备注字段不存在/已归档,或没有任何选项配置颜色。

### R7 不影响范围

- 状态机制本身(自动派生、手动覆盖、筛选器、列表徽章、工作台统计、月目标徽章、抽屉下拉)不变;XLS 导出、提醒规则、Bark 推送不变。
- `remarks` key 特判仅两处:设置页编辑器显示、甘特颜色消费(同 owner/ticket key 约定模式)。

## 验收标准

1. `corepack pnpm --filter @workplan/server typecheck && corepack pnpm --filter @workplan/server test` 与 `--filter @workplan/web` 同两项全绿;server 新增 color 的 CRUD/校验/环境包用例,web 新增设置页/甘特着色/图例用例,`GanttTimeline` 既有 `custom_class === "gantt-pending"` 等断言更新为零回归。
2. 隔离实例(临时 DATA_DIR,勿动 `./data`)手工验收:设置页为三选项配色 → 甘特条即变色;空备注灰;持有归档选项值的计划灰且图例不列该选项;冲突条覆盖色;暗色主题下色板可读;全部选项无色时图例整体隐藏;状态筛选器/列表徽章/工作台统计行为不变;甘特「状态」文本属性仍可勾选。
