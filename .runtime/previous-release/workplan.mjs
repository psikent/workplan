import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isProcessAlive,
  normalizeProductionEnv,
  parseEnv,
  readTail,
  resolveRuntimeDataDir,
  serializeEnv,
} from "./runtime-core.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const detectedRoot = fs.existsSync(path.join(scriptDir, "apps")) ? scriptDir : path.resolve(scriptDir, "..");
const runtimeRoot = path.resolve(process.env.WORKPLAN_RUNTIME_ROOT || detectedRoot);
const envPath = path.join(runtimeRoot, ".env");
const runtimeDir = path.join(runtimeRoot, ".runtime");
const logsDir = path.join(runtimeRoot, "logs");
const pidPath = path.join(runtimeDir, "workplan.pid.json");
const stdoutPath = path.join(logsDir, "workplan.log");
const stderrPath = path.join(logsDir, "workplan.err.log");
const entryPath = path.join(runtimeRoot, "apps/server/dist/index.js");

function randomSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

export function setup() {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const existingText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const entries = normalizeProductionEnv(parseEnv(existingText), randomSecret);
  fs.writeFileSync(envPath, serializeEnv(entries), { encoding: "utf8", mode: 0o600 });
  fs.mkdirSync(resolveRuntimeDataDir(runtimeRoot, entries.get("DATA_DIR")), { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  console.log(`正式环境配置已就绪：${envPath}`);
  return entries;
}

function readPidRecord() {
  if (!fs.existsSync(pidPath)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(pidPath, "utf8"));
    return Number.isInteger(record.pid) ? record : null;
  } catch {
    return null;
  }
}

function clearStalePid() {
  const record = readPidRecord();
  if (record && isProcessAlive(record.pid)) return record;
  if (fs.existsSync(pidPath)) fs.rmSync(pidPath, { force: true });
  return null;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForReady(port, pid, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) throw new Error(`服务进程 ${pid} 已退出，请检查 ${stderrPath}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`服务未在 ${timeoutMs / 1000} 秒内就绪，请检查 ${stderrPath}`);
}

export async function start() {
  const running = clearStalePid();
  if (running) {
    console.log(`服务已在运行，PID ${running.pid}`);
    return running;
  }
  if (!fs.existsSync(entryPath)) throw new Error(`缺少正式构建产物：${entryPath}`);

  const entries = setup();
  const port = Number(entries.get("PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("PORT 必须是有效端口");
  if (await canConnect(port)) throw new Error(`端口 ${port} 已被其他进程占用，未启动 Workplan`);

  const childEnv = { ...process.env, ...Object.fromEntries(entries) };
  childEnv.DATA_DIR = resolveRuntimeDataDir(runtimeRoot, entries.get("DATA_DIR"));
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  const stdout = fs.openSync(stdoutPath, "a");
  const stderr = fs.openSync(stderrPath, "a");
  const child = spawn(process.execPath, [entryPath], {
    cwd: runtimeRoot,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr],
    env: childEnv,
  });
  child.unref();
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  const record = { pid: child.pid, startedAt: new Date().toISOString(), entryPath, port };
  fs.writeFileSync(pidPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  try {
    await waitForReady(port, child.pid);
  } catch (error) {
    try { process.kill(child.pid, "SIGTERM"); } catch {}
    fs.rmSync(pidPath, { force: true });
    throw error;
  }
  console.log(`Workplan 已启动：http://localhost:${port}（PID ${child.pid}）`);
  return record;
}

export async function stop() {
  const record = clearStalePid();
  if (!record) {
    console.log("Workplan 未运行");
    return;
  }
  try {
    process.kill(record.pid, "SIGTERM");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && isProcessAlive(record.pid)) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (isProcessAlive(record.pid)) {
    try { process.kill(record.pid, "SIGKILL"); } catch {}
  }
  fs.rmSync(pidPath, { force: true });
  console.log(`Workplan 已停止（PID ${record.pid}）`);
}

export async function status() {
  const record = clearStalePid();
  if (!record) {
    console.log("Workplan 未运行");
    return false;
  }
  let ready = false;
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/health/ready`, { signal: AbortSignal.timeout(1_000) });
    ready = response.ok;
  } catch {}
  console.log(`Workplan ${ready ? "运行正常" : "进程存在但尚未就绪"}（PID ${record.pid}，端口 ${record.port}）`);
  return ready;
}

export function logs() {
  const requested = Number(process.argv[3] ?? 100);
  const lines = Number.isInteger(requested) && requested > 0 ? requested : 100;
  console.log(`== ${stdoutPath} ==`);
  console.log(readTail(stdoutPath, lines) || "（暂无标准输出）");
  console.log(`\n== ${stderrPath} ==`);
  console.log(readTail(stderrPath, lines) || "（暂无错误输出）");
}

async function main() {
  const command = process.argv[2] ?? "status";
  if (command === "setup") setup();
  else if (command === "start") await start();
  else if (command === "stop") await stop();
  else if (command === "restart") { await stop(); await start(); }
  else if (command === "status") process.exitCode = await status() ? 0 : 1;
  else if (command === "logs") logs();
  else throw new Error("用法：node workplan.mjs setup|start|stop|restart|status|logs [行数]");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
