// 票据 17 前向修复：v13 已删除 work_plans.sort_order。若生产需要临时回滚到
// 仍向该列写入的旧二进制（票据 14–16 时代的代码），先运行本脚本以中性值把
// 列与索引事务性加回，再回滚应用——避免整库回档丢失新业务数据。
// 旧二进制把该列仅当兼容缝（固定写 0、不读业务含义），因此统一回填中性值 0。
// 运行：pnpm --filter @workplan/server exec tsx scripts/forward-fix-sort-order.ts [数据库路径]
// 未传路径时使用 DATA_DIR（默认 ./data）下的 workplan.db。建议先停服务再执行。

import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.argv[2] ?? path.join(process.env.DATA_DIR ?? "data", "workplan.db");
if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`);
  process.exit(1);
}

const sqlite = new Database(dbPath);
// 与服务端一致的忙等待：迁移重建期间避免立即 SQLITE_BUSY。
sqlite.pragma("busy_timeout = 5000");

const columns = (sqlite.prepare("PRAGMA table_info(work_plans)").all() as Array<{ name: string }>).map((column) => column.name);
const indexes = (sqlite.prepare("PRAGMA index_list(work_plans)").all() as Array<{ name: string }>).map((index) => index.name);

if (columns.includes("sort_order") && indexes.includes("work_plans_sort_idx")) {
  console.log("sort_order 列与 work_plans_sort_idx 均已存在，无需修复。");
} else {
  sqlite.transaction(() => {
    if (!columns.includes("sort_order")) {
      sqlite.exec("ALTER TABLE work_plans ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
    }
    if (!indexes.includes("work_plans_sort_idx")) {
      sqlite.exec("CREATE INDEX work_plans_sort_idx ON work_plans(sort_order)");
    }
  })();
  console.log("已加回 work_plans.sort_order（中性值 0）与 work_plans_sort_idx，可回滚旧二进制。");
}
sqlite.close();
