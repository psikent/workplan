# 04 — 详情抽屉实时冲突提醒
Type: task
Status: ready-for-agent
Blocked by: 02
Spec: ../spec.md
Scope: apps/web/src/components/WorkPlanDrawer.tsx、apps/web/src/styles.css、web lib/测试

## 背景

规格 R7。抽屉是唯一「编辑中」的提醒面:打开时按响应 `ownerConflict` 提醒,编辑负责人/起止未保存期间防抖调用 `conflict-check` 实时重算。仅提醒,不阻止保存。

## 改动清单

1. **负责人区域警示**:工作负责人填写区域(自定义字段控件与派生账号展示的外层容器)冲突时叠加修饰类:边框 amber 变色;下方**小号文字**列出冲突对象(「该负责人在此时段已有其他任务:与【label】…时间冲突」,多个对象逐条或并列)。
2. **实时校核**(防抖 hook,约 300–500ms):
   - 触发:表单 owner / startAt / endAt 任一变化;
   - 调用 `POST /work-plans/conflict-check`(编辑传当前 `id` 排除自身);
   - owner 为空或起止未填齐:不发请求、清除提醒;
   - 打开抽屉初始态用响应携带的 `ownerConflict`,首次防抖查询到达后覆盖;请求竞态以最后一次为准。
3. **约束**:不阻止保存;不进入必填校验链;不改变现有表单错误样式。
4. **样式**:容器边框与小字全部走 amber token(明暗两套),禁止写死面色。
5. **web 测试**:提醒状态机——初始有冲突 / 防抖后出现冲突 / 防抖后解除冲突 / owner 空不查询;不阻断提交。

## 验收

- 规格验收标准 6;web typecheck 与测试通过。
