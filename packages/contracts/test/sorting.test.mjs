import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compareNaturalSortKeys,
  compareNaturalText,
  compareWorkPlansBySchedule,
  formatWorkPlanSortParam,
  naturalSortKey,
  normalizeTextForSort,
  parseWorkPlanSortParam,
  workPlanQueryRequestSchema,
  workPlanQueryResponseSchema,
  workPlanQueryErrorCodes,
  workPlanSortItemsSchema,
} from "../src/index.ts";

// 独立参考比较器：分段语义比较（不经排序键），用于与排序键实现交叉验证。
const controlChars = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;

function referenceNormalize(input) {
  return input.normalize("NFKC").toUpperCase().replace(controlChars, "");
}

function referenceTokenize(normalized) {
  const runs = [];
  let current = "";
  let currentIsDigit = null;
  for (const character of normalized) {
    const isDigit = character >= "0" && character <= "9";
    if (currentIsDigit === null || isDigit === currentIsDigit) {
      current += character;
    } else {
      runs.push({ isDigit: currentIsDigit, text: current });
      current = character;
    }
    currentIsDigit = isDigit;
  }
  if (current !== "") runs.push({ isDigit: currentIsDigit, text: current });
  return runs;
}

function compareCodePoints(a, b) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < a.length && rightIndex < b.length) {
    const leftPoint = a.codePointAt(leftIndex);
    const rightPoint = b.codePointAt(rightIndex);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  if (leftIndex < a.length) return 1;
  if (rightIndex < b.length) return -1;
  return 0;
}

function compareNumberValues(a, b) {
  const strippedA = a.replace(/^0+/, "") || "0";
  const strippedB = b.replace(/^0+/, "") || "0";
  if (strippedA.length !== strippedB.length) return strippedA.length - strippedB.length;
  return compareCodePoints(strippedA, strippedB);
}

function referenceCompareText(leftInput, rightInput) {
  const left = referenceTokenize(referenceNormalize(leftInput));
  const right = referenceTokenize(referenceNormalize(rightInput));
  const depth = Math.min(left.length, right.length);
  for (let index = 0; index < depth; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a.isDigit !== b.isDigit) return a.isDigit ? -1 : 1;
    if (a.isDigit) {
      const byValue = compareNumberValues(a.text, b.text);
      if (byValue !== 0) return byValue;
    } else {
      const byText = compareCodePoints(a.text, b.text);
      if (byText !== 0) return byText;
    }
  }
  return left.length - right.length;
}

describe("工作计划排序契约", () => {
  it("结构层面接受任意字段；白名单与重复由服务端引擎校验（稳定错误码）", () => {
    assert.equal(workPlanSortItemsSchema.safeParse([{ field: "title", direction: "asc" }]).success, true);
    assert.equal(workPlanSortItemsSchema.safeParse([{ field: "bogus", direction: "asc" }]).success, true);
    const five = ["title", "status", "startAt", "endAt", "duration"].map((field) => ({ field, direction: "asc" }));
    assert.equal(workPlanSortItemsSchema.safeParse(five).success, true);
    assert.equal(workPlanSortItemsSchema.safeParse([...five, { field: "createdAt", direction: "asc" }]).success, false);
    assert.equal(
      workPlanSortItemsSchema.safeParse([
        { field: "title", direction: "asc" },
        { field: "title", direction: "desc" },
      ]).success,
      true,
    );
  });

  it("查询请求契约提供默认值且不含 offset", () => {
    const parsed = workPlanQueryRequestSchema.parse({});
    assert.deepEqual(parsed.sort, []);
    assert.deepEqual(parsed.filters, []);
    assert.deepEqual(parsed.range, {});
    assert.equal(parsed.limit, 100);
    assert.equal("offset" in parsed, false);
    assert.equal("cursor" in parsed, false);
    const withCursor = workPlanQueryRequestSchema.parse({ cursor: "abc", limit: 50 });
    assert.equal(withCursor.cursor, "abc");
    // 契约不含 offset 字段；未知键被剥离，游标与 offset 的互斥由“不存在 offset 参数”保证
    // 字段白名单不在 zod 层：引擎校验产生 SORT_FIELD_INVALID 稳定错误码
    assert.equal(workPlanQueryRequestSchema.safeParse({ sort: [{ field: "bogus", direction: "asc" }] }).success, true);
  });

  it("查询响应契约固定为 items/total/evaluatedAt/nextCursor", () => {
    const base = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "示例",
      description: "",
      status: "pending",
      statusMode: "automatic",
      startAt: "2026-01-01T00:00:00.000Z",
      endAt: "2026-01-02T00:00:00.000Z",
      version: 1,
      seriesId: null,
      occurrenceKey: null,
      isException: false,
      customFields: {},
      monthlyGoalIds: [],
      ownerAccount: null,
      ownerConflict: null,
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    };
    const parsed = workPlanQueryResponseSchema.safeParse({
      items: [base],
      total: 1,
      evaluatedAt: "2026-09-03T00:00:00.000Z",
      nextCursor: null,
    });
    assert.equal(parsed.success, true);
    const missingTotal = workPlanQueryResponseSchema.safeParse({ items: [], evaluatedAt: "2026-09-03T00:00:00.000Z", nextCursor: null });
    assert.equal(missingTotal.success, false);
  });

  it("暴露稳定错误类别", () => {
    assert.deepEqual(workPlanQueryErrorCodes, [
      "SORT_FIELD_INVALID",
      "SORT_FIELD_DUPLICATED",
      "SORT_FIELD_UNSUPPORTED",
      "CURSOR_INVALID",
      "CURSOR_MISMATCH",
      "WORK_PLAN_REORDER_RETIRED",
    ]);
  });

  it("URL 排序参数格式化与解析互逆，非法输入整体拒绝", () => {
    const items = [
      { field: "title", direction: "asc" },
      { field: "custom.risk", direction: "desc" },
    ];
    assert.equal(formatWorkPlanSortParam(items), "title:asc,custom.risk:desc");
    assert.deepEqual(parseWorkPlanSortParam("title:asc,custom.risk:desc"), items);
    assert.equal(parseWorkPlanSortParam(null), null);
    assert.equal(parseWorkPlanSortParam(""), null);
    assert.equal(parseWorkPlanSortParam("title"), null);
    assert.equal(parseWorkPlanSortParam("title:up"), null);
    assert.equal(parseWorkPlanSortParam("ownerAccount:asc"), null);
    assert.equal(parseWorkPlanSortParam("title:asc,title:desc"), null);
    assert.equal(parseWorkPlanSortParam("a:asc,b:asc,c:asc,d:asc,e:asc,f:asc"), null);
  });
});

