// 票据 08 原型：中文自然文本排序键与独立参考比较器。
// 两种实现必须对同一输入产生完全一致的全序（金样 + 数据集交叉验证）：
//  1) compareNaturalTextRef —— 独立参考比较器（分段语义比较，不经排序键）。
//  2) naturalSortKey —— 规范化排序键，数据库以 BINARY（UTF-8 字节序）比较。

const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\uFEFF]/g;
const DIGIT_RE = /[0-9]/;
const NUMBER_TAG = "\u0001"; // 数字段标记（payload 中不可能出现：控制字符已剔除、多字节 UTF-8 ≥ 0x80）
const TEXT_TAG = "\u0002"; // 文本段标记
const LENGTH_WIDTH = 6; // 数字段十进制长度的固定位宽，支持最长 999999 位数字串

// 规范化：NFKC（全角→半角、组合字符合成、兼容字符折叠）→ 大写折叠 → 剔除控制字符。
export function normalizeForSort(input) {
  return input.normalize("NFKC").toUpperCase().replace(CONTROL_RE, "");
}

function tokenize(normalized) {
  const runs = [];
  let current = "";
  let currentIsDigit = null;
  for (const ch of normalized) {
    const isDigit = DIGIT_RE.test(ch);
    if (currentIsDigit === null || isDigit === currentIsDigit) {
      current += ch;
    } else {
      runs.push({ isDigit: currentIsDigit, text: current });
      current = ch;
    }
    currentIsDigit = isDigit;
  }
  if (current !== "") runs.push({ isDigit: currentIsDigit, text: current });
  return runs;
}

// 数字段 → \u0001 + 定长十进制位数（去前导零）+ 去前导零后的数字串。
// 前导零只在“位数”里留痕，同值数字段键相同（如 007 与 7），并列由排期兜底决定。
function encodeDigitRun(run) {
  const stripped = run.text.replace(/^0+/, "") || "0";
  const length = String(stripped.length).padStart(LENGTH_WIDTH, "0");
  return NUMBER_TAG + length + stripped;
}

function encodeTextRun(run) {
  return TEXT_TAG + run.text;
}

export function naturalSortKey(input) {
  const normalized = normalizeForSort(String(input));
  if (normalized === "") return "";
  let key = "";
  for (const run of tokenize(normalized)) {
    key += run.isDigit ? encodeDigitRun(run) : encodeTextRun(run);
  }
  return key;
}

// 独立参考比较器：不做键编码，直接按段语义比较（分段、数字段按数值、数字段先于文本段）。
function compareDigitValues(a, b) {
  const sa = a.replace(/^0+/, "") || "0";
  const sb = b.replace(/^0+/, "") || "0";
  if (sa.length !== sb.length) return sa.length - sb.length;
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// 文本段按 Unicode 码点比较（等价于 UTF-8 字节序 / SQLite BINARY）。
// 不能用 JS 字符串 `<`：那是 UTF-16 码元序，对增补平面字符与部分 BMP 字符会与码点序不一致。
function compareTextRunValue(a, b) {
  let ia = 0;
  let ib = 0;
  while (ia < a.length && ib < b.length) {
    const pa = a.codePointAt(ia);
    const pb = b.codePointAt(ib);
    if (pa !== pb) return pa < pb ? -1 : 1;
    ia += pa > 0xffff ? 2 : 1;
    ib += pb > 0xffff ? 2 : 1;
  }
  if (ia < a.length) return 1;
  if (ib < b.length) return -1;
  return 0;
}

export function compareNaturalTextRef(leftInput, rightInput) {
  const left = tokenize(normalizeForSort(String(leftInput)));
  const right = tokenize(normalizeForSort(String(rightInput)));
  const depth = Math.min(left.length, right.length);
  for (let i = 0; i < depth; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a.isDigit !== b.isDigit) return a.isDigit ? -1 : 1; // 数字段先于文本段
    if (a.isDigit) {
      const byValue = compareDigitValues(a.text, b.text);
      if (byValue !== 0) return byValue;
    } else {
      const byText = compareTextRunValue(a.text, b.text);
      if (byText !== 0) return byText;
    }
  }
  return left.length - right.length;
}

// 键比较（应与参考比较器等价）：UTF-8 字节序比较，即 SQLite TEXT BINARY 的语义。
export function compareSortKeys(a, b) {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return Buffer.compare(ba, bb);
}

export function goldenSampleSets() {
  return [
    {
      label: "数字片段按数值",
      items: ["第2期检修", "第10期检修", "第1期检修", "第100期检修", "第99期检修"],
    },
    {
      label: "版本号式数字段",
      items: ["v1.9.0", "v1.10.0", "v1.2.30", "v1.2.4"],
    },
    {
      label: "忽略大小写（并列由兜底决定）",
      items: ["ABC 项目", "abc 项目"],
      expectTies: true,
    },
    {
      label: "全角半角等价",
      items: ["ａｂｃ１号", "abc1号", "ＡＢＣ１号"],
      expectTies: true,
    },
    {
      label: "组合字符规范化",
      items: ["café \u0065\u0301", "cafe\u0301 平台", "Cafe 平台"],
      expectTies: true,
    },
    {
      label: "中文与 ASCII 混排",
      items: ["作业计划 9 号机", "作业计划 10 号机", "Plan 2 审查", "Plan 10 审查", "专项 3 复核"],
    },
    {
      label: "前导零等值",
      items: ["批次007", "批次7", "批次08", "批次8"],
      expectTies: true,
    },
    {
      label: "空白差异保留",
      items: ["a b", "a  b", "a\tb", " a"],
    },
    {
      label: "超长数字按数值",
      items: [
        "编号12345678901234567890123456789012345678901234567890",
        "编号12345678901234567890123456789012345678901234567891",
        "编号99999999999999999999999999999999999999999999999999",
        "编号100000000000000000000000000000000000000000000000000",
      ],
    },
    {
      label: "中文码点序（无拼音要求）",
      items: ["苹果", "香蕉", "白菜", "豆角"],
    },
    {
      label: "数字先于文本段",
      items: ["a1", "ab", "a2b"],
    },
    {
      label: "空串与控制字符剔除",
      items: ["\u0001杂\u0002项", "杂项", ""],
    },
  ];
}

export function runGoldenChecks() {
  const results = [];
  for (const set of goldenSampleSets()) {
    const refOrder = [...set.items].sort(compareNaturalTextRef);
    const keyOrder = [...set.items].sort((a, b) => compareSortKeys(naturalSortKey(a), naturalSortKey(b)));
    const same = JSON.stringify(refOrder) === JSON.stringify(keyOrder);
    results.push({
      label: set.label,
      pass: same,
      refOrder,
      keyOrder,
    });
  }
  return results;
}
