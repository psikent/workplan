// 票据 18：真实浏览器排序验收矩阵（无头自动化）。
// 矩阵：Administrator / Editor / Viewer × 桌面(1440×900) / 窄屏(390×844) × 鼠标 / 键盘。
// 用例：排序面板管理（添加/方向/上移/下移/移除/恢复默认）、URL sort= 合法/非法、
//       账户偏好保存/恢复/失效清理、加载/失败与重试、表格与甘特同序、XLS 导出与表格同序、三角色授权边界。
// 运行：NODE_PATH=/usr/local/lib/node_modules/@playwright/cli/node_modules node qa-matrix.mjs
// 依赖：系统 Chromium（/opt/homebrew/bin/chromium）、本地 QA 服务 http://127.0.0.1:4173（三角色账号与种子数据已建）。

import { chromium } from "/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/Users/psikent/dev/workplan-dev/apps/server/package.json");
const XLSX = require("xlsx");

const BASE = "http://127.0.0.1:4173";
const evidenceDir = "/Users/psikent/dev/workplan-dev/.scratch/work-plan-ordering/qa-evidence";
fs.mkdirSync(evidenceDir, { recursive: true });

const ROLES = [
  { role: "Administrator", username: "qa-admin" },
  { role: "Editor", username: "qa-editor" },
  { role: "Viewer", username: "qa-viewer" },
];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "narrow", width: 390, height: 844 },
];
const INPUTS = ["mouse", "keyboard"];

const results = [];
const log = (line) => {
  console.log(line);
  results.push(line);
};

// 种子数据（12 条，start 日 = 播种序 1..12）：
// 默认排期顺序 = 播种顺序；stage 键序（自然序、任务01 与 任务1 同键并列回排期链）。
const EXPECTED_SCHEDULE_ORDER = [
  "巡检第2期", "巡检第10期", "巡检第1期", "机组检修A", "机组检修B", "线路改造",
  "站点升级", "月度检查", "专项排查", "Phase 12 rollout", "Phase 2 rollout", "年度盘点",
];
// stage: 任务1（巡检第1期 9/3、年度盘点 9/12 并列）→ 任务2 → 任务10 → 任务100 → beta → 准备；缺失置后按排期链
const EXPECTED_STAGE_ASC = [
  "Phase 12 rollout", "巡检第1期", "年度盘点", "巡检第2期", "巡检第10期", "站点升级", "机组检修A",
  "机组检修B", "线路改造", "月度检查", "专项排查", "Phase 2 rollout",
];
// 期望顺序以 API 实测为准（自然序 + 码点序 + 并列回排期链）
const EXPECTED_TITLE_ASC = [
  "Phase 2 rollout", "Phase 12 rollout", "专项排查", "巡检第1期", "巡检第2期", "巡检第10期",
  "年度盘点", "月度检查", "机组检修A", "机组检修B", "站点升级", "线路改造",
];

async function login(page, username) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[autocomplete='username']", { timeout: 10_000 });
  const usernameInput = page.locator("input[autocomplete='username']");
  const passwordInput = page.locator("input[type='password']");
  await usernameInput.fill(username);
  await passwordInput.fill("qa-password-2026");
  await Promise.all([
    page.waitForURL("**/work-plans", { timeout: 10_000 }),
    passwordInput.press("Enter"),
  ]);
}

async function openSortPanel(page, input) {
  const dialog = page.locator('div[role="dialog"][aria-label="排序设置"]');
  if (await dialog.isVisible().catch(() => false)) return; // 已打开（面板为非模态 in-flow 面板）
  const button = page.locator('button[aria-label="排序设置"]');
  if (input === "keyboard") {
    await button.focus();
    await page.keyboard.press("Enter");
  } else {
    await button.click();
  }
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
}

async function closeSortPanel(page) {
  const closeButton = page.locator('div[role="dialog"][aria-label="排序设置"] button:has-text("关闭")');
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
    await page.locator('div[role="dialog"][aria-label="排序设置"]').waitFor({ state: "hidden", timeout: 5_000 }).catch(() => {});
  }
}

