/* 甘特全屏浏览器验收截图脚本（无头 Chromium）。
   用法：node .scratch/gantt-fullscreen/qa/screenshot.cjs <输出目录> [模式]
   模式：baseline（默认，仅普通布局）| fullscreen（点击全屏按钮后截图）| both */
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core");

const BASE = "http://127.0.0.1:5173";
const OUT = process.argv[2] ?? path.join(__dirname, "shots");
const MODE = process.argv[3] ?? "baseline";

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.fill('input[type="text"], input:not([type="password"])', "qa-fullscreen");
  await page.fill('input[type="password"]', "qa-fullscreen-pass");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(overview|work-plans)/, { timeout: 15000 });
}

async function setTheme(page, theme) {
  await page.evaluate((next) => {
    window.localStorage.setItem("workplan:theme:v1", JSON.stringify({ version: 1, preference: next }));
  }, theme);
}

async function shootPlanner(page, { label, width, height, fullscreen }) {
  const page2 = await page.context().newPage();
  await page2.setViewportSize({ width, height });
  await page2.goto(`${BASE}/work-plans`, { waitUntil: "networkidle" });
  await page2.waitForSelector(".planner-panel", { timeout: 15000 });
  await page2.waitForTimeout(800);
  if (fullscreen) {
    await page2.click(".gantt-fullscreen-toggle");
    await page2.waitForTimeout(800);
  }
  await page2.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: false });
  const metrics = await page2.evaluate(() => {
    const doc = document.documentElement;
    const panel = document.querySelector(".planner-panel");
    const toolbar = document.querySelector(".table-toolbar");
    const rect = (el) => el ? JSON.parse(JSON.stringify(el.getBoundingClientRect())) : null;
    return {
      htmlGanttFullscreen: doc.classList.contains("gantt-fullscreen"),
      pageScrollX: window.scrollX,
      pageScrollY: window.scrollY,
      pageOverflowX: doc.scrollWidth > doc.clientWidth,
      panelRect: rect(panel),
      toolbarRect: rect(toolbar),
      toolbarScrollW: toolbar ? toolbar.scrollWidth : null,
      toolbarClientW: toolbar ? toolbar.clientWidth : null,
    };
  });
  console.log(label, JSON.stringify(metrics));
  await page2.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: "/opt/homebrew/bin/chromium" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  for (const theme of ["light", "dark"]) {
    await setTheme(page, theme);
    const suffix = theme === "light" ? "" : "-dark";
    await shootPlanner(page, { label: `desktop-1440${suffix}`, width: 1440, height: 900, fullscreen: false });
    await shootPlanner(page, { label: `narrow-390${suffix}`, width: 390, height: 844, fullscreen: false });
    if (MODE !== "baseline") {
      await shootPlanner(page, { label: `desktop-1440-fullscreen${suffix}`, width: 1440, height: 900, fullscreen: true });
      await shootPlanner(page, { label: `narrow-390-fullscreen${suffix}`, width: 390, height: 844, fullscreen: true });
    }
  }
  await browser.close();
  console.log("done:", OUT);
})().catch((error) => { console.error(error); process.exit(1); });
