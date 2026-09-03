// 票据 08 原型：确定性生成规格《性能与验收预算》定义的标准数据集。
// 100,000 条工作计划 + 50 个启用自定义字段，覆盖：归档字段、重复实例、四种状态、
// 高缺失率、中文数字混合文本、失效单选值和边界时间。

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick(items) {
      return items[Math.floor(next() * items.length)];
    },
    chance(p) {
      return next() < p;
    },
  };
}

const STATUSES = [
  ["pending", 0.4],
  ["in_progress", 0.25],
  ["completed", 0.2],
  ["cancelled", 0.15],
];

function pickStatus(rng) {
  const r = rng.next();
  let acc = 0;
  for (const [status, weight] of STATUSES) {
    acc += weight;
    if (r < acc) return status;
  }
  return "pending";
}

export function buildCustomFields() {
  const fields = [];
  const add = (index, type, extra = {}) => {
    fields.push({
      id: `cf-${String(index + 1).padStart(3, "0")}`,
      key: `field_${String(index + 1).padStart(3, "0")}`,
      label: `字段 ${index + 1}`,
      type,
      ...extra,
    });
  };
  let i = 0;
  for (let n = 0; n < 12; n += 1) add(i++, "short_text");
  for (let n = 0; n < 6; n += 1) add(i++, "url");
  for (let n = 0; n < 8; n += 1) add(i++, "number");
  for (let n = 0; n < 5; n += 1) add(i++, "boolean");
  for (let n = 0; n < 5; n += 1) add(i++, "date");
  for (let n = 0; n < 5; n += 1) add(i++, "datetime");
  for (let n = 0; n < 6; n += 1) {
    add(i++, "single_select", {
      options: [
        { value: "低", label: "低", sortOrder: 0 },
        { value: "中", label: "中", sortOrder: 1 },
        { value: "高", label: "高", sortOrder: 2 },
        { value: "紧急", label: "紧急", sortOrder: 3 },
      ],
    });
  }
  for (let n = 0; n < 3; n += 1) {
    add(i++, "multi_select", {
      options: [
        { value: "甲", label: "甲", sortOrder: 0 },
        { value: "乙", label: "乙", sortOrder: 1 },
        { value: "丙", label: "丙", sortOrder: 2 },
      ],
    });
  }
  // 归档字段：定义仍有值存在，但排序请求必须报参数错误
  fields[2].archivedAt = "2026-08-01T00:00:00.000Z";
  fields[19].archivedAt = "2026-08-01T00:00:00.000Z";
  fields[42].archivedAt = "2026-08-01T00:00:00.000Z";
  return fields;
}

const ZONES = ["华东", "华南", "华北", "西部", "海外"];

function makeTitle(rng, index) {
  if (index % 50 === 0) return "例行巡检"; // 高频并列标题，制造同键并列
  const n = rng.int(1, 20000);
  switch (index % 10) {
    case 0:
      return `检修计划-${rng.pick(ZONES)}${n}号机组`;
    case 1:
      return `作业计划 ${n} 号线路巡检`;
    case 2:
      return `Phase ${n} rollout`;
    case 3:
      return `项目-${n}：${rng.pick(ZONES)}站点改造`;
    case 4:
      return `批次${String(n).padStart(6, "0")}验证`;
    case 5:
      return `升级v2.${n % 20}.${n % 7}计划`;
    case 6:
      return `  前导空格 ${n}`;
    case 7:
      return `编号${n}${rng.int(1, 9)}12345678901234567890 超长数字`;
    case 8:
      return `ＡＢＣ-${n} 全角混合`;
    default:
      return `专项${n}：${rng.pick(ZONES)}月度检查`;
  }
}

function isoAt(rng, baseDays) {
  const ms = Date.UTC(2026, 0, 1) + baseDays * 86400000 + rng.int(0, 863999000);
  return new Date(ms).toISOString();
}

