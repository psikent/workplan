// 票据 05 手工验收脚本：针对构建产物启动真实服务，逐项执行 Viewer 验收清单。
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const port = 3997;
const base = `http://127.0.0.1:${port}`;
const dataDir = "/tmp/workplan-acceptance-data";
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

let failures = 0;
function check(label, condition, extra = "") {
  const status = condition ? "PASS" : "FAIL";
  if (!condition) failures += 1;
  console.log(`[${status}] ${label}${extra ? ` — ${extra}` : ""}`);
}

const server = spawn("node", ["apps/server/dist/index.js"], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dataDir,
    APP_SECRET: "acceptance-secret-0123456789abcdef0123456789abcdef",
    APP_BASE_URL: base,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverOutput = [];
server.stdout.on("data", (chunk) => serverOutput.push(String(chunk)));
server.stderr.on("data", (chunk) => serverOutput.push(String(chunk)));

async function waitForReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${base}/health/ready`);
      if (response.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server did not become ready:\n${serverOutput.join("")}`);
}

async function api(path, { method = "GET", body, cookie, csrf, bearer } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers["x-csrf-token"] = csrf;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return response;
}

function sessionParts(loginResponse) {
  const setCookie = loginResponse.headers.get("set-cookie") ?? "";
  return { cookie: setCookie.split(";")[0], csrf: "" };
}

