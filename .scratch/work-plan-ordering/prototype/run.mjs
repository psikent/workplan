// 票据 08 原型入口：node .scratch/work-plan-ordering/prototype/run.mjs
// 隔离原型：不导入应用任何模块，只复用 apps/server 的 better-sqlite3 依赖；数据库落在 data/（gitignore）。
import "./bench.mjs";
