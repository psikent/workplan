import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import type { FastifyInstance, InjectOptions } from "fastify";
import { buildApp } from "../src/app.js";
import type { AppConfig } from "../src/config.js";
import { recomputeWorkPlanSortKeys } from "../src/db/sort-keys.js";
import type { WorkPlanQueryResponse } from "../src/modules/work-plan-query.js";

type TestContext = Awaited<ReturnType<typeof createContext>>;
const contexts: TestContext[] = [];

async function createContext(config: Partial<AppConfig> = {}) {
  const built = await buildApp({
    config: {
      databasePath: ":memory:",
      dataDir: "/tmp/workplan-export-tests",
      appSecret: "test-secret-with-at-least-thirty-two-characters",
      appBaseUrl: "http://localhost:3000",
      isProduction: false,
      ...config,
    },
    startScheduler: false,
  });
  const setup = await built.app.inject({
    method: "POST",
    url: "/api/v1/setup",
    payload: { token: built.services.auth.setupToken, username: "admin", password: "very-secure-test-password" },
  });
  expect(setup.statusCode).toBe(200);
  const cookieHeader = setup.headers["set-cookie"];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(";")[0]!;
  const csrfToken = setup.json<{ csrfToken: string }>().csrfToken;
  const context = {
    ...built,
    request: (options: InjectOptions) =>
      built.app.inject({
        ...options,
        headers: {
          cookie,
          ...(options.method && !["GET", "HEAD"].includes(String(options.method)) ? { "x-csrf-token": csrfToken } : {}),
          ...options.headers,
        },
      }),
  };
  contexts.push(context);
  return context;
}

afterEach(async () => {
  vi.useRealTimers();
  while (contexts.length) await contexts.pop()!.app.close();
});

function parseXlsRows(data: Buffer): string[][] {
  const workbook = XLSX.read(data, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: null }).map((row) => row.map((value) => String(value ?? "")));
}

describe("XLS 导出复用统一查询", () => {
  it("导出行集合与键集游标分页拼接完全一致，超过 500 条仍完整", async () => {
    const context = await createContext();
    // 直批插入 550 条（超过旧 500 与分页默认值），统一重算排序键
    const insert = context.database.sqlite.prepare(
      "INSERT INTO work_plans(id, title, description, status, status_mode, priority, start_at, end_at, sort_order, version, is_exception, created_at, updated_at) VALUES (?, ?, '', 'pending', 'automatic', 'none', ?, ?, ?, 1, 0, ?, ?)",
    );
    context.database.sqlite.transaction(() => {
      for (let index = 0; index < 550; index += 1) {
        const padded = String(index).padStart(4, "0");
        insert.run(
          `00000000-0000-4000-8000-${padded.padStart(12, "0")}`,
          `批次${padded}计划`,
          `2026-05-${String((index % 28) + 1).padStart(2, "0")}T01:00:00.000Z`,
          `2026-05-${String((index % 28) + 1).padStart(2, "0")}T05:00:00.000Z`,
          index,
          "2026-04-01T00:00:00.000Z",
          "2026-04-01T00:00:00.000Z",
        );
      }
    })();
    recomputeWorkPlanSortKeys(context.database.sqlite);

    const sort = [{ field: "title", direction: "asc" as const }];
    // 导出查询不接受页面游标/offset：携带即整体 422
    const rejected = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/export.xls",
      payload: { columns: [{ source: "title", header: "工作内容" }], query: { filters: [], range: {}, sort, cursor: "bogus" } },
    });
    expect(rejected.statusCode).toBe(422);
    const exported = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/export.xls",
      payload: {
        columns: [{ source: "title", header: "工作内容" }],
        sheetName: "工作计划",
        name: "导出对账",
        query: { filters: [], range: {}, sort },
      },
    });
    if (exported.statusCode !== 200) console.log("EXPORT BODY:", exported.body.slice(0, 400));
    expect(exported.statusCode).toBe(200);
    const rows = parseXlsRows(exported.rawPayload);
    expect(rows).toHaveLength(551); // 表头 + 550 行
    expect(rows[0]).toEqual(["工作内容"]);

    // 键集游标分页（limit 200）拼接 == 导出行顺序
    const walked: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const payload: Record<string, unknown> = { filters: [], range: {}, sort, limit: 200 };
      if (cursor) payload.cursor = cursor;
      const response = await context.request({ method: "POST", url: "/api/v1/work-plans/query", payload });
      const body = response.json<WorkPlanQueryResponse>();
      walked.push(...body.items.map((item) => item.title));
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    expect(walked).toHaveLength(550);
    expect(rows.slice(1).map((row) => row[0])).toEqual(walked);
  });

  it("导出按已应用排序（含自定义字段自然序）与缺失值置后", async () => {
    const context = await createContext();
    await context.request({
      method: "POST",
      url: "/api/v1/custom-fields",
      payload: { key: "label", label: "标签", description: "", type: "short_text", required: false, defaultValue: null, options: [] },
    });
    const create = async (title: string, label?: string) => {
      const response = await context.request({
        method: "POST",
        url: "/api/v1/work-plans",
        payload: { title, description: "", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z", customFields: label === undefined ? {} : { label } },
      });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string }>();
    };
    await create("计划甲", "任务2");
    await create("计划乙", "任务10");
    await create("计划丙", "任务1");
    await create("计划丁");

    const exported = await context.request({
      method: "POST",
      url: "/api/v1/work-plans/export.xls",
      payload: {
        columns: [{ source: "title", header: "工作内容" }],
        query: { filters: [], range: {}, sort: [{ field: "custom.label", direction: "asc" }] },
      },
    });
    expect(exported.statusCode).toBe(200);
    const titles = parseXlsRows(exported.rawPayload).slice(1).map((row) => row[0]);
    // 自然序：任务1 < 任务2 < 任务10，缺失值置后
    expect(titles).toEqual(["计划丙", "计划甲", "计划乙", "计划丁"]);
  });
});