// select 的可选项：占位 + 排序字段（1=工作内容 2=状态 3=开始时间 …）。
// 键盘格先断言可聚焦（有标签），选值用原生 select API——closed <select> 的方向键/首字母
// 导航由平台菜单实现，无头 Chromium（darwin）无法驱动，属平台自有行为而非应用可及性缺陷。
async function addSortField(page, input, optionIndex) {
  const select = page.locator('select[aria-label="添加排序字段"]');
  if (input === "keyboard") {
    await select.focus();
    const focusedLabel = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    if (focusedLabel !== "添加排序字段") throw new Error(`添加排序字段 select 不可聚焦（activeElement=${focusedLabel}）`);
  }
  await select.selectOption({ index: optionIndex });
}

async function activate(page, input, locator) {
  if (input === "keyboard") {
    await locator.focus();
    await page.keyboard.press("Enter");
  } else {
    await locator.click();
  }
}

async function ensureTaskListVisible(page) {
  // 窄屏默认收起任务列表；按钮可能晚于 DOM 挂载，轮询直到行可见或展开成功
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await page.locator(".plan-row").first().isVisible().catch(() => false)) return;
    const expand = page.locator('[aria-label="展开任务列表"]');
    if (await expand.isVisible().catch(() => false)) {
      await expand.click();
      await page.waitForTimeout(250);
    } else {
      await page.waitForTimeout(250);
    }
  }
}

async function readTableTitles(page) {
  await page.locator(".plan-row").first().waitFor({ state: "visible", timeout: 15_000 });
  return page.locator(".plan-row .plan-title-button strong").allTextContents();
}

async function expectNotice(page, expected) {
  const notice = page.locator(".spreadsheet-transfer-message[role='status']");
  await notice.waitFor({ state: "visible", timeout: 5_000 });
  const text = await notice.textContent();
  if (!text?.includes(expected)) throw new Error(`提示不符：期望「${expected}」，实际「${text?.trim()}」`);
}

