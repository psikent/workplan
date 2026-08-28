import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { normalizeProductionEnv, parseEnv, resolveRuntimeDataDir, serializeEnv } from "./runtime-core.mjs";
import { manualManagerAllowed, systemdManagedUnitPath } from "./workplan.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const managerPath = path.join(scriptsDir, "workplan.mjs");

function runManager(root, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [managerPath, ...args], {
      env: { ...process.env, WORKPLAN_RUNTIME_ROOT: root },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

test("normalizes production configuration without replacing a valid secret", () => {
  const existing = parseEnv([
    "APP_BASE_URL=http://localhost:3000",
    "APP_SECRET=abcdefghijklmnopqrstuvwxyz-1234567890",
  ].join("\n"));
  const normalized = normalizeProductionEnv(existing, () => "generated-secret");
  assert.equal(normalized.get("APP_BASE_URL"), "http://localhost:3000");
  assert.equal(normalized.get("APP_SECRET"), "abcdefghijklmnopqrstuvwxyz-1234567890");
  assert.equal(parseEnv(serializeEnv(normalized)).get("DATA_DIR"), "./data");
});

test("manual manager stays available off-Linux and on non-systemd Linux hosts", () => {
  assert.equal(systemdManagedUnitPath("linux"), "/etc/systemd/system/workplan.service");
  assert.equal(manualManagerAllowed("darwin", "/etc/systemd/system/workplan.service"), true);
  assert.equal(manualManagerAllowed("win32", "/etc/systemd/system/workplan.service"), true);
  assert.equal(manualManagerAllowed("linux", "/nonexistent/workplan.service"), true);
});

test("manual manager is blocked when the systemd unit exists on Linux", () => {
  const unitPath = path.join(os.tmpdir(), `wp-unit-${process.pid}`);
  fs.writeFileSync(unitPath, "[Service]\n");
  try {
    assert.equal(manualManagerAllowed("linux", unitPath), false);
  } finally {
    fs.rmSync(unitPath, { force: true });
  }
});

test("resolves runtime data relative to the runtime root", () => {
  const root = path.resolve("C:/workplan-release");
  assert.equal(resolveRuntimeDataDir(root, "./data"), path.join(root, "data"));
});

test("starts, reports, logs, and stops a managed background process", async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "workplan-manager-"));
  context.after(async () => {
    await runManager(root, "stop");
    fs.rmSync(root, { recursive: true, force: true });
  });
  const port = await reservePort();
  const entry = path.join(root, "apps/server/dist/index.js");
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{\"type\":\"module\"}\n");
  fs.writeFileSync(entry, [
    'import http from "node:http";',
    'const server=http.createServer((req,res)=>{',
    'if(req.url==="/health/ready"){res.writeHead(200,{"content-type":"application/json"});res.end("{\\"status\\":\\"ready\\"}");return;}',
    'res.writeHead(404);res.end();});',
    'server.listen(Number(process.env.PORT),"127.0.0.1",()=>console.log("fake ready"));',
    'process.once("SIGTERM",()=>server.close());',
  ].join("\n"));
  fs.writeFileSync(path.join(root, ".env"), [
    "NODE_ENV=production",
    "HOST=127.0.0.1",
    `PORT=${port}`,
    "DATA_DIR=./data",
    "APP_SECRET=test-manager-secret-with-at-least-32-characters",
    `APP_BASE_URL=http://localhost:${port}`,
  ].join("\n"));

  const started = await runManager(root, "start");
  assert.equal(started.code, 0, started.stderr);
  assert.match(started.stdout, /Workplan 已启动/);
  const status = await runManager(root, "status");
  assert.equal(status.code, 0, status.stderr);
  assert.match(status.stdout, /运行正常/);
  const logs = await runManager(root, "logs", "20");
  assert.match(logs.stdout, /fake ready/);
  const stopped = await runManager(root, "stop");
  assert.equal(stopped.code, 0, stopped.stderr);
  assert.match(stopped.stdout, /已停止/);
});
