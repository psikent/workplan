# Spec: 字段定义折叠配置与抽屉折叠区(Custom Field Drawer Collapse)

> Status: **已实施** — grilling 2026-09-08 用户确认;票据 01–03 已建(01 → 02/03)并全部落地(2026-09-08,双端测试全绿 + 隔离实例手工验收通过)。

## Goal

字段定义新增「是否折叠」配置:被标记的自定义字段在计划抽屉(查看/编辑/新建三合一)中收纳入抽屉底部默认收起的「更多信息」折叠区,展开后可查看/编辑,以精简抽屉主区信息密度。折叠仅是呈现收纳,不改变数据与校验。

## Decisions(grilling 2026-09-08,用户已确认)

- **D1 配置归属**:全局字段定义配置(Administrator 维护),随环境配置包迁移——区别于列表列/甘特属性等浏览器本地偏好,折叠是环境级定义的一部分。
- **D2 展开语义**:展开折叠区=可查看/编辑被折叠字段的值;抽屉内不提供折叠配置入口,配置只在字段定义页。
- **D3 生效范围**:查看/编辑/新建三种模式一致。
- **D4 必填字段**:允许折叠;保存失败时自动展开折叠区,错误文本匹配到折叠字段 label 时滚动定位该控件(服务端必填错误含 label:`自定义字段"X"为必填项`)。
- **D5 展开状态**:每次打开抽屉默认收起,不持久化、不记忆。
- **D6 折叠区标题**:「更多信息 (N)」,N=折叠字段数;点击标题切换展开/收起。
- **D7 配置入口**:字段定义编辑弹窗加开关 + 表格加「折叠」列(是/否),风格同「必填」。

术语:见 CONTEXT.md「Field Collapse (字段折叠)」。

## Background facts

- 字段定义存于 `custom_field_definitions`(Drizzle:`apps/server/src/db/schema.ts:88-105`),现有列无任何显隐配置;`archived_at` 是唯一全局开关(归档=处处消失)。迁移为内联 DDL(`apps/server/src/db/migrate.ts` 的 `migrations` 数组,应用逻辑 `migrate()`)。
- 契约(`packages/contracts/src/index.ts`):`customFieldDefinitionSchema`(:581-595)、`createCustomFieldSchema`(:597-608)、`updateCustomFieldSchema`(:610-617,可更新 label/description/required/defaultValue/archived/version)、`envConfigPackageFieldSchema`(:766-768,字段定义随环境包携带 sortOrder)。
- 服务端:`apps/server/src/modules/custom-fields.ts` — `list()`(:56-95,按 sort_order 排序)、创建(:107 附近"已有计划时必填须默认值"约束)、更新(:168 同约束)、值必填校验(:324,错误含字段 label)。环境包导入导出:`apps/server/src/modules/env-config.ts`。
- 字段定义页:`apps/web/src/pages/settings/CustomFieldsSettings.tsx` — 表格列:拖拽把手/字段名称/稳定键/字段类型/必填/默认值/操作(:231-299),编辑弹窗唯一开关=必填(:254-263);已有 vitest 测试 `CustomFieldsSettings.test.tsx`。
- 抽屉:`apps/web/src/components/WorkPlanDrawer.tsx` — 固定字段硬编码(:257-270)+ 三个 `form-section` fieldset:计划周期(:271-284)/月目标(:286-309)/自定义字段(:311-332);自定义字段排序=必填优先再按定义 sortOrder(:228-230);`key === "owner"` 字段特例包冲突提示 + 派生只读「工作负责人账号」(:231-239、:316-325);保存错误统一走顶部 `form-error`(:333,前端仅校验时间范围,其余 catch 服务端错误)。
- 现有按字段显隐均为浏览器本地偏好(列表列 `workplan:list-columns:v1` / 甘特条属性 / 甘特悬浮,`apps/web/src/lib/plan-preferences.ts`),均不控制抽屉;抽屉始终渲染全部未归档字段。

## Requirements

### R1 字段定义「折叠」配置(服务端+契约)

- DB:`custom_field_definitions` 新增 `collapsed` 布尔列,默认 `false`;内联迁移,存量字段行为不变。
- 契约:`customFieldDefinitionSchema` 输出 `collapsed`;`createCustomFieldSchema` 增可选 `collapsed`(缺省 false);`updateCustomFieldSchema` 可更新 `collapsed`(乐观锁 version 沿用)。
- 服务端:创建/更新/列表序列化均携带 `collapsed`;必填/默认值等既有约束不动。

### R2 环境配置包

- 导出的字段定义包含 `collapsed`;Additive Import 沿用现状(稳定键已存在则跳过);Sync Import 将 `collapsed` 作为非破坏变更对齐(不进破坏性预览)。

### R3 字段定义页呈现

- 表格新增「折叠」列,显示「是/否」,风格同「必填」列。
- 编辑弹窗新增「折叠」开关(说明文案表明效果:字段收入详情抽屉底部「更多信息」折叠区);新建与编辑均生效。

### R4 抽屉折叠区

- 「自定义字段」分区只渲染未折叠字段,排序规则不变(必填优先+定义顺序);其后(底部按钮区之前)新增「更多信息 (N)」区:默认收起,点击标题展开/收起;区内渲染折叠字段(同排序规则、同控件渲染,可查看/编辑)。
- 查看/编辑/新建三种模式一致;每次打开抽屉重置为收起(D5)。
- `owner` 折叠时,冲突提示区与派生「工作负责人账号」只读字段整体随入折叠区。
- 无折叠字段(N=0)时不渲染该区;全部折叠时「自定义字段」分区不渲染空壳。

### R5 校验兜底

- 保存失败(前端校验或服务端拒绝)且折叠区收起时自动展开;错误文本能匹配某折叠字段 label 时,滚动定位到该字段控件。

### R6 不影响范围

- 列表列/甘特条/甘特悬浮/XLS 导出/提醒不受 `collapsed` 影响;数据存储、必填校验、默认值生效逻辑不变。

## 验收标准

1. `corepack pnpm --filter @workplan/server typecheck && corepack pnpm --filter @workplan/server test` 与 `--filter @workplan/web` 同两项全绿;server 新增 collapsed 的 CRUD/序列化/环境包用例,web 新增设置页用例,既有用例零回归。
2. 隔离实例(临时 DATA_DIR,勿动 `./data`)手工验收:设置页配置折叠↔表格/弹窗呈现一致;抽屉三种模式折叠区行为符合 R4;owner 随折叠;必填折叠字段保存失败自动展开并定位;环境包导出→导入保留折叠配置。
