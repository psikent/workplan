/* 图例移位浏览器验收截图脚本（无头 Chromium）。
   用法：node .scratch/gantt-legend-corner/qa/legend-shot.cjs <输出目录> */
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core");

const BASE = "http://127.0.0.1:5173";
const OUT = process.argv[2] ?? path.join(__dirname, "shots");

async function login(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.fill('input[type="text"], input:not([type="password"])', "qa-fullscreen");
  await page.fill('input[type="password"]', "qa-fullscreen-pass");
  await page.evaluate(() => {
    const button = document.querySelector('button[type="submit"]');
    if (button) button.click();
  });
  try {
    await page.waitForURL(/\/(overview|work-plans)/, { timeout: 15000 });
  } catch (error) {
    await page.screenshot({ path: path.join(OUT, "login-failed.png"), fullPage: true });
    throw error;
  }
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
  await page2.waitForSelector(".gantt-legend, .planner-timeline", { timeout: 15000 });
  await page2.waitForTimeout(800);
  if (fullscreen) {
    await page2.click(".gantt-fullscreen-toggle");
    await page2.waitForTimeout(800);
  }
  const metrics = await page2.evaluate(() => {
    const rect = (el) => (el ? JSON.parse(JSON.stringify(el.getBoundingClientRect())) : null);
    const legend = document.querySelector(".gantt-legend");
    const timeline = document.querySelector(".planner-timeline");
    const legendRect = rect(legend);
    const timelineRect = rect(timeline);
    let anchored = null;
    let afterStrip = null;
    if (legend && timeline) {
      const rightGap = Math.round(timelineRect.right - legendRect.right);
      const bottomGap = Math.round(timelineRect.bottom - legendRect.bottom);
      anchored = { rightGap, bottomGap };
      const afterStyle = getComputedStyle(timeline, "::after");
      afterStrip = {
        gridColumnStart: afterStyle.gridColumnStart,
        gridRowStart: afterStyle.gridRowStart,
        borderTopWidth: afterStyle.borderTopWidth,
        background: afterStyle.backgroundColor,
      };
    }
    return { legendPresent: Boolean(legend), legendRect, timelineRect, anchored, afterStrip };
  });
  await page2.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: false });
  if (metrics.timelineRect) {
    const tr = metrics.timelineRect;
    await page2.screenshot({
      path: path.join(OUT, `${label}-strip.png`),
      clip: { x: Math.max(tr.right - 460, 0), y: Math.max(tr.bottom - 70, 0), width: Math.min(460, tr.width), height: 70 },
    });
  }
  console.log(label, JSON.stringify(metrics));
  await page2.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: "/opt/homebrew/bin/chromium" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page);

  for (const theme of ["dark", "light"]) {
    await setTheme(page, theme);
    const suffix = theme === "light" ? "" : "-dark";
    await shootPlanner(page, { label: `desktop-1440${suffix}`, width: 1440, height: 900, fullscreen: false });
    await shootPlanner(page, { label: `narrow-390${suffix}`, width: 390, height: 844, fullscreen: false });
    await shootPlanner(page, { label: `desktop-1440-fullscreen${suffix}`, width: 1440, height: 900, fullscreen: true });
  }
  await browser.close();
  console.log("done:", OUT);
})().catch((error) => { console.error(error); process.exit(1); });
