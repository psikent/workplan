/* 甘特全屏交互验收：滚动保持、抽屉 Esc 优先、浮层关闭、退出恢复。 */
const { chromium } = require("/usr/local/lib/node_modules/@playwright/cli/node_modules/playwright-core");
const BASE = "http://127.0.0.1:5173";

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + JSON.stringify(detail) : ""}`);
}

const click = (page, sel) => page.evaluate((s) => document.querySelector(s)?.click(), sel);

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: "/opt/homebrew/bin/chromium" });
  // 矮窗口让列表纵向溢出；月视图让时间轴横向溢出（周视图 7 列整周无横向滚动）
  const page = await browser.newPage({ viewport: { width: 1440, height: 520 } });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.fill('input[type="text"], input:not([type="password"])', "qa-fullscreen");
  await page.fill('input[type="password"]', "qa-fullscreen-pass");
  await page.click('button[type="submit"]');
  await page.waitForSelector(".planner-panel", { timeout: 15000 });
  await click(page, ".view-switch button:nth-child(2)"); // 月视图
  await page.waitForTimeout(800);

  // 1) 滚动时间轴与列表后进入全屏：横向/纵向位置应保持。
  // 列表纵向与时间轴纵向联动同步：横向滚动事件会触发纵向同步拉回列表，
  // 因此先定纵向、等同步稳定，再定横向、再等稳定，然后取基线。
  await page.evaluate(() => {
    document.querySelector(".gantt-container").scrollTop = 90;
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.querySelector(".gantt-container").scrollLeft = 400;
  });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => ({
    left: document.querySelector(".gantt-container").scrollLeft,
    top: document.querySelector(".plan-rows").scrollTop,
  }));
  await click(page, ".gantt-fullscreen-toggle");
  await page.waitForTimeout(1200); // 宽度防抖 150ms + 重建 + 恢复
  const afterEnter = await page.evaluate(() => {
    const gc = document.querySelector(".gantt-container");
    return {
      fullscreen: document.documentElement.classList.contains("gantt-fullscreen"),
      left: gc?.scrollLeft ?? null,
      maxLeft: gc ? gc.scrollWidth - gc.clientWidth : null,
      top: document.querySelector(".plan-rows")?.scrollTop ?? null,
      headerVisible: !!document.querySelector(".page-header")?.offsetParent,
      sidebarVisible: !!document.querySelector(".sidebar")?.offsetParent,
      panelRect: JSON.parse(JSON.stringify(document.querySelector(".planner-panel").getBoundingClientRect())),
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };
  });
  check("进入全屏", afterEnter.fullscreen === true);
  check("进入后时间轴横向滚动保持（按新容器钳制）", afterEnter.left !== null && afterEnter.maxLeft > 0
    && Math.abs(afterEnter.left - Math.min(before.left, afterEnter.maxLeft)) <= 2, { before: before.left, after: afterEnter.left, maxLeft: afterEnter.maxLeft });
  check("进入后列表纵向滚动保持", afterEnter.top !== null && Math.abs(afterEnter.top - before.top) <= 2, { before: before.top, after: afterEnter.top });
  check("全屏隐藏页面级元素", afterEnter.headerVisible === false && afterEnter.sidebarVisible === false);
  check("全屏面板铺满窗口", afterEnter.panelRect.width === afterEnter.innerWidth && afterEnter.panelRect.height === afterEnter.innerHeight, afterEnter.panelRect);

  // 2) 全屏中打开列设置浮层 → Esc 先关浮层，不退全屏
  await click(page, ".list-column-settings .column-settings-button");
  await page.waitForTimeout(200);
  const popoverOpen = await page.evaluate(() => !!document.querySelector(".list-column-settings .column-settings-popover"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const popoverClosed = await page.evaluate(() => ({
    open: !!document.querySelector(".list-column-settings .column-settings-popover"),
    fullscreen: document.documentElement.classList.contains("gantt-fullscreen"),
  }));
  check("列设置浮层可打开（全屏中）", popoverOpen);
  check("Esc 先关浮层并保持全屏", !popoverClosed.open && popoverClosed.fullscreen);

  // 3) 全屏中打开抽屉 → Esc 关抽屉，第二次 Esc 退全屏
  await click(page, ".plan-row .plan-title-button");
  await page.waitForTimeout(600);
  const drawerOpen = await page.evaluate(() => !!document.querySelector(".editor-drawer"));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const drawerClosed = await page.evaluate(() => ({
    drawer: !!document.querySelector(".editor-drawer"),
    fullscreen: document.documentElement.classList.contains("gantt-fullscreen"),
  }));
  check("全屏中可打开抽屉", drawerOpen);
  check("Esc 先关抽屉且保持全屏", !drawerClosed.drawer && drawerClosed.fullscreen);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const exited = await page.evaluate(() => document.documentElement.classList.contains("gantt-fullscreen"));
  check("第二次 Esc 退出全屏", !exited);

  // 4) 退出后页面级元素恢复、滚动仍在（以全屏时的位置为基线，受新容器钳制）
  const afterExit = await page.evaluate(() => {
    const gc = document.querySelector(".gantt-container");
    return {
      headerVisible: !!document.querySelector(".page-header")?.offsetParent,
      sidebarVisible: !!document.querySelector(".sidebar")?.offsetParent,
      left: gc?.scrollLeft ?? null,
      maxLeft: gc ? gc.scrollWidth - gc.clientWidth : null,
      top: document.querySelector(".plan-rows")?.scrollTop ?? null,
    };
  });
  check("退出恢复页面级元素", afterExit.headerVisible && afterExit.sidebarVisible);
  check("退出后滚动位置保持", afterExit.left !== null && afterExit.maxLeft > 0
    && Math.abs(afterExit.left - Math.min(afterEnter.left, afterExit.maxLeft)) <= 2
    && Math.abs(afterExit.top - afterEnter.top) <= 2, afterExit);

  // 5) 进入前打开的列设置浮层在进入全屏时被关闭
  await click(page, ".list-column-settings .column-settings-button");
  await page.waitForTimeout(200);
  await click(page, ".gantt-fullscreen-toggle");
  await page.waitForTimeout(400);
  const closedOnEnter = await page.evaluate(() => ({
    open: !!document.querySelector(".list-column-settings .column-settings-popover"),
    fullscreen: document.documentElement.classList.contains("gantt-fullscreen"),
  }));
  check("进入全屏关闭已展开浮层", !closedOnEnter.open && closedOnEnter.fullscreen);
  await click(page, ".gantt-fullscreen-toggle");
  await page.waitForTimeout(300);

  // 6) 刷新后初始为普通布局
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".planner-panel", { timeout: 15000 });
  const reloaded = await page.evaluate(() => document.documentElement.classList.contains("gantt-fullscreen"));
  check("刷新后为普通布局", !reloaded);

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? "ALL PASS" : `${failed.length} FAILED`);
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(1); });
