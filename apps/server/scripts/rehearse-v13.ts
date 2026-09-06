// 票据 17 迁移演练脚本（一次性，演练真实库副本）：v12 → v13 升级 + 结构/数据/完整性核验。
import { openDatabase } from "../src/db/index.js";
import { TransferService } from "../src/modules/transfer.js";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("用法：tsx scripts/rehearse-v13.ts <数据库路径>");
  process.exit(1);
}

const bundle = openDatabase(dbPath);
const sqlite = bundle.sqlite;
const columns = sqlite.prepare("PRAGMA table_info(work_plans)").all().map((c) => c.name);
const indexes = sqlite.prepare("PRAGMA index_list(work_plans)").all().map((i) => i.name);
console.log("version:", sqlite.prepare("SELECT MAX(version) AS v FROM schema_migrations").get());
console.log("columns:", columns.join(","));
console.log("has sort_order column:", columns.includes("sort_order"));
console.log("indexes:", indexes.join(","));
console.log("has work_plans_sort_idx:", indexes.includes("work_plans_sort_idx"));
console.log("work_plans:", sqlite.prepare("SELECT COUNT(*) AS c FROM work_plans").get().c);
console.log("custom_field_values:", sqlite.prepare("SELECT COUNT(*) AS c FROM custom_field_values").get().c);
console.log("monthly_goals:", sqlite.prepare("SELECT COUNT(*) AS c FROM monthly_goals").get().c);
console.log("fk violations (work_plans):", JSON.stringify(sqlite.pragma("foreign_key_check(work_plans)")));
console.log("integrity:", JSON.stringify(sqlite.prepare("PRAGMA integrity_check").get()));

// 查询引擎冒烟：统一引擎在重建后的表上完整执行（筛选 + 排序 + 总数）。
import { CustomFieldService } from "../src/modules/custom-fields.js";
import { OwnerAccountService } from "../src/modules/owner-accounts.js";
import { MonthlyGoalService } from "../src/modules/monthly-goals.js";
import { WorkPlanQueryEngine } from "../src/modules/work-plan-query.js";

const customFields = new CustomFieldService(bundle);
const ownerAccounts = new OwnerAccountService(bundle);
const monthlyGoals = new MonthlyGoalService(bundle);
const engine = new WorkPlanQueryEngine(bundle, customFields, ownerAccounts, monthlyGoals);
const result = engine.query({ filters: [], range: {}, sort: [], limit: 10 });
console.log("query total:", result.total, "items:", result.items.length);
const sorted = engine.query({ filters: [], range: {}, sort: [{ field: "title", direction: "asc" }], limit: 10 });
console.log("sorted query total:", sorted.total);

// 备份冒烟：新导出为 v5 且 work_plans 行不含 sort_order。
const transfer = new TransferService(bundle);
const payload = transfer.export();
console.log("export schemaVersion:", payload.schemaVersion);
console.log("export work_plans rows:", payload.data.work_plans.length);
console.log("export rows carry sort_order:", payload.data.work_plans.some((row) => Object.hasOwn(row, "sort_order")));
const validation = transfer.validate(payload);
console.log("roundtrip validate:", JSON.stringify(validation));

bundle.sqlite.close();