export function buildDataset({ planCount = 100_000, seed = 20260903 } = {}) {
  const rng = createRng(seed);
  const fields = buildCustomFields();
  const plans = [];
  for (let index = 0; index < planCount; index += 1) {
    const startAt = isoAt(rng, rng.int(-540, 540));
    const durationDays = rng.chance(0.05) ? 0 : rng.int(0, 90);
    const durationMs = durationDays * 86400000 + rng.int(0, 86399900);
    const createdAt = new Date(Date.parse(startAt) - rng.int(1, 30) * 86400000).toISOString();
    plans.push({
      id: `${String(index + 1).padStart(8, "0")}-${(index * 7919).toString(16).padStart(8, "0")}-4f2a-${(index * 104729 % 0xffff).toString(16).padStart(4, "0")}-c${String(index % 10)}`,
      title: makeTitle(rng, index),
      description: rng.chance(0.2) ? `说明-重点审查${index}` : `普通说明-${index}`,
      status: pickStatus(rng),
      statusMode: rng.chance(0.1) ? "manual" : "automatic",
      startAt,
      endAt: new Date(Date.parse(startAt) + durationMs).toISOString(),
      createdAt,
      updatedAt: new Date(Date.parse(createdAt) + rng.int(0, 10) * 86400000).toISOString(),
      seriesId: rng.chance(0.08) ? `series-${index % 500}` : null,
      occurrenceKey: null,
      isException: rng.chance(0.02),
      sortOrder: index + 1, // 遗留列写入中性值
      version: 1,
    });
  }

  // 自定义字段值：高缺失率（约 60-85% 为空），单选含失效值
  const valueRows = [];
  const multiRows = [];
  for (const plan of plans) {
    for (const field of fields) {
      const missingRate = field.type === "short_text" ? 0.6 : 0.75;
      if (rng.chance(missingRate)) continue;
      switch (field.type) {
        case "short_text":
          valueRows.push({ planId: plan.id, fieldId: field.id, type: field.type, value: `值-${plan.id.slice(0, 6)}-${rng.int(1, 500)}` });
          break;
        case "url":
          valueRows.push({ planId: plan.id, fieldId: field.id, type: field.type, value: `https://example.com/plans/${plan.id.slice(0, 8)}` });
          break;
        case "number":
          valueRows.push({ planId: plan.id, fieldId: field.id, type: field.type, value: rng.chance(0.1) ? -rng.int(1, 5000) : rng.int(0, 10000) });
          break;
        case "boolean":
          valueRows.push({ planId: plan.id, fieldId: field.id, type: field.type, value: rng.chance(0.5) });
          break;
        case "date":
          valueRows.push({ planId: plan.id, fieldId: field.id, type: field.type, value: new Date(Date.UTC(2026, rng.int(0, 11), rng.int(1, 28))).toISOString().slice(0, 10) });
          break;
        case "datetime": {
          // 混合时区偏移格式，证明 datetime 排序键必须归一化
          const ms = Date.UTC(2026, rng.int(0, 11), rng.int(1, 28), rng.int(0, 23), rng.int(0, 59));
          const withOffset = rng.chance(0.5);
          const value = withOffset
            ? new Date(ms + 8 * 3600000).toISOString().replace("Z", "+08:00")
            : new Date(ms).toISOString();
          valueRows.push({ planId: plan.id, fieldId: field.id, type: field.type, value, instant: ms });
          break;
        }
        case "single_select": {
          // 8% 写入已不在选项里的失效值（模拟选项被删除后的遗留）
          const invalid = rng.chance(0.08);
          valueRows.push({
            planId: plan.id,
            fieldId: field.id,
            type: field.type,
            value: invalid ? "已废弃值" : rng.pick(field.options).value,
          });
          break;
        }
        case "multi_select":
          for (const option of field.options) {
            if (rng.chance(0.3)) multiRows.push({ planId: plan.id, fieldId: field.id, optionId: `${field.id}-opt-${option.value}` });
          }
          break;
      }
    }
  }
  return { fields, plans, valueRows, multiRows };
}
