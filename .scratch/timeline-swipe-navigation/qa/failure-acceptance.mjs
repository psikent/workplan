const task = await taskSpace("workplan swipe QA");
const page = task.page("p1");
const QA = "/Users/psikent/dev/workplan-dev/.scratch/timeline-swipe-navigation/qa";
const evalIn = (fn) => page.evaluate(fn);
const results = [];
const record = (name, detail, ok) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`); };

async function touchSwipe(startX, startY, dx, steps = 12) {
  await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y: startY, id: 1 }] });
  for (let i = 1; i <= steps; i += 1) await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: startX + (dx * i) / steps, y: startY, id: 1 }] });
  await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const gridPoint = () => evalIn(() => {
  const c = document.querySelector(".gantt-container"); const r = c.getBoundingClientRect();
  const cx=(Math.max(r.left,24)+Math.min(r.right,window.innerWidth-24))/2, cy=(r.top+r.bottom)/2;
  const blocked=".bar-wrapper, .bar, .handle, .handle-group, .timeline-reminder-bell, .popup-wrapper, button, a, .timeline-create-hover-hint";
  let best=null;
  for(let y=Math.round(r.top)+4;y<r.bottom-4;y+=6) for(let x=Math.round(r.left)+4;x<r.right-4;x+=8){
    if(x<28||x>window.innerWidth-28) continue;
    const st=document.elementsFromPoint(x,y);
    if(st.some(el=>el.closest(blocked))) continue;
    if(!st.find(el=>el.closest(".grid-header, .grid-row"))) continue;
    const d=Math.abs(x-cx)+Math.abs(y-cy); if(!best||d<best.d) best={x,y,d};
  }
  return best?{x:best.x,y:best.y}:null;
});
const rangeTitle = () => evalIn(() => document.querySelector(".table-toolbar-center strong")?.textContent ?? null);
const rowCount = () => evalIn(() => document.querySelectorAll(".plan-row").length);

// 页面已加载完成，仅后端被停止；滑动触发的目标范围查询必然失败。
await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
await page.goto("http://127.0.0.1:5199/work-plans");
await page.waitForTimeout(2500);
// 已加载完成后在网络层屏蔽范围查询：仅目标范围查询失败，既有数据不受影响。
await page.cdp("Network.enable", {});
await page.cdp("Network.setBlockedURLs", { urls: ["*work-plans/query*"] });

const before = await rangeTitle();
const pt = await gridPoint();
await touchSwipe(pt.x, pt.y, -120, 12);
await page.waitForTimeout(3500);
const title = await rangeTitle();
const alertText = await evalIn(() => document.querySelector('[role="alert"]')?.textContent ?? null);
const rows = await rowCount();
await page.screenshot({ path: `${QA}/failure-mobile.png` });
record("失败停留目标范围并显示失败与重试", { before, title, alertText, rows }, title !== before && Boolean(alertText && alertText.includes("失败")) && rows === 0);

// 解除屏蔽后重试，只呈现当前目标范围的数据。
await page.cdp("Network.setBlockedURLs", { urls: [] });
const clicked = await evalIn(() => { const b = document.querySelector('[role="alert"] button'); if (b) { b.click(); return true; } return false; });
await page.waitForTimeout(2500);
const retriedAlert = await evalIn(() => Boolean(document.querySelector('[role="alert"]')));
record("失败后重试可恢复且无旧数据混入", { clicked, retriedAlert }, clicked === true && retriedAlert === false);

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
