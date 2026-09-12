const task = await taskSpace("workplan swipe QA");
const page = task.page("p1");

const results = [];
const record = (name, detail, ok) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`);
};

async function setMobile(width, height, dark) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
}

async function touchSwipe(startX, startY, dx, steps = 10) {
  await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y: startY, id: 1 }] });
  for (let i = 1; i <= steps; i += 1) {
    const x = startX + (dx * i) / steps;
    await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: startY, id: 1 }] });
  }
  await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const evalIn = (fn) => page.evaluate(fn);
// 找一个真正落在「日期表头空白 / 日期网格背景」上的起手点：在整个时间轴区域内细扫，
// 用 elementsFromPoint 的完整命中栈排除甘特条、手柄、铃铛与按钮——这些本就不该触发手势。
// 取离时间轴中心最近的合格点：既保证位移全程留在视口内（Chrome 在触点越界时会发
// pointercancel），也避开左右各 24px 的浏览器边缘保留区。
const gridPoint = () => evalIn(() => {
  const container = document.querySelector(".gantt-container");
  if (!container) return null;
  const r = container.getBoundingClientRect();
  const cx = (Math.max(r.left, 24) + Math.min(r.right, window.innerWidth - 24)) / 2;
  const cy = (Math.max(r.top, 0) + r.bottom) / 2;
  const blocked = ".bar-wrapper, .bar, .handle, .handle-group, .timeline-reminder-bell, .popup-wrapper, button, a, .timeline-create-hover-hint";
  let best = null;
  for (let y = Math.round(r.top) + 4; y < r.bottom - 4; y += 6) {
    for (let x = Math.round(r.left) + 4; x < r.right - 4; x += 8) {
      if (x < 28 || x > window.innerWidth - 28) continue;
      const stack = document.elementsFromPoint(x, y);
      if (stack.some((el) => el.closest(blocked))) continue;
      const surface = stack.find((el) => el.closest(".grid-header, .grid-row"));
      if (!surface) continue;
      const distance = Math.abs(x - cx) + Math.abs(y - cy);
      if (!best || distance < best.distance) best = { x, y, surface: surface.getAttribute("class"), distance };
    }
  }
  return best ? { x: best.x, y: best.y, surface: best.surface } : null;
});
const rangeTitle = () => evalIn(() => document.querySelector(".table-toolbar-center strong")?.textContent ?? null);
const scrollState = () => evalIn(() => {
  const c = document.querySelector(".gantt-container");
  return c ? { left: Math.round(c.scrollLeft), width: c.clientWidth, scrollWidth: c.scrollWidth } : null;
});
const hintState = () => evalIn(() => {
  const h = document.querySelector(".timeline-swipe-hint");
  return h ? { text: h.textContent, opacity: h.style.opacity, cls: h.className } : null;
});

async function gotoPlans(query = "") {
  await page.goto(`http://127.0.0.1:5199/work-plans${query}`);
  await page.waitForTimeout(2000);
  await page.waitForFunction(() => Boolean(document.querySelector(".grid-row")), undefined, { timeout: 8000 });
}

// ---- Case 1: 手机上（390px）周视图左滑进入下一周、右滑返回上一周 ----
await setMobile(390, 844, false);
await gotoPlans();
const startTitle = await rangeTitle();
let pt = await gridPoint();
const before = await scrollState();
await touchSwipe(pt.x, pt.y, -120);
await page.waitForTimeout(1200);
const afterSwipeTitle = await rangeTitle();
record("390px 周视图左滑进入下一周", { startTitle, afterSwipeTitle, before }, afterSwipeTitle !== startTitle);

// ---- Case 2: 右滑回到上一周 ----
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, 120);
await page.waitForTimeout(1200);
const backTitle = await rangeTitle();
record("390px 周视图右滑返回上一周", { from: afterSwipeTitle, backTitle }, backTitle === startTitle);

// ---- Case 3: 月视图边界交接（窄屏有横向余量：先滚到边界，再向边界外滑才换月） ----
await setMobile(390, 844, false);
await gotoPlans("?view=month");
const monthStart = await rangeTitle();
let ms = await scrollState();
// 从范围内部起手左滑 → 只滚动，不换月。
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, -140, 12);
await page.waitForTimeout(800);
const midScroll = await scrollState();
const midMonth = await rangeTitle();
record("月视图范围内部左滑只滚动不换月", { ms, midScroll, monthStart, midMonth }, midMonth === monthStart && midScroll.left > ms.left);

// 滚到右边界，再从左边界... 到右边界后左滑 → 下一月。
await evalIn(() => { const c = document.querySelector(".gantt-container"); c.scrollLeft = c.scrollWidth - c.clientWidth; });
await page.waitForTimeout(300);
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, -140, 12);
await page.waitForTimeout(1200);
const monthNext = await rangeTitle();
record("月视图到右边界后左滑进入下一月", { monthStart, monthNext }, monthNext !== monthStart);

