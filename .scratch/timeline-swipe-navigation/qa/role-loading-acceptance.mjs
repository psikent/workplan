const task = await taskSpace("workplan swipe QA");
const page = task.page("p1");
const results = [];
const record = (name, detail, ok) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`); };
const evalIn = (fn) => page.evaluate(fn);
const QA = "/Users/psikent/dev/workplan-dev/.scratch/timeline-swipe-navigation/qa";

async function setMobile(width, height, dark) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
}
async function touchSwipe(startX, startY, dx, steps = 12) {
  await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y: startY, id: 1 }] });
  for (let i = 1; i <= steps; i += 1) await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX + (dx * i) / steps, y: startY, id: 1 }] });
  await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const gridPoint = () => evalIn(() => {
  const container = document.querySelector(".gantt-container");
  const r = container.getBoundingClientRect();
  const cx = (Math.max(r.left, 24) + Math.min(r.right, window.innerWidth - 24)) / 2, cy = (r.top + r.bottom) / 2;
  const blocked = ".bar-wrapper, .bar, .handle, .handle-group, .timeline-reminder-bell, .popup-wrapper, button, a, .timeline-create-hover-hint";
  let best = null;
  for (let y = Math.round(r.top) + 4; y < r.bottom - 4; y += 6) for (let x = Math.round(r.left) + 4; x < r.right - 4; x += 8) {
    if (x < 28 || x > window.innerWidth - 28) continue;
    const stack = document.elementsFromPoint(x, y);
    if (stack.some((el) => el.closest(blocked))) continue;
    if (!stack.find((el) => el.closest(".grid-header, .grid-row"))) continue;
    const d = Math.abs(x - cx) + Math.abs(y - cy);
    if (!best || d < best.d) best = { x, y, d };
  }
  return best ? { x: best.x, y: best.y } : null;
});
const rangeTitle = () => evalIn(() => document.querySelector(".table-toolbar-center strong")?.textContent ?? null);
async function gotoPlans(query = "") {
  await page.goto(`http://127.0.0.1:5199/work-plans${query}`);
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => Boolean(document.querySelector(".grid-row")), undefined, { timeout: 8000 });
}

// ---- 加载状态：限速网络，滑动后立即截图 ----
await setMobile(390, 844, false);
await gotoPlans();
await page.cdp("Network.enable", {});
await page.evaluate(() => {
  // 记录范围查询是否仍返回旧范围数据（用于验证占位数据不绘制）。
  window.__queries = [];
  const of = window.fetch;
  window.fetch = async (...args) => { const res = await of(...args); return res; };
});
await page.cdp("Network.emulateNetworkConditions", { offline: false, latency: 3000, downloadThroughput: 20000, uploadThroughput: 20000 });
const loadBefore = await rangeTitle();
const pt = await gridPoint();
await touchSwipe(pt.x, pt.y, -120, 12);
await page.waitForTimeout(400);
const loadingOverlay = await evalIn(() => Boolean(document.querySelector(".timeline-range-loading")));
const loadingTitle = await rangeTitle();
const stalePlansDuringLoad = await evalIn(() => document.querySelectorAll(".plan-row").length);
await page.screenshot({ path: `${QA}/loading-mobile.png` });
record("滑动后立即显示目标范围标题与加载状态", { loadBefore, loadingTitle, loadingOverlay, stalePlansDuringLoad }, loadingTitle !== loadBefore && loadingOverlay === true && stalePlansDuringLoad === 0);

// 加载覆盖层期间仍可继续滑动（进入再一个范围）。
const pt2 = await gridPoint();
await touchSwipe(pt2.x, pt2.y, -120, 12);
await page.waitForTimeout(500);
const loadingTitle2 = await rangeTitle();
record("加载中仍可继续逐次滑动", { loadingTitle, loadingTitle2 }, loadingTitle2 !== loadingTitle);
await page.cdp("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
await page.waitForTimeout(5000);
const settledTitle = await rangeTitle();
const settledRows = await evalIn(() => document.querySelectorAll(".plan-row").length);
record("加载完成后呈现最终范围数据", { settledTitle, settledRows }, settledRows >= 0);

// ---- 失败状态：在网络层屏蔽目标范围查询 ----
await setMobile(390, 844, false);
await gotoPlans();
await page.cdp("Network.enable", {});
const failBefore = await rangeTitle();
await page.cdp("Network.setBlockedURLs", { urls: ["*/api/work-plans/query*"] });
const ptf = await gridPoint();
await touchSwipe(ptf.x, ptf.y, -120, 12);
await page.waitForTimeout(3000);
const failTitle = await rangeTitle();
const alertText = await evalIn(() => document.querySelector('[role="alert"]')?.textContent ?? null);
const rowsOnFail = await evalIn(() => document.querySelectorAll(".plan-row").length);
await page.screenshot({ path: `${QA}/failure-mobile.png` });
record("失败停留目标范围并显示失败与重试", { failBefore, failTitle, alertText, rowsOnFail }, failTitle !== failBefore && Boolean(alertText && alertText.includes("失败")) && rowsOnFail === 0);

// 失败后仍可继续滑动离开（屏蔽仍在，故只是离开到下一范围）。
const ptf2 = await gridPoint();
await touchSwipe(ptf2.x, ptf2.y, 120, 12);
await page.waitForTimeout(2500);
const afterFailSwipe = await rangeTitle();
record("失败后仍可继续滑动离开", { failTitle, afterFailSwipe }, afterFailSwipe === failBefore);

// 解除屏蔽后重试成功，只呈现当前目标范围数据。
await page.cdp("Network.setBlockedURLs", { urls: [] });
const retry = await evalIn(() => { const a = document.querySelector('[role="alert"]'); const b = a?.querySelector("button"); if (b) { b.click(); return true; } return false; });
await page.waitForTimeout(2500);
const retriedAlert = await evalIn(() => Boolean(document.querySelector('[role="alert"]')));
record("失败后重试可恢复", { retry, retriedAlert }, retry === true && retriedAlert === false);

// ---- Viewer 账户：只读仍可用手势 ----
await page.evaluate(() => { window.fetch = window.__origFetch ?? window.fetch; });
await page.goto("http://127.0.0.1:5199/");
await page.waitForTimeout(500);
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