try {
  await waitForReady();
  const setupStatus = await (await api("/api/v1/setup/status")).json();

  // 1. 初始化管理员
  const setupToken = (serverOutput.join("").match(/one-time setup token"?\s*:\s*"([^"]+)"/) ?? [])[1]
    ?? JSON.parse(serverOutput.join("").split("\n").find((line) => line.includes("setupToken")) ?? "{}").setupToken;
  check("一次性初始化令牌已输出到日志", Boolean(setupToken));
  const setupResponse = await api("/api/v1/setup", { method: "POST", body: { token: setupToken, username: "admin", password: "acceptance-admin-password" } });
  const setupBody = await setupResponse.json();
  check("管理员初始化并登录成功", setupResponse.status === 200 && setupBody.user.role === "admin");
  const admin = sessionParts(setupResponse);
  admin.csrf = setupBody.csrfToken;

  // 2. 创建密码 Viewer 与 Token-only Viewer
  const passwordViewerResponse = await api("/api/v1/users", { method: "POST", cookie: admin.cookie, csrf: admin.csrf, body: { username: "viewer-web", role: "viewer", loginMode: "password", password: "acceptance-viewer-password" } });
  const passwordViewer = await passwordViewerResponse.json();
  check("管理员创建密码 Viewer", passwordViewerResponse.status === 201 && passwordViewer.user.role === "viewer");
  const tokenViewerResponse = await api("/api/v1/users", { method: "POST", cookie: admin.cookie, csrf: admin.csrf, body: { username: "viewer-api", role: "viewer", loginMode: "token", tokenName: "验收查询 Token", tokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
  const tokenViewer = await tokenViewerResponse.json();
  check("管理员创建 Token-only Viewer", tokenViewerResponse.status === 201 && tokenViewer.user.role === "viewer" && tokenViewer.accessToken.token.startsWith("wp_"));
  const viewerToken = tokenViewer.accessToken.token;

  // 创建业务数据（管理员）
  const planResponse = await api("/api/v1/work-plans", { method: "POST", cookie: admin.cookie, csrf: admin.csrf, body: { title: "验收计划", description: "", startAt: new Date(Date.now() + 3600_000).toISOString(), endAt: new Date(Date.now() + 7200_000).toISOString(), customFields: {} } });
  const plan = await planResponse.json();
  check("管理员创建工作计划", planResponse.status === 201);
  const goalResponse = await api("/api/v1/monthly-goals", { method: "POST", cookie: admin.cookie, csrf: admin.csrf, body: { title: "验收目标", year: new Date().getFullYear(), month: new Date().getMonth() + 1, workPlanId: plan.id } });
  check("管理员创建关联月目标", goalResponse.status === 201);
  const templateResponse = await api("/api/v1/export-templates", { method: "POST", cookie: admin.cookie, csrf: admin.csrf, body: { name: "验收模板", sheetName: "工作计划", columns: [{ source: "title", header: "工作内容" }, { source: "status", header: "状态" }] } });
  const template = await templateResponse.json();
  check("管理员创建导出模板", templateResponse.status === 201);

  // 3. 密码 Viewer 登录
  const viewerLogin = await api("/api/v1/auth/login", { method: "POST", body: { username: "viewer-web", password: "acceptance-viewer-password" } });
  const viewerLoginBody = await viewerLogin.json();
  const viewer = sessionParts(viewerLogin);
  viewer.csrf = viewerLoginBody.csrfToken;
  check("密码 Viewer 登录成功", viewerLogin.status === 200 && viewerLoginBody.user.role === "viewer");

  // 4. /auth/me
  const meSession = await (await api("/api/v1/auth/me", { cookie: viewer.cookie })).json();
  const meToken = await (await api("/api/v1/auth/me", { bearer: viewerToken })).json();
  check("/auth/me 返回 role=viewer（会话）", meSession.user?.role === "viewer" && meSession.authKind === "session");
  check("/auth/me 返回 role=viewer（Token）", meToken.user?.role === "viewer" && meToken.authKind === "token");

  // 5. Viewer 查询与导出
  const queryPaths = [
    "/api/v1/work-plans?limit=500",
    `/api/v1/work-plans/${plan.id}`,
    "/api/v1/work-plan-series",
    "/api/v1/monthly-goals",
    "/api/v1/monthly-goal-series",
    "/api/v1/custom-fields",
    "/api/v1/owner-account-mappings",
    "/api/v1/export-templates",
    "/api/v1/reminders?from=2026-01-01&to=2026-12-31",
  ];
  for (const path of queryPaths) {
    const bySession = await api(path, { cookie: viewer.cookie });
    const byToken = await api(path, { bearer: viewerToken });
    check(`Viewer 查询 ${path}`, bySession.status === 200 && byToken.status === 200, `session=${bySession.status} token=${byToken.status}`);
  }

  const backupExport = await api("/api/v1/export", { cookie: viewer.cookie });
  const backupExportToken = await api("/api/v1/export", { bearer: viewerToken });
  check("Viewer 无权下载 JSON 备份", backupExport.status === 403 && backupExportToken.status === 403, `session=${backupExport.status} token=${backupExportToken.status}`);

  const searchSession = await api("/api/v1/work-plans/search", { method: "POST", cookie: viewer.cookie, csrf: viewer.csrf, body: { q: "验收", filters: [], sort: [], limit: 50, offset: 0 } });
  const searchTokenBody = await (await api("/api/v1/work-plans/search", { method: "POST", body: { q: "验收" }, bearer: viewerToken })).json();
  check("Viewer 高级搜索（POST 查询）", searchSession.status === 200 && Array.isArray(searchTokenBody) && searchTokenBody.some((item) => item.id === plan.id));

  const xlsCustom = await api("/api/v1/work-plans/export.xls", { method: "POST", cookie: viewer.cookie, csrf: viewer.csrf, body: { columns: [{ source: "title", header: "工作内容" }] } });
  check("Viewer 自定义 XLS 导出", xlsCustom.status === 200 && (xlsCustom.headers.get("content-type") ?? "").includes("application/vnd.ms-excel"));
  const xlsTemplate = await api(`/api/v1/work-plans/export.xls?templateId=${template.id}`, { bearer: viewerToken });
  check("Viewer 模板 XLS 导出", xlsTemplate.status === 200 && (xlsTemplate.headers.get("content-type") ?? "").includes("application/vnd.ms-excel"));

  // 6. Viewer 越权写入 → 403 且零副作用
  const beforeList = await (await api("/api/v1/work-plans?limit=500", { cookie: admin.cookie })).json();
  const writeAttempts = [
    { label: "新建工作计划", request: () => api("/api/v1/work-plans", { method: "POST", cookie: viewer.cookie, csrf: viewer.csrf, body: { title: "越权", description: "", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 1000).toISOString(), customFields: {} } }) },
    { label: "修改工作计划", request: () => api(`/api/v1/work-plans/${plan.id}`, { method: "PATCH", cookie: viewer.cookie, csrf: viewer.csrf, body: { title: "越权改", version: plan.version } }) },
    { label: "删除工作计划", request: () => api(`/api/v1/work-plans/${plan.id}?version=${plan.version}`, { method: "DELETE", cookie: viewer.cookie, csrf: viewer.csrf }) },
    { label: "新建月目标", request: () => api("/api/v1/monthly-goals", { method: "POST", cookie: viewer.cookie, csrf: viewer.csrf, body: { title: "越权目标", year: 2026, month: 12, workPlanId: null } }) },
    { label: "新建重复规则", request: () => api("/api/v1/work-plan-series", { method: "POST", cookie: viewer.cookie, csrf: viewer.csrf, body: { workPlan: { title: "越权系列", description: "", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 1000).toISOString(), customFields: {} }, recurrence: { frequency: "daily", interval: 1, count: 1, timeZone: "Asia/Shanghai" } } }) },
    { label: "用户列表", request: () => api("/api/v1/users", { cookie: viewer.cookie }) },
    { label: "新建自定义字段", request: () => api("/api/v1/custom-fields", { method: "POST", cookie: viewer.cookie, csrf: viewer.csrf, body: { key: "blocked", label: "越权", description: "", type: "short_text", required: false, defaultValue: null, options: [] } }) },
    { label: "导入业务数据", request: () => api("/api/v1/import", { method: "POST", cookie: viewer.cookie, csrf: viewer.csrf, body: {} }) },
  ];
  for (const attempt of writeAttempts) {
    const response = await attempt.request();
    const body = await response.json().catch(() => ({}));
    check(`Viewer ${attempt.label} 被拒`, response.status === 403 && body.code === "INSUFFICIENT_PERMISSION", `status=${response.status} code=${body.code}`);
  }
  const afterList = await (await api("/api/v1/work-plans?limit=500", { cookie: admin.cookie })).json();
  check("越权请求后数据零变化", JSON.stringify(afterList) === JSON.stringify(beforeList));

  // 7. Web 构建产物包含只读工作台（静态资源可访问）
  const webHome = await fetch(`${base}/work-plans`);
  const webHtml = await webHome.text();
  check("Web 静态资源可访问", webHome.status === 200 && webHtml.includes("<div id=\"root\">"));

  // 8. 停用 Viewer 后凭据失效；重新启用不恢复
  const users = await (await api("/api/v1/users", { cookie: admin.cookie })).json();
  const tokenViewerRow = users.find((user) => user.username === "viewer-api");
  const disableResponse = await api(`/api/v1/users/${tokenViewerRow.id}`, { method: "PATCH", cookie: admin.cookie, csrf: admin.csrf, body: { disabled: true, version: tokenViewerRow.version } });
  check("管理员停用 Token-only Viewer", disableResponse.status === 200);
  check("停用后 Token 失效", (await api("/api/v1/auth/me", { bearer: viewerToken })).status === 401);

  const passwordViewerRow = users.find((user) => user.username === "viewer-web");
  await api(`/api/v1/users/${passwordViewerRow.id}`, { method: "PATCH", cookie: admin.cookie, csrf: admin.csrf, body: { disabled: true, version: passwordViewerRow.version } });
  check("停用后会话失效", (await api("/api/v1/work-plans", { cookie: viewer.cookie })).status === 401);

  const reenabledTokenViewer = await api(`/api/v1/users/${tokenViewerRow.id}`, { method: "PATCH", cookie: admin.cookie, csrf: admin.csrf, body: { disabled: false, version: tokenViewerRow.version + 1 } });
  check("重新启用后旧 Token 不恢复", reenabledTokenViewer.status === 200 && (await api("/api/v1/auth/me", { bearer: viewerToken })).status === 401);

  const reenabledPasswordViewer = await api(`/api/v1/users/${passwordViewerRow.id}`, { method: "PATCH", cookie: admin.cookie, csrf: admin.csrf, body: { disabled: false, version: passwordViewerRow.version + 1 } });
  check("重新启用密码 Viewer", reenabledPasswordViewer.status === 200);

  const newPasswordResponse = await api(`/api/v1/users/${passwordViewerRow.id}/password`, { method: "PUT", cookie: admin.cookie, csrf: admin.csrf, body: { password: "renewed-viewer-password", version: passwordViewerRow.version + 2 } });
  check("管理员为 Viewer 重设密码", newPasswordResponse.status === 200);
  const reLogin = await api("/api/v1/auth/login", { method: "POST", body: { username: "viewer-web", password: "renewed-viewer-password" } });
  check("重设密码后 Viewer 可重新登录", reLogin.status === 200 && (await reLogin.json()).user.role === "viewer");

  console.log(failures === 0 ? "\n全部验收项通过" : `\n存在 ${failures} 个未通过项`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (error) {
  console.error("验收脚本异常：", error);
  console.error(serverOutput.join("").slice(-4000));
  process.exitCode = 1;
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!server.killed) server.kill("SIGKILL");
}