// 回到左边界后右滑 → 上一月。
await evalIn(() => { const c = document.querySelector(".gantt-container"); c.scrollLeft = 0; });
await page.waitForTimeout(300);
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, 140, 12);
await page.waitForTimeout(1200);
const monthBack = await rangeTitle();
record("月视图到左边界后右滑返回上一月", { from: monthNext, monthBack }, monthBack === monthStart);

// ---- Case 3b: 宽桌面（月视图无横向余量）→ 两向都可直接换月 ----
// 月视图 28 列按最小列宽约 896px，只有时间轴面板足够宽时才没有横向余量。
await setMobile(1600, 900, false);
await gotoPlans("?view=month");
// 收起任务列表把整块面板宽度让给时间轴：此时月视图 28 列不再需要横向余量。
// 折叠状态会经 localStorage 跨运行保留，故先确认当前状态再点（已折叠则不点）。
const collapsed = await evalIn(() => document.querySelector(".planner-panel")?.classList.contains("planner-collapsed"));
if (!collapsed) {
  await page.click('button[aria-label="收起任务列表"]');
  await page.waitForTimeout(800);
}
const wideScroll = await scrollState();
const wideStart = await rangeTitle();
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, -160, 12);
await page.waitForTimeout(1200);
const wideNext = await rangeTitle();
record("月视图无横向余量时左滑直接进入下一月", { wideScroll, wideStart, wideNext }, wideNext !== wideStart && wideScroll.scrollWidth <= wideScroll.width + 1);
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, 160, 12);
await page.waitForTimeout(1200);
const wideBack = await rangeTitle();
record("月视图无横向余量时右滑返回上一月", { from: wideNext, wideBack }, wideBack === wideStart);

// ---- Case 4: 月内横向滚动优先，不翻月 ----
// 极窄宽度下月视图存在横向余量：从范围内部起手横滑应滚动而不换月。
await setMobile(360, 700, false);
await gotoPlans("?view=month");
const scrollBefore = await scrollState();
const monthGuard = await rangeTitle();
pt = await gridPoint();
await touchSwipe(pt.x, pt.y, -180, 14);
await page.waitForTimeout(1200);
const scrollAfter = await scrollState();
const monthGuardAfter = await rangeTitle();
record("月视图范围内部横滑只滚动不换月", { scrollBefore, scrollAfter, monthGuard, monthGuardAfter }, monthGuardAfter === monthGuard);

// ---- Case 5: 纵向滑动不换范围（原生纵向滚动保留） ----
await gotoPlans();
const verticalBefore = await rangeTitle();
pt = await gridPoint();
await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
for (let i = 1; i <= 10; i += 1) {
  await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt.x + i * 2, y: pt.y + i * 12, id: 1 }] });
}
await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(1200);
const verticalAfter = await rangeTitle();
record("纵向滑动不改变时间范围", { verticalBefore, verticalAfter }, verticalAfter === verticalBefore);

// ---- Case 6: 反馈提示（方向箭头 + 文案）出现 ----
await gotoPlans();
await setMobile(390, 844, false);
await page.waitForTimeout(500);
pt = await gridPoint();
await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
for (let i = 1; i <= 8; i += 1) {
  await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt.x - i * 12, y: pt.y, id: 1 }] });
}
await page.waitForTimeout(150);
const hint = await hintState();
await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(600);
const hintAfter = await hintState();
record("滑动过程显示方向与范围文案，松手后清除", { hint, hintAfter }, Boolean(hint && hint.text) && hintAfter === null);

// ---- Case 7: 浏览器视口边缘 24px 保留区不触发 ----
await gotoPlans();
await setMobile(390, 844, false);
await page.waitForTimeout(500);
const edgeGuard = await rangeTitle();
pt = await gridPoint();
await touchSwipe(8, pt.y, 120);
await page.waitForTimeout(1000);
const edgeAfter = await rangeTitle();
record("视口左边缘 24px 内起手不触发范围切换", { edgeGuard, edgeAfter }, edgeAfter === edgeGuard);

// ---- Case 8: 浅色/深色反馈可辨识 + 窄屏/平板无横向溢出 ----
await setMobile(390, 844, false);
await gotoPlans();
await page.screenshot({ path: "/Users/psikent/dev/workplan-dev/.scratch/timeline-swipe-navigation/qa/light-mobile-week.png", fullPage: false });
const lightOverflow = await evalIn(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
await setMobile(390, 844, true);
await page.waitForTimeout(600);
await page.screenshot({ path: "/Users/psikent/dev/workplan-dev/.scratch/timeline-swipe-navigation/qa/dark-mobile-week.png", fullPage: false });
await setMobile(1024, 768, false);
await gotoPlans();
await page.screenshot({ path: "/Users/psikent/dev/workplan-dev/.scratch/timeline-swipe-navigation/qa/tablet-week.png", fullPage: false });
const tabletOverflow = await evalIn(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
record("窄屏与平板无额外横向溢出", { lightOverflow, tabletOverflow }, lightOverflow.scrollW <= lightOverflow.clientW + 1 && tabletOverflow.scrollW <= tabletOverflow.clientW + 1);

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
