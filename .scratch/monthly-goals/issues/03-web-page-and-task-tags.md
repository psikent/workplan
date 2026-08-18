# 月目标配置页与任务侧标签（web）
Type: task
Status: ready-for-agent
Blocked by: 01, 02

## 背景
规格 R2/R5/R6/R9。实现独立配置页、导航与路由、任务抽屉多选与列表 chips。
## 改动清单
1. apps/web/src/components/AppShell.tsx：navItems 增加「月目标」（adminOnly: false）。
2. apps/web/src/App.tsx：注册 /monthly-goals 路由（无 admin 守卫）。
3. 新建 apps/web/src/pages/MonthlyGoalsPage.tsx：月份选择、目标列表、月度汇总、新建/编辑抽屉、关联/解绑任务、归档/恢复/删除；标签与文案按 R9；布局遵循 DESIGN.md。
4. apps/web/src/components/WorkPlanDrawer.tsx：新增「月目标」多选区块，保存时提交 monthlyGoalIds；服务端错误回显为表单错误。
5. apps/web/src/pages/WorkPlansPage.tsx：PlanRow 显示目标标签 chips；提供目标列表数据源给抽屉（useQuery 复用 /monthly-goals）。
## 验收
- 管理员与编辑者均可见「月目标」导航并可完成全部配置操作。
- 新建/编辑任务时多选月目标保存后回显 chips；目标页与任务侧双向改关联一致。
- 月份切换、归档/恢复、删除确认、乐观锁冲突提示均可用。
- 页面样式与既有页面一致（白画布、导航、抽屉、状态徽标）。