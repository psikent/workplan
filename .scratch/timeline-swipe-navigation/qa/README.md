# QA 脚本

浏览器验收脚本与记录。`session.json`（一次性会话）与 `.data/`（临时库副本）为本地运行残留，
已在交付前清理；重新运行前需按 `REPORT.md` 「复现脚本」小节重建隔离实例。

- `swipe-acceptance.mjs` — 手势方向、边界交接、反馈、边缘保留区、溢出
- `states-acceptance.mjs` — 反馈外观、减少动态效果、全屏、抽屉暂停、空态
- `failure-acceptance.mjs` — 失败停留与重试
- `role-loading-acceptance.mjs` — 加载状态与连续滑动
- `REPORT.md` — 验收结论与限制
- `*.png` — 浅/深色、加载、失败、全屏、抽屉暂停截图
