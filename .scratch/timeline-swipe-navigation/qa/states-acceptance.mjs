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

// ---- 反馈提示截图（浅/深色，静止在手势中） ----
await setMobile(390, 844, false);
await gotoPlans();
let pt = await gridPoint();
await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
for (let i = 1; i <= 6; i += 1) await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt.x + i * 10, y: pt.y, id: 1 }] });
await page.screenshot({ path: `${QA}/hint-light.png` });
const hintLight = await evalIn(() => { const h = document.querySelector(".timeline-swipe-hint"); return h ? { text: h.textContent, opacity: h.style.opacity, cls: h.className } : null; });
await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
record("浅色反馈提示显示上一周与方向", hintLight, Boolean(hintLight && hintLight.text === "‹上一周" && hintLight.cls.includes("edge-left")));

await setMobile(390, 844, true);
await page.waitForTimeout(600);
pt = await gridPoint();
await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
for (let i = 1; i <= 6; i += 1) await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt.x - i * 10, y: pt.y, id: 1 }] });
await page.screenshot({ path: `${QA}/hint-dark.png` });
await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
record("深色反馈提示可辨识（截图存档）", { file: "hint-dark.png" }, true);

// ---- 减少动态效果：仍显示静态提示 ----
await setMobile(390, 844, false);
await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await page.waitForTimeout(400);
pt = await gridPoint();
await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
for (let i = 1; i <= 6; i += 1) await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt.x + i * 10, y: pt.y, id: 1 }] });
await page.screenshot({ path: `${QA}/hint-reduced-motion.png` });
const rmHint = await evalIn(() => Boolean(document.querySelector(".timeline-swipe-hint")));
await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
record("减少动态效果下仍显示静态提示", { rmHint }, rmHint === true);
await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "" }] });

// ---- 甘特全屏模式下滑动可用 ----
await setMobile(390, 844, false);
await gotoPlans();
await page.click('button[aria-label="进入全屏"]');
await page.waitForTimeout(900);
const fsTitle = await rangeTitle();
await page.screenshot({ path: `${QA}/fullscreen.png` });
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, -120, 12);
await page.waitForTimeout(1200);
const fsAfter = await rangeTitle();
record("甘特全屏模式下滑动切换范围", { fsTitle, fsAfter }, fsAfter !== fsTitle);
await page.click('button[aria-label="退出全屏"]');
await page.waitForTimeout(600);

// ---- 抽屉打开时暂停识别 ----
// 桌面宽度下抽屉只占右侧，时间轴左侧仍可见：先记录一个有效起手点，再开抽屉后滑动。
await setMobile(1280, 900, false);
await gotoPlans();
const drawerPoint = await gridPoint();
const drawerBefore = await rangeTitle();
const beforeSwipe = await rangeTitle();
await touchSwipe(drawerPoint.x, drawerPoint.y, -140, 12);
await page.waitForTimeout(1000);
const baselineAfter = await rangeTitle();
record("抽屉未打开时同一点滑动可换范围", { beforeSwipe, baselineAfter }, baselineAfter !== beforeSwipe);

await page.evaluate(() => document.querySelector(".plan-title-button")?.click());
await page.waitForTimeout(900);
const drawerOpen = await evalIn(() => Boolean(document.querySelector(".editor-drawer")));
const suspendedBefore = await rangeTitle();
await touchSwipe(drawerPoint.x, drawerPoint.y, 140, 12);
await page.waitForTimeout(1200);
const suspendedAfter = await rangeTitle();
await page.screenshot({ path: `${QA}/drawer-suspended.png` });
record("抽屉打开时滑动不改变范围", { drawerOpen, suspendedBefore, suspendedAfter }, drawerOpen && suspendedAfter === suspendedBefore);
await page.evaluate(() => { const b = [...document.querySelectorAll(".editor-drawer button")].find((el) => /取消|关闭|关闭编辑/.test(el.getAttribute("aria-label") || el.textContent || "")); b?.click(); });
await page.waitForTimeout(500);

// ---- 空数据范围仍可滑动 ----
await gotoPlans();
await page.evaluate(() => { const i = document.querySelector('input[placeholder="搜索工作计划"]'); const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(i, "____不存在的计划____"); i.dispatchEvent(new Event("input", { bubbles: true })); });
await page.waitForTimeout(1600);
const emptyTitle = await rangeTitle();
const emptyVisible = await evalIn(() => Boolean(document.querySelector(".timeline-empty") || document.querySelector(".plan-list-empty")));
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, -120, 12);
await page.waitForTimeout(1200);
const emptyAfter = await rangeTitle();
record("空数据范围仍可滑动导航", { emptyVisible, emptyTitle, emptyAfter }, emptyAfter !== emptyTitle);

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
