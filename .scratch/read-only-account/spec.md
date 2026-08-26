# Spec: 只读账户（Viewer）

> Status: **待开发** — 规格已定稿（`/grill-with-docs` 共识，2026-08-26），实施票据已建。

## Goal

新增一种名为 **Viewer**、界面显示为「只读账户」的账户角色。Viewer 可通过密码登录 Web 工作台，也可通过访问 Token 查询和导出全部业务数据，但不能改变业务数据、管理访问权限或操作环境配置。

## Terms

见 `CONTEXT.md`：**Administrator / Editor / Viewer / Token-only Account**。

## Background facts

- 当前角色只有 `admin` 和 `editor`；用户表的数据库约束也只接受这两个值。
- Editor 可使用密码或仅 Token 登录，并可修改除管理员专属资源外的全部业务数据。
- 当前授权仅区分普通认证与 `admin`，尚无「可查询但不可写」的能力层级。
- Work Plan 高级搜索 `POST /api/v1/work-plans/search` 和自定义 XLS 导出 `POST /api/v1/work-plans/export.xls` 都是纯查询操作，不能按 HTTP 方法直接判定是否写入。

## Requirements

### R1 角色与登录方式

- 用户角色扩展为 `admin | editor | viewer`；中文界面将 `viewer` 显示为「只读账户」。
- Administrator 可创建密码 Viewer 或 Token-only Viewer。
- 密码 Viewer 可登录 Web 工作台；Token-only Viewer 只能通过访问 Token 调用 API。
- Viewer 复用 Editor 的账户生命周期：Administrator 可设置或重置密码、签发或撤销 Token、停用或启用账户。
- 账户角色创建后固定；本期不提供 Editor 与 Viewer 之间的角色转换。

### R2 查询范围

- Viewer 可查询与 Editor 相同的完整业务数据，不按负责人、创建人或账户做行级隔离。
- 查询范围包括：工作台数据、Work Plan、Monthly Goal、Recurring Rule、Goal Recurrence、Custom Field 定义、Work Owner Account 映射和 XLS 导出模板。
- Viewer 可使用 Work Plan 普通查询、高级搜索及详情接口。
- Viewer 可执行现有 JSON 数据导出、模板 XLS 导出和自定义 XLS 导出。
- 账户列表、访问 Token 列表、Environment Configuration Package、数据导入和全局定义写操作仍仅 Administrator 可用。

### R3 服务端授权

- 认证路由按能力分为三层：默认查询、`write`、`admin`。
- Administrator 可访问全部三层；Editor 可访问查询和 `write`；Viewer 只能访问查询。
- 所有业务 mutation 路由必须显式声明 `write`；既有 Administrator 专属路由继续声明 `admin`。
- `POST /api/v1/work-plans/search`、`POST /api/v1/work-plans/export.xls`、登录和退出不标记为业务写入，Viewer 可正常使用。
- Viewer 调用 `write` 或 `admin` 路由时返回 HTTP 403 和现有错误码 `INSUFFICIENT_PERMISSION`；不得返回 404 或 405，也不得发生部分写入。
- 未认证请求继续返回现有 401；Cookie 会话的 CSRF 与 Origin 校验规则保持不变。

### R4 数据库兼容

- 新迁移扩展用户角色约束以接受 `viewer`。
- 迁移必须保留现有 Administrator、Editor、密码哈希、启停状态、版本号、会话和访问 Token，不改变任何现有账户的角色。
- 迁移完成后认证表外键完整，既有有效会话和 Token 仍可继续认证。

### R5 管理员账户界面

- 账户创建表单增加账户类型选择：编辑者或只读账户；登录方式继续支持密码登录和仅 API Token。
- 账户卡片准确显示「管理员」「编辑者」「只读账户」及对应登录方式。
- Administrator 可对 Editor 和 Viewer 使用相同的密码、Token、停用和启用操作；Administrator 自身的既有限制保持不变。
- 本期不提供修改现有账户角色的控件或 API。

### R6 Viewer Web 工作台

- Viewer 保留工作台、工作计划和月目标导航，可使用列表、搜索、筛选、分页、详情查看及业务导出。
- 侧栏账户信息显示「只读账户」；工作计划和月目标页面显示轻量提示，说明当前只能查询和导出。
- 隐藏所有业务写入口，包括新增、保存、删除、归档、状态变更、目标关联、排序、重复规则维护和系列解散。
- Work Plan 详情以只读方式呈现；时间轴允许选择和查看提示，但不得通过双击、拖动或调整宽度创建或修改 Work Plan。
- Viewer 不能通过直接访问 URL 打开 Custom Field、账户管理或设置页面；沿用现有非管理员重定向行为。
- 前端限制仅用于体验；服务端授权仍是最终安全边界。

### R7 既有行为

- Administrator 和 Editor 的登录、查询、写入、导出和管理能力保持不变。
- 现有 API 路径和业务数据响应结构不变；用户响应中的 `role` 新增可能值 `viewer`。
- 本期不修改部署配置、数据导出格式或访问 Token 格式。

## Out of scope（本期）

- 按负责人或账户隔离数据。
- 自定义权限、字段级权限或按页面配置权限。
- 角色转换、Viewer 自助管理 Token 或密码。
- 审计日志、审批流程和新的账户恢复机制。
- 新的导出格式、Environment Configuration Package 查询权限或数据导入权限。

## 票据规划

- 01 领域契约与认证迁移。
- 02 服务端能力授权与 Viewer 生命周期。
- 03 管理员账户管理界面。
- 04 Viewer 只读工作台。
- 05 回归与验收。

## 验收标准

1. Administrator 能创建密码 Viewer 和 Token-only Viewer，并能管理其密码、Token 与启停状态。
2. 两种 Viewer 均能认证，`/api/v1/auth/me` 返回 `role: viewer`。
3. Viewer 能查询全部业务数据，使用高级搜索，并完成 JSON、模板 XLS 和自定义 XLS 导出。
4. Viewer 调用任一业务写接口或管理员专属接口均得到 `403 INSUFFICIENT_PERMISSION`，且数据、排序和版本号均不变化。
5. Viewer Web 页面保留查询和导出，显示只读身份与轻量提示，不出现任何写入口；时间轴不能创建、拖动或调整 Work Plan。
6. 既有数据库升级后用户、会话和 Token 完整，Administrator 与 Editor 行为无回归。
7. 全仓 `typecheck`、`test` 和 `build` 通过。
