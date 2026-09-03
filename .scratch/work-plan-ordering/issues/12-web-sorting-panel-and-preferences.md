# 12 — 实现工作计划页排序体验

Type: task
Status: ready-for-agent
Blocked by: 10
Spec: ../spec.md
Scope: `apps/web/src/pages/WorkPlansPage.tsx`、相关组件、API 客户端、样式与 Web 测试

## Background

工作计划页目前读取最多 500 条并在浏览器内过滤和排序。需要切换到服务端查询，并提供 URL 可分享、账户隔离且无障碍的最多五级排序面板。

## Work

1. 页面查询改用 `/work-plans/query`，把搜索、筛选、时间范围和排序交给服务端；表格与甘特图共享返回的 `items`，移除 Work Plan 客户端二次排序。
2. 实现排序面板：默认排期、添加/删除、最多五项、唯一字段、逐项方向、可访问的上移/下移和恢复默认。
3. 实现规范 URL `sort=<field>:<direction>,...`，支持直达、刷新、复制和 Back/Forward；默认不写参数。
4. 实现带版本、按稳定账户 ID 隔离的浏览器偏好，以及 URL → 偏好 → 默认的优先级。URL 不反向覆盖保存值，用户主动修改时才更新两者。
5. 非法 URL 整体降级并提示；本地偏好逐项清理归档、未知、重复或不支持字段并写回。
6. 加载时保留上次成功结果并显示状态；失败时保留页面现场、提供重试，并区分“选择的排序”和“已经成功应用的排序”。
7. 桌面和 `<=720px` 提供相同功能；纯键盘可完成字段添加、方向、优先级和删除。Administrator、Editor、Viewer 行为一致。
8. 添加 Web 测试，覆盖 URL/历史、账户切换、字段归档、加载/错误、键盘、窄屏和表格/甘特相同顺序。

## Acceptance

- 页面不再依赖 `/work-plans?limit=500` 获取全部数据，也不在前端重排 Work Plan。
- 最多五级排序和默认恢复完全符合规格，URL 与偏好可预测。
- Viewer 能排序但没有写业务数据的能力。
- 加载/失败不会闪空或把未生效排序用于后续动作。
- Web typecheck/test 通过。

## Comments

