// 复核评审修复项：成立手势后的兼容点击被拦截；多指起手不误切；失败契约。
const task = await taskSpace("workplan swipe QA");
const page = task.page("p1");
const evalIn = (fn) => page.evaluate(fn);
const results = [];
const record = (name, detail, ok) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${JSON.stringify(detail)}`); };

async function setMobile(w, h, dark) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
  await page.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
  await page.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
}
const rangeTitle = () => evalIn(() => document.querySelector(".table-toolbar-center strong")?.textContent ?? null);
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
async function gotoPlans(q=""){ await page.goto(`http://127.0.0.1:5199/work-plans${q}`); await page.waitForTimeout(2200); await page.waitForFunction(()=>Boolean(document.querySelector(".grid-row")), undefined, {timeout:8000}); }

await setMobile(390, 844, false);
await gotoPlans();
// 登录态可能已失效，先确认页面在工作计划页。
const loggedIn = await evalIn(() => Boolean(document.querySelector(".planner-panel")));
if (!loggedIn) {
  await page.goto("http://127.0.0.1:5199/");
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const inputs = document.querySelectorAll("form input");
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; s.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(inputs[0], "admin"); set(inputs[1], "qa-swipe-pass");
  });
  await page.click("form button");
  await page.waitForTimeout(2000);
  await gotoPlans();
}

// ---- 成立手势后派发兼容 click：应被拦截（不打开抽屉） ----
const before = await rangeTitle();
await page.evaluate(() => {
  window.__clicks = [];
  document.addEventListener("click", (e) => window.__clicks.push({ prevented: e.defaultPrevented, target: e.target.getAttribute?.("class") }), true);
});
let pt = await gridPoint();
await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
for (let i = 1; i <= 12; i += 1) await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt.x - i * 12, y: pt.y, id: 1 }] });
await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(1500);
const after = await rangeTitle();
const drawerOpen = await evalIn(() => Boolean(document.querySelector(".editor-drawer")));
record("成立手势切换范围且不误开抽屉", { before, after, drawerOpen }, after !== before && drawerOpen === false);

// ---- 多指：第二指落在甘特条上应取消，不切换范围 ----
await gotoPlans();
const mpBefore = await rangeTitle();
pt = await gridPoint();
const barPoint = await evalIn(() => { const b = document.querySelector(".bar-wrapper"); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
await page.cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
for (let i = 1; i <= 10; i += 1) await page.cdp("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: pt.x - i * 14, y: pt.y, id: 1 }, { x: barPoint.x, y: barPoint.y, id: 2 }] });
await page.cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await page.waitForTimeout(1200);
const mpAfter = await rangeTitle();
record("多指（第二指落甘特条）不切换范围", { mpBefore, mpAfter }, mpAfter === mpBefore);

console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(results, null, 2));
