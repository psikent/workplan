import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTargetRoot = path.resolve(sourceRoot, "../workplan-release");
const targetArgIndex = process.argv.indexOf("--target");
const targetRoot = path.resolve(
  targetArgIndex >= 0 && process.argv[targetArgIndex + 1]
    ? process.argv[targetArgIndex + 1]
    : defaultTargetRoot,
);
const noStart = process.argv.includes("--no-start");
const managesProductionService = targetRoot === defaultTargetRoot;
const productionPort = 3000;
const launchdLabel = "com.psikent.workplan";
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "");
const stagingRoot = `${targetRoot}.stage-${process.pid}-${stamp}`;
const rollbackRoot = path.join(targetRoot, ".runtime", "previous-release");
const managedNames = [
  "apps",
  "packages",
  "node_modules",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "workplan.mjs",
  "runtime-core.mjs",
  ".env.example",
  "README.md",
];
const legacyNames = ["serve.mjs", "workplan.pid"];

function assertSafeTarget() {
  const sourceParent = path.dirname(sourceRoot);
  if (targetRoot === sourceRoot || targetRoot === path.parse(targetRoot).root || path.dirname(targetRoot) !== sourceParent) {
    throw new Error(`发布目录必须是源码同级的独立目录，当前为：${targetRoot}`);
  }
  if (!managesProductionService && !noStart) {
    throw new Error("自定义发布目录必须同时使用 --no-start，避免误占正式端口");
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? sourceRoot,
    stdio: "inherit",
    windowsHide: true,
    shell: options.shell ?? false,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} 执行失败，退出码 ${result.status}`);
  }
  return result.status ?? 1;
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? sourceRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: options.shell ?? false,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function corepackCommand(platform = process.platform) {
  return platform === "win32" ? "corepack.cmd" : "corepack";
}

function runCorepack(args, options = {}) {
  return run(corepackCommand(), args, {
    ...options,
    shell: process.platform === "win32",
  });
}

export function parseLsofListeners(output) {
  const listeners = [];
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      if (current) listeners.push(current);
      current = { pid: Number(line.slice(1)), command: "" };
    } else if (line.startsWith("c") && current) {
      current.command = line.slice(1);
    }
  }
  if (current) listeners.push(current);
  const byPid = new Map();
  for (const listener of listeners) {
    if (Number.isInteger(listener.pid) && listener.pid > 0) byPid.set(listener.pid, listener);
  }
  return [...byPid.values()];
}

function listPortListeners(port) {
  if (process.platform === "win32") {
    throw new Error("正式环境端口冲突检测目前只支持 macOS/Linux 的 lsof");
  }
  const result = capture("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`无法检测端口 ${port} 的监听进程：${result.stderr.trim() || `lsof 退出码 ${result.status}`}`);
  }
  return parseLsofListeners(result.stdout);
}

function processPath(pid, descriptor) {
  const result = capture("lsof", ["-nP", "-a", "-p", String(pid), "-d", descriptor, "-Fn"]);
  if (result.status !== 0) return null;
  const pathLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith("n"));
  return pathLine ? pathLine.slice(1) : null;
}

function normalizedRealPath(value) {
  if (!value) return null;
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

export function listenerMatchesRelease(listener, expected = {}) {
  const expectedTarget = normalizedRealPath(expected.targetRoot ?? targetRoot);
  const expectedExecutable = normalizedRealPath(expected.nodeExecutable ?? process.execPath);
  return listener.command === path.basename(expectedExecutable)
    && normalizedRealPath(listener.cwd) === expectedTarget
    && normalizedRealPath(listener.executable) === expectedExecutable;
}

function inspectPortListeners(port) {
  return listPortListeners(port).map((listener) => ({
    ...listener,
    cwd: processPath(listener.pid, "cwd"),
    executable: processPath(listener.pid, "txt"),
  }));
}

function assertFormalListeners(listeners) {
  const unexpected = listeners.filter((listener) => !listenerMatchesRelease(listener));
  if (unexpected.length === 0) return;
  const details = unexpected.map((listener) => (
    `PID ${listener.pid}（${listener.command || "进程未知"}，${listener.cwd ?? "工作目录未知"}，${listener.executable ?? "可执行文件未知"}）`
  )).join("、");
  throw new Error(`端口 ${productionPort} 已被非正式 WorkPlan 进程占用：${details}，已中止发布`);
}

export function parseLaunchctlPid(output) {
  const match = output.match(/^\s*pid = (\d+)\s*$/m);
  return match ? Number(match[1]) : null;
}

export function launchdServiceTarget(uid, label = launchdLabel) {
  return `gui/${uid}/${label}`;
}

export function launchdControlCommands(supervisor) {
  return {
    stop: ["launchctl", ["bootout", supervisor.serviceTarget]],
    start: ["launchctl", ["bootstrap", supervisor.domain, supervisor.plistPath]],
  };
}

function launchdState(supervisor) {
  const result = capture("launchctl", ["print", supervisor.serviceTarget]);
  return {
    loaded: result.status === 0,
    pid: result.status === 0 ? parseLaunchctlPid(result.stdout) : null,
  };
}

function detectLaunchdSupervisor() {
  if (process.platform !== "darwin" || typeof process.getuid !== "function") return null;
  const plistPath = path.join(os.homedir(), "Library", "LaunchAgents", `${launchdLabel}.plist`);
  if (!fs.existsSync(plistPath)) return null;

  const workingDirectory = capture("/usr/libexec/PlistBuddy", ["-c", "Print :WorkingDirectory", plistPath]);
  if (workingDirectory.status !== 0) {
    throw new Error(`无法读取 ${launchdLabel} 的 WorkingDirectory，已中止发布`);
  }
  if (normalizedRealPath(workingDirectory.stdout.trim()) !== normalizedRealPath(targetRoot)) return null;

  const uid = process.getuid();
  const supervisor = {
    domain: `gui/${uid}`,
    label: launchdLabel,
    plistPath,
    serviceTarget: launchdServiceTarget(uid),
  };
  return { ...supervisor, ...launchdState(supervisor) };
}

function assertSupervisorOwnership(supervisor, listeners) {
  assertFormalListeners(listeners);
  if (!supervisor?.loaded || listeners.length === 0) return;
  if (!supervisor.pid || listeners.length !== 1 || listeners[0].pid !== supervisor.pid) {
    const listenerPids = listeners.map(({ pid }) => pid).join("、") || "无";
    throw new Error(`${launchdLabel} 的 PID ${supervisor.pid ?? "未知"} 与端口 ${productionPort} 监听 PID ${listenerPids} 不一致，已中止发布`);
  }
}

function sleepSync(milliseconds) {
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function waitForPortFree(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (listPortListeners(port).length === 0) return;
    sleepSync(200);
  }
  throw new Error(`端口 ${port} 未能释放`);
}

function readManagedPid() {
  const pidPath = path.join(targetRoot, ".runtime", "workplan.pid.json");
  try {
    const record = JSON.parse(fs.readFileSync(pidPath, "utf8"));
    return Number.isInteger(record.pid) && record.pid > 0 ? record.pid : null;
  } catch {
    return null;
  }
}

function waitForLaunchdReady(supervisor, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = "服务尚未启动";
  while (Date.now() < deadline) {
    const state = launchdState(supervisor);
    const listeners = inspectPortListeners(productionPort);
    assertFormalListeners(listeners);
    const listenerPid = listeners.length === 1 ? listeners[0].pid : null;
    const managedPid = readManagedPid();
    if (state.loaded && state.pid && state.pid === listenerPid && state.pid === managedPid) {
      const manager = path.join(targetRoot, "workplan.mjs");
      const status = capture(process.execPath, [manager, "status"], { cwd: targetRoot });
      if (status.status === 0) return state.pid;
      lastState = status.stderr.trim() || status.stdout.trim() || "健康检查尚未通过";
    } else {
      lastState = `launchd=${state.pid ?? "无"}，listener=${listenerPid ?? "无"}，pid-file=${managedPid ?? "无"}`;
    }
    sleepSync(200);
  }
  throw new Error(`${launchdLabel} 未能就绪：${lastState}`);
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function prepareStaging() {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".env.example", "README.md"]) {
    copy(path.join(sourceRoot, file), path.join(stagingRoot, file));
  }
  copy(path.join(sourceRoot, "apps/server/package.json"), path.join(stagingRoot, "apps/server/package.json"));
  copy(path.join(sourceRoot, "apps/server/dist"), path.join(stagingRoot, "apps/server/dist"));
  copy(path.join(sourceRoot, "apps/web/dist"), path.join(stagingRoot, "apps/web/dist"));
  copy(path.join(sourceRoot, "packages/contracts/package.json"), path.join(stagingRoot, "packages/contracts/package.json"));
  copy(path.join(sourceRoot, "packages/contracts/dist"), path.join(stagingRoot, "packages/contracts/dist"));
  copy(path.join(sourceRoot, "scripts/workplan.mjs"), path.join(stagingRoot, "workplan.mjs"));
  copy(path.join(sourceRoot, "scripts/runtime-core.mjs"), path.join(stagingRoot, "runtime-core.mjs"));

  const packagePath = path.join(stagingRoot, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  packageJson.scripts = {
    start: "node workplan.mjs start",
    stop: "node workplan.mjs stop",
    restart: "node workplan.mjs restart",
    status: "node workplan.mjs status",
    logs: "node workplan.mjs logs",
  };
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

function stopManualRelease(listeners) {
  if (listeners.length === 0) return;
  const manager = path.join(targetRoot, "workplan.mjs");
  if (!fs.existsSync(manager)) {
    throw new Error(`端口 ${productionPort} 由正式目录进程占用，但缺少正式环境管理器：${manager}`);
  }
  run(process.execPath, [manager, "stop"], { cwd: targetRoot, allowFailure: true });

  const remaining = inspectPortListeners(productionPort);
  assertFormalListeners(remaining);
  for (const listener of remaining) {
    try {
      process.kill(listener.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  waitForPortFree(productionPort);
  fs.rmSync(path.join(targetRoot, ".runtime", "workplan.pid.json"), { force: true });
}

function stopExistingRelease(supervisor, listeners) {
  if (supervisor?.loaded) {
    const commands = launchdControlCommands(supervisor);
    run(commands.stop[0], commands.stop[1]);
    waitForPortFree(productionPort);
    return;
  }
  stopManualRelease(listeners);
}

function startLaunchdRelease(supervisor) {
  const current = launchdState(supervisor);
  if (!current.loaded) {
    const commands = launchdControlCommands(supervisor);
    run(commands.start[0], commands.start[1]);
  }
  const pid = waitForLaunchdReady(supervisor);
  console.log(`Workplan 已由 ${launchdLabel} 启动（PID ${pid}，端口 ${productionPort}）`);
}

function startManualRelease() {
  const listeners = inspectPortListeners(productionPort);
  assertFormalListeners(listeners);
  if (listeners.length > 0) return;
  const manager = path.join(targetRoot, "workplan.mjs");
  run(process.execPath, [manager, "start"], { cwd: targetRoot });
}

function startRelease(supervisor) {
  if (supervisor) startLaunchdRelease(supervisor);
  else startManualRelease();
}

function promoteStaging() {
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.mkdirSync(path.dirname(rollbackRoot), { recursive: true });
  fs.rmSync(rollbackRoot, { recursive: true, force: true });
  fs.mkdirSync(rollbackRoot, { recursive: true });

  for (const name of [...managedNames, ...legacyNames]) {
    const current = path.join(targetRoot, name);
    if (!fs.existsSync(current)) continue;
    const backup = path.join(rollbackRoot, name);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.renameSync(current, backup);
  }
  for (const name of managedNames) {
    const staged = path.join(stagingRoot, name);
    if (!fs.existsSync(staged)) continue;
    fs.renameSync(staged, path.join(targetRoot, name));
  }
}

function restorePreviousRelease() {
  for (const name of managedNames) fs.rmSync(path.join(targetRoot, name), { recursive: true, force: true });
  if (!fs.existsSync(rollbackRoot)) return;
  for (const name of fs.readdirSync(rollbackRoot)) {
    fs.renameSync(path.join(rollbackRoot, name), path.join(targetRoot, name));
  }
}

function stopCurrentReleaseForRollback(supervisor) {
  const currentSupervisor = supervisor ? { ...supervisor, ...launchdState(supervisor) } : null;
  const listeners = inspectPortListeners(productionPort);
  assertSupervisorOwnership(currentSupervisor, listeners);
  stopExistingRelease(currentSupervisor, listeners);
}

function main() {
  assertSafeTarget();
  const supervisor = managesProductionService ? detectLaunchdSupervisor() : null;
  const productionListeners = managesProductionService ? inspectPortListeners(productionPort) : [];
  assertSupervisorOwnership(supervisor, productionListeners);
  if (supervisor) {
    console.log(`检测到正式环境由 ${launchdLabel} 监管，发布期间将暂停并在完成后恢复。`);
  } else if (productionListeners.length > 0) {
    console.log(`检测到正式环境 Workplan 正在占用端口 ${productionPort}，发布后将重启（${productionListeners.map(({ pid }) => `PID ${pid}`).join("、")}）。`);
  }

  console.log(`构建源码：${sourceRoot}`);
  runCorepack(["pnpm", "build"]);
  prepareStaging();

  let stopAttempted = false;
  let promotionStarted = false;
  try {
    stopAttempted = true;
    stopExistingRelease(supervisor, productionListeners);
    promotionStarted = true;
    promoteStaging();

    // pnpm creates Windows junctions with absolute targets. Install only after
    // promotion so those links point at the final release directory.
    console.log(`安装正式依赖：${targetRoot}`);
    runCorepack(["pnpm", "install", "--prod", "--frozen-lockfile"], { cwd: targetRoot });
    run(process.execPath, [path.join(targetRoot, "workplan.mjs"), "setup"], { cwd: targetRoot });
    if (!noStart) startRelease(supervisor);
  } catch (error) {
    if (promotionStarted) {
      console.error("新版本启动失败，正在恢复上一版本。");
      try {
        stopCurrentReleaseForRollback(supervisor);
      } catch (stopError) {
        console.error(`停止失败版本时出错：${stopError instanceof Error ? stopError.message : stopError}`);
      }
      restorePreviousRelease();
    }
    if (stopAttempted && !noStart) {
      try {
        startRelease(supervisor);
      } catch (startError) {
        console.error(`恢复上一版本的启动失败：${startError instanceof Error ? startError.message : startError}`);
      }
    }
    throw error;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  console.log(`发布完成：${targetRoot}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
