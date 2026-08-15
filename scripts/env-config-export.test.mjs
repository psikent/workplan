import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CustomFieldService } from "../apps/server/src/modules/custom-fields.ts";
import { OwnerAccountService } from "../apps/server/src/modules/owner-accounts.ts";
import { SpreadsheetTransferService } from "../apps/server/src/modules/spreadsheet-transfer.ts";
import { WorkPlanService } from "../apps/server/src/modules/work-plans.ts";
import { openDatabase } from "../apps/server/src/db/index.ts";
import { parseEnvConfigPackage } from "../packages/contracts/src/index.ts";
import { computeEnvConfigPackage } from "./env-config-export.ts";

test("computes an Environment Configuration Package from a development database", (context) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workplan-env-config-export-"));
  const databasePath = path.join(tempDir, "workplan.db");
  context.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const database = openDatabase(databasePath);
  try {
    const customFields = new CustomFieldService(database);
    const ownerAccounts = new OwnerAccountService(database);
    const workPlans = new WorkPlanService(database, customFields, ownerAccounts);
    const spreadsheetTransfer = new SpreadsheetTransferService(database, customFields, workPlans);

    for (const mapping of ownerAccounts.list()) ownerAccounts.delete(mapping.ownerName);
    customFields.create({
      key: "ticket_ref",
      label: "票号",
      description: "关联实现票",
      type: "short_text",
      required: false,
      defaultValue: null,
      options: [],
    });
    ownerAccounts.create({ ownerName: "测试负责人", account: "owner@example.com" });
    spreadsheetTransfer.createTemplate({
      name: "种子导出",
      sheetName: "工作计划",
      columns: [
        { source: "title", header: "工作内容" },
        { source: "custom:ticket_ref", header: "票号" },
      ],
    });
  } finally {
    database.sqlite.close();
  }

  const pkg = parseEnvConfigPackage(computeEnvConfigPackage(databasePath));
  assert.equal(pkg.schemaVersion, 2);
  assert.match(pkg.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(pkg.customFields, [
    {
      key: "ticket_ref",
      label: "票号",
      description: "关联实现票",
      type: "short_text",
      required: false,
      defaultValue: null,
      options: [],
      sortOrder: 0,
    },
  ]);
  assert.deepEqual(pkg.ownerAccountMappings, [
    { ownerName: "测试负责人", account: "owner@example.com" },
  ]);
  assert.deepEqual(pkg.exportTemplates, [
    {
      name: "种子导出",
      sheetName: "工作计划",
      columns: [
        { source: "title", header: "工作内容" },
        { source: "custom:ticket_ref", header: "票号" },
      ],
    },
  ]);
});
