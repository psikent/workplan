import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../apps/server/src/config.js";
import { openDatabase } from "../apps/server/src/db/index.js";
import { CustomFieldService } from "../apps/server/src/modules/custom-fields.js";
import { EnvConfigService } from "../apps/server/src/modules/env-config.js";
import { OwnerAccountService } from "../apps/server/src/modules/owner-accounts.js";
import { SpreadsheetTransferService } from "../apps/server/src/modules/spreadsheet-transfer.js";
import { WorkPlanService } from "../apps/server/src/modules/work-plans.js";

export function computeEnvConfigPackage(databasePath: string) {
  const database = openDatabase(databasePath);
  try {
    const customFields = new CustomFieldService(database);
    const ownerAccounts = new OwnerAccountService(database);
    const workPlans = new WorkPlanService(database, customFields, ownerAccounts);
    const spreadsheetTransfer = new SpreadsheetTransferService(database, customFields, workPlans);
    const envConfig = new EnvConfigService(database, customFields, ownerAccounts, spreadsheetTransfer);
    return envConfig.exportPackage();
  } finally {
    database.sqlite.close();
  }
}

export function writeEnvConfigSeed(
  seedPath: string,
  pkg: ReturnType<typeof computeEnvConfigPackage>,
): void {
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  fs.writeFileSync(seedPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

export function exportEnvConfigSeed(): string {
  const config = loadConfig();
  const seedPath = path.join(config.dataDir, "env-config.seed.json");
  writeEnvConfigSeed(seedPath, computeEnvConfigPackage(config.databasePath));
  return seedPath;
}

function main(): void {
  const seedPath = exportEnvConfigSeed();
  console.log(`环境配置种子已导出：${seedPath}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