describe("排期顺序比较器", () => {
  const plan = (overrides) => ({
    id: "00000000-0000-4000-8000-000000000000",
    startAt: "2026-01-01T00:00:00.000Z",
    endAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2025-12-01T00:00:00.000Z",
    ...overrides,
  });

  it("开始时间升序", () => {
    assert.equal(compareWorkPlansBySchedule(plan({ startAt: "2026-01-01T00:00:00.000Z" }), plan({ startAt: "2026-01-02T00:00:00.000Z" }), ), -1);
    assert.equal(compareWorkPlansBySchedule(plan({ startAt: "2026-01-02T00:00:00.000Z" }), plan({ startAt: "2026-01-01T00:00:00.000Z" }), ), 1);
  });

  it("开始相同则结束时间降序", () => {
    const early = plan({ endAt: "2026-01-05T00:00:00.000Z" });
    const late = plan({ endAt: "2026-01-09T00:00:00.000Z" });
    assert.equal(compareWorkPlansBySchedule(early, late), 1);
    assert.equal(compareWorkPlansBySchedule(late, early), -1);
  });

  it("开始与结束相同则创建时间升序", () => {
    const older = plan({ createdAt: "2025-01-01T00:00:00.000Z" });
    const newer = plan({ createdAt: "2025-06-01T00:00:00.000Z" });
    assert.equal(compareWorkPlansBySchedule(older, newer), -1);
    assert.equal(compareWorkPlansBySchedule(newer, older), 1);
  });

  it("完全相等时按 ID 码点序，不再读取重复来源或人工序号", () => {
    const left = plan({ id: "00000000-0000-4000-8000-00000000000a" });
    const right = plan({ id: "00000000-0000-4000-8000-00000000000b" });
    assert.equal(compareWorkPlansBySchedule(left, right), -1);
    assert.equal(compareWorkPlansBySchedule(right, left), 1);
    assert.equal(compareWorkPlansBySchedule(left, plan({ id: left.id })), 0);
  });
});

describe("中文自然文本排序", () => {
  const goldenSets = [
    { label: "数字片段按数值", items: ["第2期检修", "第10期检修", "第1期检修", "第100期检修", "第99期检修"] },
    { label: "版本号式数字段", items: ["v1.9.0", "v1.10.0", "v1.2.30", "v1.2.4"] },
    { label: "忽略大小写", items: ["ABC 项目", "abc 项目"] },
    { label: "全角半角等价", items: ["ａｂｃ１号", "abc1号", "ＡＢＣ１号"] },
    { label: "组合字符规范化", items: ["cafe\u0301 平台", "Cafe 平台", "café 平台"] },
    { label: "中文与 ASCII 混排", items: ["作业计划 9 号机", "作业计划 10 号机", "Plan 2 审查", "Plan 10 审查", "专项 3 复核"] },
    { label: "前导零等值", items: ["批次007", "批次7", "批次08", "批次8"] },
    { label: "空白差异保留", items: ["a b", "a  b", "a\tb", " a"] },
    {
      label: "超长数字按数值",
      items: [
        "编号12345678901234567890123456789012345678901234567890",
        "编号12345678901234567890123456789012345678901234567891",
        "编号99999999999999999999999999999999999999999999999999",
        "编号100000000000000000000000000000000000000000000000000",
      ],
    },
    { label: "中文码点序", items: ["苹果", "香蕉", "白菜", "豆角"] },
    { label: "数字先于文本段", items: ["a1", "ab", "a2b"] },
    { label: "空串与控制字符剔除", items: ["\u0001杂\u0002项", "杂项", ""] },
  ];

  it("排序键与独立参考比较器在金样上产生一致全序", () => {
    for (const set of goldenSets) {
      const byReference = [...set.items].sort(referenceCompareText);
      const byKey = [...set.items].sort((a, b) => compareNaturalSortKeys(naturalSortKey(a), naturalSortKey(b)));
      const byComparator = [...set.items].sort(compareNaturalText);
      assert.deepEqual(byKey, byReference, `金样失败：${set.label}`);
      assert.deepEqual(byComparator, byReference, `比较器失败：${set.label}`);
    }
  });

  it("规范化与键编码具备既定性质", () => {
    assert.equal(normalizeTextForSort("ａｂｃ"), "ABC");
    assert.equal(normalizeTextForSort("cafe\u0301"), "CAFÉ");
    assert.equal(naturalSortKey("批次007"), naturalSortKey("批次7"));
    assert.notEqual(naturalSortKey("第9期"), naturalSortKey("第10期"));
    // 键自身即字节序全序：等值并列时比较器返回 0
    assert.equal(compareNaturalText("批次007", "批次7"), 0);
    assert.equal(compareNaturalText("第9期", "第10期"), -1);
    assert.equal(compareNaturalText("", ""), 0);
  });
});