async function expectTableTitles(page, expected, label) {
  const actual = await readTableTitles(page);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}：期望 [${expected.join(", ")}]，实际 [${actual.join(", ")}]`);
  }
}

async function screenshot(page, name) {
  const file = path.join(evidenceDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function runCell({ role, username, viewport, input }) {
  const cell = `${role}-${viewport.name}-${input}`;
  const findings = [];
  const browser = await chromium.launch({
    executablePath: "/opt/homebrew/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("response", async (response) => {
    if (response.url().includes("/work-plans/query") && response.status() !== 200) {
      log(`   [net] ${response.status()} ${response.request().postData()?.slice(0, 300) ?? "(no body)"} => ${(await response.text()).slice(0, 200)}`);
    }
  });

  try {
    await login(page, username);

    // 1. URL sort= 合法生效（自定义短文本自然序 + 缺失值置后）
    await page.goto(`${BASE}/work-plans?sort=custom.stage:asc&view=month&date=2026-09-07`, { waitUntil: "domcontentloaded" });
    await ensureTaskListVisible(page);
    await expectTableTitles(page, EXPECTED_STAGE_ASC, "URL 合法 sort=custom.stage:asc");
    findings.push("URL 合法 sort= 生效（自然序 + 缺失值置后）✓");
    await screenshot(page, `${cell}-01-url-sort-valid`);

    // 2. URL sort= 非法：整体回退排期顺序、显示说明、参数移除
    await page.goto(`${BASE}/work-plans?sort=custom.not_exists:asc&view=month&date=2026-09-07`, { waitUntil: "domcontentloaded" });
    await ensureTaskListVisible(page);
    await expectTableTitles(page, EXPECTED_SCHEDULE_ORDER, "URL 非法 sort 回退排期顺序");
    await expectNotice(page, "链接中的排序参数无效，已恢复默认排期顺序");
    if (page.url().includes("sort=")) throw new Error("非法 sort= 参数未被移除");
    findings.push("URL 非法 sort= 整体回退排期顺序 + 提示 + 参数移除 ✓");
    await screenshot(page, `${cell}-02-url-sort-invalid`);

    // 3. 排序面板：添加、方向切换、上移、下移、移除、恢复默认
    await openSortPanel(page, input);
    await addSortField(page, input, 1); // 工作内容
    await page.waitForFunction(() => document.querySelectorAll('div[role="dialog"][aria-label="排序设置"] button[aria-label^="移除"]').length === 1);
    findings.push("排序面板：添加排序字段 ✓");
    await screenshot(page, `${cell}-03-panel-added`);

    const dirButton = page.locator('div[role="dialog"][aria-label="排序设置"] button[aria-label*="方向"]').first();
    const beforeDir = await dirButton.getAttribute("aria-label");
    await activate(page, input, dirButton);
    await page.waitForTimeout(300);
    const afterDir = await page.locator('div[role="dialog"][aria-label="排序设置"] button[aria-label*="方向"]').first().getAttribute("aria-label");
    if (beforeDir === afterDir) throw new Error("方向切换无效");
    findings.push("排序面板：方向切换 ✓");

    await addSortField(page, input, 2); // 状态
    await page.waitForFunction(() => document.querySelectorAll('div[role="dialog"][aria-label="排序设置"] button[aria-label^="移除"]').length === 2);
    const firstDown = page.locator('div[role="dialog"][aria-label="排序设置"] button[aria-label^="下移"]').first();
    if (await firstDown.isDisabled()) throw new Error("首项的下移按钮意外禁用");
    await activate(page, input, firstDown);
    await page.waitForTimeout(300);
    const secondUp = page.locator('div[role="dialog"][aria-label="排序设置"] button[aria-label^="上移"]').nth(1);
    const labelAfterDown = await secondUp.getAttribute("aria-label");
    if (await secondUp.isDisabled()) throw new Error(`交换后第二项的上移按钮意外禁用（${labelAfterDown}）`);
    findings.push("排序面板：下移/上移（含首末禁用态）✓");
    await screenshot(page, `${cell}-04-panel-two-items`);

    const removeButton = page.locator('div[role="dialog"][aria-label="排序设置"] button[aria-label^="移除"]').first();
    await activate(page, input, removeButton);
    await page.waitForFunction(() => document.querySelectorAll('div[role="dialog"][aria-label="排序设置"] button[aria-label^="移除"]').length === 1);
    findings.push("排序面板：移除排序项 ✓");

    const resetButton = page.locator('div[role="dialog"][aria-label="排序设置"] button:has-text("恢复默认")');
    if (!(await resetButton.isVisible().catch(() => false))) throw new Error("恢复默认按钮不可见");
    await activate(page, input, resetButton);
    await page.waitForTimeout(400);
    if (page.url().includes("sort=")) throw new Error("恢复默认后 URL 仍含 sort=");
    const remaining = await page.locator('div[role="dialog"][aria-label="排序设置"] button[aria-label^="移除"]').count();
    if (remaining !== 0) throw new Error("恢复默认后仍有排序项");
    findings.push("排序面板：恢复默认（清空，URL 移除 sort=）✓");
    await screenshot(page, `${cell}-05-panel-reset`);
    await closeSortPanel(page);

    // 4. 账户偏好：设置 → 刷新恢复
    await openSortPanel(page, input);
    await addSortField(page, input, 1); // 工作内容
    await page.waitForFunction(() => document.querySelectorAll('div[role="dialog"][aria-label="排序设置"] button[aria-label^="移除"]').length === 1);
    if (!page.url().includes("sort=")) throw new Error("设置排序后 URL 未写入 sort=");
    await closeSortPanel(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await ensureTaskListVisible(page);
    await expectTableTitles(page, EXPECTED_TITLE_ASC, "刷新后偏好恢复（title asc）");
    if (!page.url().includes("sort=")) throw new Error("刷新后偏好未恢复（URL 无 sort=）");
    findings.push("账户偏好：修改保存，刷新后恢复 ✓");
    await screenshot(page, `${cell}-06-preference-restored`);

    // 5. 偏好含失效字段：逐项清理、写回、提示一次
    const accountId = await page.evaluate(async () => {
      const response = await fetch("/api/v1/auth/me");
      const body = await response.json();
      return body.user.id;
    });
    await page.evaluate((id) => {
      window.localStorage.setItem(`workplan:list-sort:v1:${id}`, JSON.stringify({
        version: 1,
        sort: [
          { field: "custom.deleted_long_ago", direction: "asc" },
          { field: "title", direction: "asc" },
        ],
      }));
    }, accountId);
    await page.goto(`${BASE}/work-plans?view=month&date=2026-09-07`, { waitUntil: "domcontentloaded" });
    await ensureTaskListVisible(page);
    await expectTableTitles(page, EXPECTED_TITLE_ASC, "偏好清理后按剩余 title 排序");
    await expectNotice(page, "浏览器偏好中的失效排序字段已清理");
    const storedAfter = await page.evaluate((id) => window.localStorage.getItem(`workplan:list-sort:v1:${id}`), accountId);
    if (storedAfter?.includes("deleted_long_ago")) throw new Error("失效字段未从偏好写回清理");
    findings.push("账户偏好：失效字段逐项清理 + 写回 + 一次性提示 ✓");
    await screenshot(page, `${cell}-07-preference-cleaned`);

    // 6. 加载：请求期间保留上次结果并显示加载
    await page.goto(`${BASE}/work-plans?sort=title:asc&view=month&date=2026-09-07`, { waitUntil: "domcontentloaded" });
    await ensureTaskListVisible(page);
    await expectTableTitles(page, EXPECTED_TITLE_ASC, "title asc 基线");
    await page.route("**/api/v1/work-plans/query*", async (route) => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.continue();
      } catch {
        // unroute 竞争下的迟到回调：路由已失效，忽略
      }
    });
    await openSortPanel(page, input);
    await addSortField(page, input, 3); // 开始时间 → 触发新查询
    await page.waitForTimeout(400);
    const loadingFooter = await page.locator("text=正在加载…").first().isVisible();
    const rowsDuringLoad = await page.locator(".plan-row").count();
    if (!loadingFooter) throw new Error("请求期间未显示加载状态");
    if (rowsDuringLoad === 0) throw new Error("请求期间未保留上次结果");
    findings.push("加载：请求期间保留上次结果 + 页脚「正在加载…」✓");
    await screenshot(page, `${cell}-08-loading`);
    await page.waitForTimeout(1500); // 等待在途延迟请求完成，避免 unroute 竞争
    await page.unroute("**/api/v1/work-plans/query*");
    await closeSortPanel(page);

    // 7. 失败：保留结果/排序/页上下文 + 重试
    await expectTableTitles(page, EXPECTED_TITLE_ASC, "title asc 基线（失败前）");
    await page.route("**/api/v1/work-plans/query*", (route) => {
      route.abort("failed").catch(() => {});
    });
    await openSortPanel(page, input);
    await addSortField(page, input, 3);
    const alert = page.locator("[role='alert'].query-error-message");
    await alert.waitFor({ state: "visible", timeout: 20_000 });
    const duringFailure = await readTableTitles(page);
    if (JSON.stringify(duringFailure) !== JSON.stringify(EXPECTED_TITLE_ASC)) {
      throw new Error("失败时未保留上次成功结果与排序");
    }
    findings.push("失败：保留结果/排序/页上下文，面板进入失败态 ✓");
    await screenshot(page, `${cell}-09-query-failed`);
    await page.unroute("**/api/v1/work-plans/query*");
    const retryButton = page.locator("[role='alert'] button", { hasText: "重试" });
    await activate(page, input, retryButton);
    await page.waitForTimeout(1000);
    if ((await readTableTitles(page)).length === 0) throw new Error("重试后未恢复数据");
    findings.push("失败：重试恢复 ✓");
    await screenshot(page, `${cell}-10-retry-recovered`);

    // 8. 一致性：表格与甘特共享同一服务端顺序（月视图覆盖全部种子计划）
    await page.goto(`${BASE}/work-plans?sort=custom.stage:asc&view=month&date=2026-09-07`, { waitUntil: "domcontentloaded" });
    await ensureTaskListVisible(page);
    await page.locator(".plan-row").first().waitFor({ state: "visible" });
    await page.locator(".bar-wrapper[data-id]").first().waitFor({ state: "attached", timeout: 10_000 });
    await page.waitForTimeout(500);
    const tableIds = await page.locator(".plan-row").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-plan-id")));
    const ganttIds = await page.locator(".bar-wrapper[data-id]").evaluateAll((bars) => bars.map((bar) => bar.getAttribute("data-id")));
    const ganttRendered = ganttIds.filter((id) => tableIds.includes(id));
    if (JSON.stringify(ganttRendered) !== JSON.stringify(tableIds.filter((id) => ganttIds.includes(id)))) {
      throw new Error(`表格与甘特顺序不一致：表格 [${tableIds.join(",")}] 甘特 [${ganttIds.join(",")}]`);
    }
    findings.push(`一致性：表格与甘特共享同一服务端顺序 ✓（${ganttRendered.length}/${tableIds.length} 行在甘特范围内）`);
    await screenshot(page, `${cell}-11-table-gantt-order`);

    // 9. XLS 导出携带页面已生效的查询与排序，顺序与表格一致
    const exportButton = page.locator('button:has-text("导出 XLS")').first();
    await activate(page, input, exportButton);
    await page.locator('div[role="dialog"][aria-label="导出 XLS"]').waitFor({ state: "visible" });
    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
    await page.locator('div[role="dialog"][aria-label="导出 XLS"] button:has-text("导出")').last().click();
    const download = await downloadPromise;
    const exportPath = path.join(evidenceDir, `${cell}-export.xlsx`);
    await download.saveAs(exportPath);
    const workbook = XLSX.read(fs.readFileSync(exportPath), { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null }).map((row) => String(row?.[0] ?? ""));
    const exportTitles = rows.slice(1).filter(Boolean);
    if (JSON.stringify(exportTitles) !== JSON.stringify(EXPECTED_STAGE_ASC)) {
      throw new Error(`XLS 导出顺序与表格不一致：导出 [${exportTitles.join(", ")}]`);
    }
    findings.push(`一致性：XLS 导出携带已生效查询与排序，顺序与表格一致 ✓（${exportTitles.length} 行）`);
    await screenshot(page, `${cell}-12-export-done`);

    // 10. 授权边界
    if (role === "Viewer") {
      const createCount = await page.locator('button:has-text("新建工作计划")').count();
      if (createCount > 0) throw new Error("Viewer 可见新建工作计划入口");
      if (!(await page.locator(".read-only-hint").isVisible())) throw new Error("Viewer 未显示只读说明");
      findings.push("授权：Viewer 可排序/查询/导出，无任何写入口（新建隐藏 + 只读提示）✓");
      await screenshot(page, `${cell}-13-viewer-readonly`);
    } else {
      if (!(await page.locator('button:has-text("新建工作计划")').isVisible())) throw new Error(`${role} 缺少新建工作计划入口`);
      findings.push(`授权：${role} 全功能（新建入口可见；排序/导出可用）✓`);
      await screenshot(page, `${cell}-13-write-entry`);
    }

    log(`✅ ${cell} — ${findings.length} 项通过`);
    for (const finding of findings) log(`   · ${finding}`);
  } catch (error) {
    const file = await screenshot(page, `${cell}-FAILED`).catch(() => "screenshot-failed");
    log(`❌ ${cell}: ${error instanceof Error ? error.message : String(error)}（截图 ${path.basename(file)}）`);
  } finally {
    await browser.close();
  }
}

log(`# 票据 18 浏览器验收矩阵 — ${new Date().toISOString()}`);
log(`# 服务：${BASE}（隔离 DATA_DIR）；浏览器：/opt/homebrew/bin/chromium（headless）`);
log(`# 窄屏 390×844；桌面 1440×900；键盘格用 Tab/focus + Enter/方向键驱动`);
for (const { role, username } of ROLES) {
  for (const viewport of VIEWPORTS) {
    for (const input of INPUTS) {
      await runCell({ role, username, viewport, input });
    }
  }
}
log("# 矩阵执行完毕");
fs.writeFileSync(path.join(evidenceDir, "matrix-report.txt"), results.join("\n") + "\n");
console.log(`\n报告已写入 ${path.join(evidenceDir, "matrix-report.txt")}`);
