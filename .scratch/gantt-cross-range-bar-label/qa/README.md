# QA 证据 — 跨周/跨月甘特条内文字可见

- 日期：2026-09-09（周二；周视图为周一~周日，今天 = 09-09 周三）
- 构建：`apps/server` + `apps/web` 全新构建；隔离实例 `DATA_DIR=$(mktemp -d) PORT=3102 node apps/server/dist/index.js`（真实库 `./data` 未动）
- 账号：setup token 建临时管理员 `qaadmin`；API 造数（setup → custom-fields → work-plans，会话 cookie + CSRF 头）
- 浏览器：playwright-core + 系统 Chromium（/opt/homebrew/bin/chromium）无头；localStorage 直写甘特显示属性（title/status/custom:owner）与主题偏好；直连 URL `/work-plans?view=week|month&date=…` 切换视图

## 造数

| 计划 | 范围 | 备注（色） | 验证点 |
| --- | --- | --- | --- |
| 跨两周改造工程 | 09-09 ~ 09-15 | 4.自动化（绿） | 跨 2 周：起始周右残段 + 结束周左残段 |
| 跨三周检修项目 | 09-08 ~ 09-22 | 7.检修（琥珀） | 跨 3 周：首/中/尾三周 |
| 跨月设备巡检 | 08-28 ~ 09-03 | 未设置（默认青灰） | 月视图跨月两端 |
| 二十字工作内容内容很长需要截断测试用 | 09-13 ~ 09-15 | 未设置 | 某周仅 1–2 天窄段；超长标签（20 字标题 + 12 字负责人） |
| 常规周计划 | 09-08 ~ 09-11 | 1.值班（蓝） | 范围内对照（外观不变） |

负责人各不相同，避免冲突警示干扰判定。字段：备注 single_select（三选项配色）+ 工作负责人 short_text。

## 证据清单与结论

| 截图 | 结论 |
| --- | --- |
| light-week-a / dark-week-a | 起始周：跨三周（首段 [100,700] 锚 400）、跨两周（段 [200,700] 锚 450）文字均可见；窄段计划仅 09-13 一个右缘日条，文字钳回画布（左缘优先）完整可读；对照计划条内居中不变 |
| light-week-b / dark-week-b | 结束周（核心场景）：跨两周与窄段计划的左残段（[0,200] 锚 100）文字全部可见——修复前全跨度中点在画布外整体不可见；跨三周中间周整段居中（锚 350） |
| light-week-c / dark-week-c | 跨三周尾部残段（[0,200]）文字可见、贴左缘钳回 |
| light-month-sep / dark-month-sep | 9 月月视图：跨月计划左残段（01–03）文字锚定残段中点；月视图画布宽于视口为既有横向滚动行为，右缘裁剪为滚动视口而非文字截断 |
| light-month-aug-tail / dark-month-aug-tail | 8 月月视图滚动至月尾：跨月计划右残段（28–31）可见，文字贴画布右缘向左延展、完整可读 |
| narrow390-week-b | 390px 窄视口：超长标签单行截断追加「…」（「…冯铭倩欧阳铁柱联…」）且钳入画布；省略号路径真实浏览器生效 |
| light-week-b-tooltip | 悬浮 tooltip 完整出口：全标题「二十字工作内容内容很长需要截断测试用」+ 日期 + 状态 + 负责人（条内截断不影响 tooltip） |
| 备注 | 顺带复验甘特备注着色不回归：琥珀/绿/蓝/默认灰四态与图例（含「未设置」）全部正常 |

浅/暗两主题全量复验；范围内对照计划在全部视图中条内文字居中、外观与旧版一致（可见条段 = 全跨度）。

## 备注（QA 过程记录）

- QA 服务器空库启动会以 warn 日志打出一次性 setup token（`app.ts` `one-time setup token`），curl 走 `/api/v1/setup` → cookie + csrfToken。
- frappe `draw_label` 会在 rAF 中异步改写标签位置（`update_label_position`），截图前等待 600ms 让「库改写 → 观察器回写」稳定。
- 月视图画布（dayCount×columnWidth）宽于甘特容器属既有设计：条与文字超出视口部分横向滚动可见；本规格的「画布」判定边界是该滚动内容宽度，与视口裁剪无关。
