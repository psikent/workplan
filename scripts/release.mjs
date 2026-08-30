import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeSystemdEnv,
  parseEnv,
  serializeEnv,
} from "./runtime-core.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultTargetRoot = path.resolve(sourceRoot, "../workplan-release");
const launchdLabel = "com.psikent.workplan";
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "");

// ---------------------------------------------------------------------------
// Fixed systemd topology (see docs/adr/0004-systemd-production-service.md).
// None of these are overridable through the command line.
// ---------------------------------------------------------------------------
export const systemdUnitName = "workplan";
export const systemdUnitPath = "/etc/systemd/system/workplan.service";
export const systemdServiceUser = "workplan";
export const systemdServiceGroup = "workplan";
export const systemdHost = "127.0.0.1";
export const systemdPort = 3000;
export const defaultSystemdNodeExecutable = "/usr/bin/node";

const productionPort = systemdPort;

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
const systemdBackupDirName = "systemd";

// ---------------------------------------------------------------------------
// Argument parsing and release target guards
// ---------------------------------------------------------------------------

export function parseReleaseArgs(argv) {
  const targetArgIndex = argv.indexOf("--target");
  const targetRoot = path.resolve(
    targetArgIndex >= 0 && argv[targetArgIndex + 1]
      ? argv[targetArgIndex + 1]
      : defaultTargetRoot,
  );
  return {
    targetRoot,
    noStart: argv.includes("--no-start"),
    installSystemd: argv.includes("--install-systemd"),
    managesProductionService: targetRoot === defaultTargetRoot,
  };
}

export function assertSafeTarget(args) {
  const sourceParent = path.dirname(sourceRoot);
  if (args.targetRoot === sourceRoot || args.targetRoot === path.parse(args.targetRoot).root || path.dirname(args.targetRoot) !== sourceParent) {
    throw new Error(`发布目录必须是源码同级的独立目录，当前为：${args.targetRoot}`);
  }
  if (!args.managesProductionService && !args.noStart) {
    throw new Error("自定义发布目录必须同时使用 --no-start，避免误占正式端口");
  }
}

export function assertInstallSystemdPreconditions({ installSystemd, managesProductionService, noStart, platform, isRoot }) {
  if (!installSystemd) return [];
  const errors = [];
  if (platform !== "linux") errors.push("--install-systemd 仅在 Linux 上受支持");
  if (!managesProductionService) errors.push("--install-systemd 只能用于默认正式发布目录");
  if (noStart) errors.push("--install-systemd 不能与 --no-start 同时使用");
  if (!isRoot) errors.push("--install-systemd 必须以 root 身份运行（sudo）");
  return errors;
}

// ---------------------------------------------------------------------------
// Command execution helpers (legacy launchd/manual path)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pure listeners / process parsers
// ---------------------------------------------------------------------------

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

export function parseLsofListenerDetails(output) {
  const entries = [];
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("p")) {
      if (current) entries.push(current);
      current = { pid: Number(line.slice(1)), command: "", addresses: [] };
    } else if (line.startsWith("c") && current) {
      current.command = line.slice(1);
    } else if (line.startsWith("n") && current) {
      current.addresses.push(line.slice(1));
    }
  }
  if (current) entries.push(current);
  return entries.filter((entry) => Number.isInteger(entry.pid) && entry.pid > 0);
}

export function groupListenersByPid(blocks) {
  const byPid = new Map();
  for (const block of blocks) {
    const existing = byPid.get(block.pid);
    if (!existing) {
      byPid.set(block.pid, { ...block, addresses: [...block.addresses] });
    } else {
      existing.addresses.push(...block.addresses);
      if (!existing.command) existing.command = block.command;
      if (!existing.executable) existing.executable = block.executable;
      if (!existing.cwd) existing.cwd = block.cwd;
    }
  }
  return [...byPid.values()];
}

export function parseLsofPath(output) {
  const pathLine = output.split(/\r?\n/).find((line) => line.startsWith("n"));
  return pathLine ? pathLine.slice(1) : null;
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
  return parseLsofPath(result.stdout);
}

export function normalizedRealPath(value) {
  if (!value) return null;
  try {
    return fs.realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

function normalizedPath(value) {
  if (!value) return null;
  return path.normalize(String(value)).replace(/\/+$/, "") || "/";
}

export function listenerMatchesRelease(listener, expected = {}) {
  const expectedTarget = normalizedRealPath(expected.targetRoot ?? defaultTargetRoot);
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

function assertFormalListeners(listeners, expected) {
  const unexpected = listeners.filter((listener) => !listenerMatchesRelease(listener, expected));
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

function detectLaunchdSupervisor(targetRoot) {
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
    kind: "launchd",
    domain: `gui/${uid}`,
    label: launchdLabel,
    plistPath,
    serviceTarget: launchdServiceTarget(uid),
  };
  return { ...supervisor, ...launchdState(supervisor) };
}

function assertSupervisorOwnership(supervisor, listeners, expected) {
  assertFormalListeners(listeners, expected);
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

function readManagedPid(targetRoot) {
  const pidPath = path.join(targetRoot, ".runtime", "workplan.pid.json");
  try {
    const record = JSON.parse(fs.readFileSync(pidPath, "utf8"));
    return Number.isInteger(record.pid) && record.pid > 0 ? record.pid : null;
  } catch {
    return null;
  }
}

function waitForLaunchdReady(supervisor, targetRoot, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = "服务尚未启动";
  while (Date.now() < deadline) {
    const state = launchdState(supervisor);
    const listeners = inspectPortListeners(productionPort);
    assertFormalListeners(listeners, { targetRoot, nodeExecutable: process.execPath });
    const listenerPid = listeners.length === 1 ? listeners[0].pid : null;
    const managedPid = readManagedPid(targetRoot);
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

// ---------------------------------------------------------------------------
// Staging, promotion and rollback (shared file operations)
// ---------------------------------------------------------------------------

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

export function prepareStaging(workspaceRoot, stagingRoot) {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".env.example", "README.md"]) {
    copy(path.join(workspaceRoot, file), path.join(stagingRoot, file));
  }
  copy(path.join(workspaceRoot, "apps/server/package.json"), path.join(stagingRoot, "apps/server/package.json"));
  copy(path.join(workspaceRoot, "apps/server/dist"), path.join(stagingRoot, "apps/server/dist"));
  copy(path.join(workspaceRoot, "apps/web/dist"), path.join(stagingRoot, "apps/web/dist"));
  copy(path.join(workspaceRoot, "packages/contracts/package.json"), path.join(stagingRoot, "packages/contracts/package.json"));
  copy(path.join(workspaceRoot, "packages/contracts/dist"), path.join(stagingRoot, "packages/contracts/dist"));
  copy(path.join(workspaceRoot, "scripts/workplan.mjs"), path.join(stagingRoot, "workplan.mjs"));
  copy(path.join(workspaceRoot, "scripts/runtime-core.mjs"), path.join(stagingRoot, "runtime-core.mjs"));

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

export function previousReleaseRoot(targetRoot) {
  return `${targetRoot}.previous-release`;
}

export function promoteStaging(stagingRoot, targetRoot) {
  const previousRoot = previousReleaseRoot(targetRoot);
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.mkdirSync(path.dirname(previousRoot), { recursive: true });
  fs.rmSync(previousRoot, { recursive: true, force: true });
  fs.mkdirSync(previousRoot, { recursive: true });

  for (const name of [...managedNames, ...legacyNames]) {
    const current = path.join(targetRoot, name);
    if (!fs.existsSync(current)) continue;
    const backup = path.join(previousRoot, name);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.renameSync(current, backup);
  }
  for (const name of managedNames) {
    const staged = path.join(stagingRoot, name);
    if (!fs.existsSync(staged)) continue;
    fs.renameSync(staged, path.join(targetRoot, name));
  }
}

export function restorePreviousRelease(targetRoot) {
  const previousRoot = previousReleaseRoot(targetRoot);
  for (const name of managedNames) fs.rmSync(path.join(targetRoot, name), { recursive: true, force: true });
  if (!fs.existsSync(previousRoot)) return;
  const entries = fs.readdirSync(previousRoot).filter((name) => name !== systemdBackupDirName);
  for (const name of entries) {
    fs.renameSync(path.join(previousRoot, name), path.join(targetRoot, name));
  }
}

function stopManualRelease(targetRoot, listeners, expected) {
  if (listeners.length === 0) return;
  const manager = path.join(targetRoot, "workplan.mjs");
  if (!fs.existsSync(manager)) {
    throw new Error(`端口 ${productionPort} 由正式目录进程占用，但缺少正式环境管理器：${manager}`);
  }
  run(process.execPath, [manager, "stop"], { cwd: targetRoot, allowFailure: true });

  const remaining = inspectPortListeners(productionPort);
  assertFormalListeners(remaining, expected);
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

function stopExistingRelease(supervisor, listeners, targetRoot, expected) {
  if (supervisor?.loaded) {
    const commands = launchdControlCommands(supervisor);
    run(commands.stop[0], commands.stop[1]);
    waitForPortFree(productionPort);
    return;
  }
  stopManualRelease(targetRoot, listeners, expected);
}

function startLaunchdRelease(supervisor, targetRoot) {
  const current = launchdState(supervisor);
  if (!current.loaded) {
    const commands = launchdControlCommands(supervisor);
    run(commands.start[0], commands.start[1]);
  }
  const pid = waitForLaunchdReady(supervisor, targetRoot);
  console.log(`Workplan 已由 ${launchdLabel} 启动（PID ${pid}，端口 ${productionPort}）`);
}

function startManualRelease(targetRoot) {
  const listeners = inspectPortListeners(productionPort);
  assertFormalListeners(listeners, { targetRoot, nodeExecutable: process.execPath });
  if (listeners.length > 0) return;
  const manager = path.join(targetRoot, "workplan.mjs");
  run(process.execPath, [manager, "start"], { cwd: targetRoot });
}

function startRelease(supervisor, targetRoot) {
  if (supervisor) startLaunchdRelease(supervisor, targetRoot);
  else startManualRelease(targetRoot);
}

function stopCurrentReleaseForRollback(supervisor, targetRoot, expected) {
  const currentSupervisor = supervisor ? { ...supervisor, ...launchdState(supervisor) } : null;
  const listeners = inspectPortListeners(productionPort);
  assertSupervisorOwnership(currentSupervisor, listeners, expected);
  stopExistingRelease(currentSupervisor, listeners, targetRoot, expected);
}

function detectSupervisor(args) {
  if (process.platform === "linux" && args.managesProductionService) {
    return { kind: "systemd", name: systemdUnitName, unitPath: systemdUnitPath };
  }
  if (process.platform === "darwin" && args.managesProductionService) {
    return detectLaunchdSupervisor(args.targetRoot);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pure systemd helpers (unit rendering, parsing, validation, commands)
// ---------------------------------------------------------------------------

export function systemdUnitSpec(input = {}) {
  const root = path.resolve(input.targetRoot ?? input.workingDirectory ?? defaultTargetRoot);
  return {
    unitPath: input.unitPath ?? systemdUnitPath,
    name: systemdUnitName,
    user: systemdServiceUser,
    group: systemdServiceGroup,
    host: systemdHost,
    port: systemdPort,
    executable: path.resolve(input.nodeExecutable ?? input.executable ?? defaultSystemdNodeExecutable),
    workingDirectory: root,
    environmentFile: path.join(root, ".env"),
    entryPoint: path.join(root, "apps/server/dist/index.js"),
    logsDir: path.join(root, "logs"),
    stdoutLog: path.join(root, "logs", "workplan.log"),
    stderrLog: path.join(root, "logs", "workplan.err.log"),
    dataDir: path.join(root, "data"),
    runtimeDir: path.join(root, ".runtime"),
  };
}

export function renderSystemdUnit(spec) {
  const unit = systemdUnitSpec(spec);
  return [
    "[Unit]",
    "Description=WorkPlan production service",
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `User=${unit.user}`,
    `Group=${unit.group}`,
    `WorkingDirectory=${unit.workingDirectory}`,
    `EnvironmentFile=${unit.environmentFile}`,
    `ExecStart=${unit.executable} ${unit.entryPoint}`,
    `StandardOutput=append:${unit.stdoutLog}`,
    `StandardError=append:${unit.stderrLog}`,
    "Restart=on-failure",
    "RestartSec=2",
    "TimeoutStartSec=20",
    "TimeoutStopSec=20",
    "UMask=0077",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "ProtectSystem=strict",
    "ProtectHome=true",
    `ReadWritePaths=${unit.dataDir} ${unit.logsDir} ${unit.runtimeDir}`,
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

export function parseSystemdUnit(text) {
  const entries = new Map();
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const sectionMatch = trimmed.match(/^\[([A-Za-z0-9-]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const keyValue = trimmed.match(/^([A-Za-z0-9-]+)\s*=\s*(.*)$/);
    if (keyValue && section) entries.set(`${section}.${keyValue[1]}`, keyValue[2].trim());
  }
  return entries;
}

function tokenizeCommandLine(value) {
  return [...String(value ?? "").matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
}

function parseTimeValue(value) {
  const match = String(value ?? "").match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/i);
  if (!match) return NaN;
  const base = Number(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();
  if (unit.startsWith("min") || unit === "m") return base * 60;
  if (unit === "h") return base * 3600;
  return base;
}

function parseUmask(value) {
  const text = String(value ?? "").replace(/^0+/, "");
  if (!/^[0-7]+$/.test(text)) return null;
  try {
    return Number.parseInt(text, 8);
  } catch {
    return null;
  }
}

export function validateSystemdUnit(parsed, expected = {}) {
  const unit = systemdUnitSpec(expected);
  const errors = [];
  const value = (key) => parsed.get(key) ?? null;
  const pathEquals = (actual, wanted) => normalizedPath(actual) === normalizedPath(wanted);

  if (value("Service.Type") !== "simple") errors.push("Type 必须为 simple");
  if (value("Service.User") !== unit.user) errors.push(`User 必须为 ${unit.user}`);
  if (value("Service.Group") !== unit.group) errors.push(`Group 必须为 ${unit.group}`);
  if (!pathEquals(value("Service.WorkingDirectory"), unit.workingDirectory)) errors.push("WorkingDirectory 与正式发布目录不符");
  if (!pathEquals(value("Service.EnvironmentFile"), unit.environmentFile)) errors.push("EnvironmentFile 必须指向正式发布目录的 .env");

  const execTokens = tokenizeCommandLine(value("Service.ExecStart"));
  if (execTokens.length !== 2 || !pathEquals(execTokens[0], unit.executable) || !pathEquals(execTokens[1], unit.entryPoint)) {
    errors.push("ExecStart 必须直接以绝对路径启动 apps/server/dist/index.js，不得经过 workplan.mjs");
  }
  if (value("Service.StandardOutput") !== `append:${unit.stdoutLog}`) errors.push("StandardOutput 日志路径不符");
  if (value("Service.StandardError") !== `append:${unit.stderrLog}`) errors.push("StandardError 日志路径不符");
  if (value("Service.Restart") !== "on-failure") errors.push("Restart 必须为 on-failure");

  const restartSec = parseTimeValue(value("Service.RestartSec"));
  if (!Number.isFinite(restartSec) || restartSec < 1 || restartSec > 30) errors.push("RestartSec 必须在 1–30 秒之间");
  const timeoutStart = parseTimeValue(value("Service.TimeoutStartSec"));
  if (!Number.isFinite(timeoutStart) || timeoutStart < 1 || timeoutStart > 120) errors.push("TimeoutStartSec 必须在 1–120 秒之间");
  const timeoutStop = parseTimeValue(value("Service.TimeoutStopSec"));
  if (!Number.isFinite(timeoutStop) || timeoutStop < 1 || timeoutStop > 120) errors.push("TimeoutStopSec 必须在 1–120 秒之间");

  if (parseUmask(value("Service.UMask")) !== 0o77) errors.push("UMask 必须为 0077");

  const hardening = [
    ["Service.NoNewPrivileges", "NoNewPrivileges", "true"],
    ["Service.PrivateTmp", "PrivateTmp", "true"],
    ["Service.ProtectSystem", "ProtectSystem", "strict"],
    ["Service.ProtectHome", "ProtectHome", "true"],
  ];
  for (const [key, label, wanted] of hardening) {
    if (String(value(key) ?? "") !== wanted) errors.push(`${label} 必须为 ${wanted}`);
  }

  const readWrite = String(value("Service.ReadWritePaths") ?? "").split(/\s+/).filter(Boolean)
    .map(normalizedPath).sort();
  const requiredWrite = [unit.dataDir, unit.logsDir, unit.runtimeDir].map(normalizedPath).sort();
  if (JSON.stringify(readWrite) !== JSON.stringify(requiredWrite)) {
    errors.push("ReadWritePaths 必须仅包含 data、logs 与 .runtime 三个运行时目录");
  }

  if (value("Install.WantedBy") !== "multi-user.target") errors.push("WantedBy 必须为 multi-user.target");
  return errors;
}

export function systemdAnalyzeVerifyCommand(unitPath) {
  return ["systemd-analyze", ["verify", unitPath]];
}

export function systemdControlCommands(spec) {
  const unit = systemdUnitSpec(spec);
  return {
    toolVersion: ["systemctl", ["--version"]],
    analyzerVersion: ["systemd-analyze", ["--version"]],
    managerRunning: ["systemctl", ["is-system-running"]],
    isEnabled: ["systemctl", ["is-enabled", unit.name]],
    isActive: ["systemctl", ["is-active", unit.name]],
    show: ["systemctl", ["show", unit.name, "-p", "MainPID", "-p", "ActiveState", "-p", "SubState"]],
    stop: ["systemctl", ["stop", unit.name]],
    start: ["systemctl", ["start", unit.name]],
    enable: ["systemctl", ["enable", unit.name]],
    daemonReload: ["systemctl", ["daemon-reload"]],
    analyzeVerify: systemdAnalyzeVerifyCommand(unit.unitPath),
  };
}

export function parseSystemctlShow(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  let mainPid = null;
  if (values.MainPID !== undefined && /^\d+$/.test(values.MainPID)) {
    mainPid = Number(values.MainPID);
  }
  return { MainPID: mainPid, ActiveState: values.ActiveState ?? null, SubState: values.SubState ?? null };
}

export function parsePsIdentity(output) {
  const match = output.trim().match(/^(\S+)\s+(\S+)\s*$/);
  if (!match) return null;
  return { user: match[1], group: match[2] };
}

export function parseHealthReady(text) {
  try {
    const parsed = JSON.parse(text);
    return {
      status: typeof parsed.status === "string" ? parsed.status : null,
      database: typeof parsed.database === "string" ? parsed.database : null,
    };
  } catch {
    return { status: null, database: null };
  }
}

export function evaluateSystemdReleaseEvidence(evidence, expected) {
  const unit = systemdUnitSpec(expected);
  const errors = [];

  if (evidence.verifyStatus !== 0) errors.push("systemd-analyze verify 未通过");
  if (evidence.isEnabledStatus !== 0) errors.push(`${unit.name} 未启用（systemctl is-enabled 失败）`);
  if (evidence.isActiveStatus !== 0) errors.push(`${unit.name} 未运行（systemctl is-active 失败）`);

  const mainPid = evidence.mainPid;
  if (!Number.isInteger(mainPid) || mainPid <= 0) {
    errors.push(`MainPID 缺失或无效：${mainPid ?? "无"}`);
  } else {
    const processInfo = evidence.process ?? {};
    if (processInfo.user !== unit.user) errors.push(`主进程用户为 ${processInfo.user ?? "未知"}，期望 ${unit.user}（不得以 root 运行）`);
    if (processInfo.group !== unit.group) errors.push(`主进程组为 ${processInfo.group ?? "未知"}，期望 ${unit.group}`);
    if (normalizedPath(processInfo.executable) !== normalizedPath(unit.executable)) {
      errors.push(`主进程可执行文件为 ${processInfo.executable ?? "未知"}，期望 ${unit.executable}`);
    }
    if (normalizedPath(processInfo.cwd) !== normalizedPath(unit.workingDirectory)) {
      errors.push(`主进程工作目录为 ${processInfo.cwd ?? "未知"}，期望 ${unit.workingDirectory}`);
    }
  }

  const listenerGroups = groupListenersByPid(evidence.listeners ?? []);
  if (listenerGroups.length !== 1) {
    errors.push(`监听端口 ${unit.port} 的正式进程数为 ${listenerGroups.length}，期望恰好 1 个`);
  } else {
    const [listener] = listenerGroups;
    if (listener.pid !== mainPid) errors.push(`监听进程 PID ${listener.pid} 与 MainPID ${mainPid} 不一致`);
    if (normalizedPath(listener.executable) !== normalizedPath(unit.executable)) {
      errors.push(`监听进程可执行文件为 ${listener.executable ?? "未知"}，期望 ${unit.executable}`);
    }
    if (normalizedPath(listener.cwd) !== normalizedPath(unit.workingDirectory)) {
      errors.push(`监听进程工作目录为 ${listener.cwd ?? "未知"}，期望 ${unit.workingDirectory}`);
    }
    const expectedAddress = `${unit.host}:${unit.port}`;
    const addresses = listener.addresses ?? [];
    if (addresses.length !== 1 || addresses[0] !== expectedAddress) {
      errors.push(`监听地址为 ${addresses.join("、") || "未知"}，期望恰好 ${expectedAddress}（不允许通配或公网绑定）`);
    }
  }

  const health = evidence.health ?? {};
  if (!health.httpOk) errors.push(`http://${systemdHost}:${unit.port}/health/ready 请求失败`);
  else {
    if (health.status !== "ready") errors.push(`健康检查 status=${health.status ?? "缺失"}，期望 ready`);
    if (health.database !== "ok") errors.push(`健康检查 database=${health.database ?? "缺失"}，期望 ok`);
  }

  return { ok: errors.length === 0, errors };
}

// Factual per-criterion evidence lines for the acceptance report; the verdict
// (通过/未通过 + errors) is decided separately by evaluateSystemdReleaseEvidence.
export function renderSystemdAcceptanceReport(evidence) {
  const processInfo = evidence.process ?? {};
  const listenerGroups = groupListenersByPid(evidence.listeners ?? []);
  const listener = listenerGroups[0] ?? null;
  const addresses = listener?.addresses ?? [];
  const health = evidence.health ?? {};

  return [
    `systemd-analyze verify：${evidence.verifyStatus === 0 ? "通过" : `未通过（退出码 ${evidence.verifyStatus}）`}`,
    `服务状态：${evidence.isEnabledStatus === 0 ? "已启用" : "未启用"}，${evidence.isActiveStatus === 0 ? "运行中" : "未运行"}`,
    `主进程：${Number.isInteger(evidence.mainPid) && evidence.mainPid > 0 ? `PID ${evidence.mainPid}` : "PID 缺失"}（${processInfo.user ?? "用户未知"}:${processInfo.group ?? "组未知"}）`,
    `可执行文件：${processInfo.executable ?? "未知"}`,
    `工作目录：${processInfo.cwd ?? "未知"}`,
    `监听地址：${addresses.length > 0 ? addresses.join("、") : "无"}（${listener ? `PID ${listener.pid}` : "无监听进程"}）`,
    `健康检查：${health.httpOk
      ? `HTTP 正常，status=${health.status ?? "缺失"}，database=${health.database ?? "缺失"}`
      : "请求失败"}`,
  ];
}

// ---------------------------------------------------------------------------
// Systemd account planning and ownership plans
// ---------------------------------------------------------------------------

export function planSystemdAccount({ userExists, groupExists, nologinShell = "/usr/sbin/nologin" }) {
  const steps = [];
  if (!groupExists) steps.push({ command: ["groupadd", ["--system", systemdServiceGroup]] });
  if (!userExists) {
    steps.push({
      command: ["useradd", ["--system", "--no-create-home", "--user-group", "--shell", nologinShell, systemdServiceUser]],
    });
  }
  return steps;
}

export function validateSystemdAccountState({ userExists, groupExists, uid, groups }) {
  const errors = [];
  if (!groupExists) errors.push(`系统组 ${systemdServiceGroup} 不存在`);
  if (!userExists) errors.push(`系统账户 ${systemdServiceUser} 不存在`);
  if (!Number.isInteger(uid) || uid < 0) errors.push(`无法解析 ${systemdServiceUser} 的 UID`);
  else if (uid === 0) errors.push(`服务账户 ${systemdServiceUser} 不能是 root（UID 为 0）`);
  if (!Array.isArray(groups) || !groups.includes(systemdServiceGroup)) {
    errors.push(`账户 ${systemdServiceUser} 不属于 ${systemdServiceGroup} 组`);
  }
  return errors;
}

// Only rejects state that already exists and cannot be repaired by creating the
// missing group/user; a fully absent account is fine because it will be created.
export function validateSystemdAccountPreflight({ userExists, groupExists, uid, groups }) {
  const errors = [];
  if (userExists) {
    if (!Number.isInteger(uid) || uid < 0) errors.push(`无法解析 ${systemdServiceUser} 的 UID`);
    else if (uid === 0) errors.push(`服务账户 ${systemdServiceUser} 不能是 root（UID 为 0）`);
    if (!groupExists) errors.push(`系统组 ${systemdServiceGroup} 不存在，且账户已存在，无法兼容`);
    if (Array.isArray(groups) && !groups.includes(systemdServiceGroup)) {
      errors.push(`账户 ${systemdServiceUser} 不属于 ${systemdServiceGroup} 组`);
    }
  }
  return errors;
}

export function buildSystemdOwnershipPlan(spec, exists = fs.existsSync) {
  const unit = systemdUnitSpec(spec);
  const programEntries = [];
  for (const name of [...managedNames, ...legacyNames]) {
    const entryPath = path.join(unit.workingDirectory, name);
    if (exists(entryPath)) {
      programEntries.push({ path: entryPath, owner: "root", group: "root", mode: "u=rwX,go=rX", recursive: true });
    }
  }
  const previousRoot = previousReleaseRoot(unit.workingDirectory);
  const plan = [
    ...programEntries,
  ];
  if (exists(previousRoot)) {
    plan.push({ path: previousRoot, owner: "root", group: "root", mode: "u=rwX,go=rX", recursive: true });
  }
  if (exists(unit.environmentFile)) {
    plan.push({ path: unit.environmentFile, owner: "root", group: "root", mode: "0600", recursive: false });
  }
  const backupEnv = path.join(previousRoot, systemdBackupDirName, ".env");
  if (exists(backupEnv)) {
    plan.push({ path: backupEnv, owner: "root", group: "root", mode: "0600", recursive: false });
  }
  for (const runtimePath of [unit.dataDir, unit.logsDir, unit.runtimeDir]) {
    if (exists(runtimePath)) {
      plan.push({ path: runtimePath, owner: unit.user, group: unit.group, mode: "u=rwX,go=", recursive: true });
    }
  }
  return plan;
}

function applyOwnershipPlan(plan, runCommand) {
  for (const op of plan) {
    const flagArgs = op.recursive ? ["-R"] : [];
    const chown = runCommand("chown", [...flagArgs, `${op.owner}:${op.group}`, op.path]);
    if (chown.status !== 0) throw new Error(`设置所有者 ${op.owner}:${op.group} 失败：${op.path}`);
    const chmod = runCommand("chmod", [...flagArgs, op.mode, op.path]);
    if (chmod.status !== 0) throw new Error(`设置权限 ${op.mode} 失败：${op.path}`);
  }
}

// ---------------------------------------------------------------------------
// Systemd-only release execution (injectable for tests)
// ---------------------------------------------------------------------------

export function setupSystemdRelease(targetRoot, { createSecret } = {}) {
  const envPath = path.join(targetRoot, ".env");
  const dataDir = path.join(targetRoot, "data");
  const logsDir = path.join(targetRoot, "logs");
  const runtimeDir = path.join(targetRoot, ".runtime");
  const existingText = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const entries = normalizeSystemdEnv(parseEnv(existingText), createSecret);
  fs.writeFileSync(envPath, serializeEnv(entries), { encoding: "utf8", mode: 0o600 });
  // Enforce private mode even when the .env file already existed on disk.
  fs.chmodSync(envPath, 0o600);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  for (const logPath of [path.join(logsDir, "workplan.log"), path.join(logsDir, "workplan.err.log")]) {
    // Keep existing content; only create private log files when missing.
    const descriptor = fs.openSync(logPath, "a", 0o600);
    fs.closeSync(descriptor);
  }
  return entries;
}

function inspectSystemdAccount(io, user = systemdServiceUser, group = systemdServiceGroup) {
  const passwd = io.run("getent", ["passwd", user]);
  const groupInfo = io.run("getent", ["group", group]);
  let uid = null;
  let groups = null;
  if (passwd.status === 0) {
    const uidResult = io.run("id", ["-u", user]);
    const groupsResult = io.run("id", ["-Gn", user]);
    if (uidResult.status === 0) uid = Number.parseInt(uidResult.stdout.trim(), 10);
    if (groupsResult.status === 0) groups = groupsResult.stdout.trim().split(/\s+/).filter(Boolean);
  }
  return {
    userExists: passwd.status === 0,
    groupExists: groupInfo.status === 0,
    uid,
    groups,
  };
}

function detectNologinShell() {
  const result = capture("sh", ["-c", "command -v nologin"]);
  if (result.status === 0) {
    const shellPath = result.stdout.trim();
    if (shellPath) return shellPath;
  }
  return "/usr/sbin/nologin";
}

async function gatherSystemdEvidence(spec, runCommand, commands, fetchJson) {
  const verify = runCommand(...commands.analyzeVerify);
  const isEnabled = runCommand(...commands.isEnabled);
  const isActive = runCommand(...commands.isActive);
  const show = runCommand(...commands.show);
  const { MainPID } = parseSystemctlShow(show.stdout);

  let processInfo = null;
  if (Number.isInteger(MainPID) && MainPID > 0) {
    const ps = runCommand("ps", ["-p", String(MainPID), "-o", "user=,group="]);
    const identity = parsePsIdentity(ps.stdout);
    processInfo = {
      user: identity?.user ?? null,
      group: identity?.group ?? null,
      executable: parseLsofPath(runCommand("lsof", ["-nP", "-a", "-p", String(MainPID), "-d", "txt", "-Fn"]).stdout),
      cwd: parseLsofPath(runCommand("lsof", ["-nP", "-a", "-p", String(MainPID), "-d", "cwd", "-Fn"]).stdout),
    };
  }

  const listenerResult = runCommand("lsof", ["-nP", `-iTCP:${spec.port}`, "-sTCP:LISTEN", "-Fpcn"]);
  const listeners = [...groupListenersByPid(parseLsofListenerDetails(listenerResult.stdout))].map((entry) => ({
    ...entry,
    executable: parseLsofPath(runCommand("lsof", ["-nP", "-a", "-p", String(entry.pid), "-d", "txt", "-Fn"]).stdout),
    cwd: parseLsofPath(runCommand("lsof", ["-nP", "-a", "-p", String(entry.pid), "-d", "cwd", "-Fn"]).stdout),
  }));

  let health = { httpOk: false, text: "" };
  try {
    const response = await fetchJson(`http://${systemdHost}:${spec.port}/health/ready`);
    health = { httpOk: response.ok, text: response.text };
  } catch {
    health = { httpOk: false, text: "" };
  }
  const parsedHealth = parseHealthReady(health.text);

  return {
    verifyStatus: verify.status,
    isEnabledStatus: isEnabled.status,
    isActiveStatus: isActive.status,
    mainPid: MainPID,
    process: processInfo,
    listeners,
    health: { httpOk: health.httpOk, ...parsedHealth },
  };
}

export function makeRealSystemdIO({ platform = process.platform } = {}) {
  return {
    platform,
    isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
    nodeExecutable: process.execPath,
    nologinShell: detectNologinShell(),
    run(command, args, options = {}) {
      return capture(command, args, options);
    },
    waitPortFree(port, timeoutMs = 10_000) {
      waitForPortFree(port, timeoutMs);
    },
    async fetchJson(url) {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      const text = await response.text();
      return { ok: response.ok, text };
    },
    log: (message) => console.log(message),
  };
}

async function waitForSystemdReady(spec, runCommand, commands, fetchJson, timeoutMs = 20_000) {
  const unit = systemdUnitSpec(spec);
  const deadline = Date.now() + timeoutMs;
  let lastState = "服务尚未启动";
  while (Date.now() < deadline) {
    const isActive = runCommand(...commands.isActive);
    const listenerResult = runCommand("lsof", ["-nP", `-iTCP:${unit.port}`, "-sTCP:LISTEN", "-Fpcn"]);
    const listeners = [...groupListenersByPid(parseLsofListenerDetails(listenerResult.stdout))];
    if (isActive.status === 0 && listeners.length >= 1) {
      try {
        const response = await fetchJson(`http://${systemdHost}:${unit.port}/health/ready`);
        const health = parseHealthReady(response.text);
        if (response.ok && health.status === "ready" && health.database === "ok") {
          return listeners[0].pid;
        }
        lastState = `listener=${listeners.map((l) => l.pid).join(",")}，health=${health.status ?? "无"}/${health.database ?? "无"}`;
      } catch {
        lastState = `listener=${listeners.map((l) => l.pid).join(",")}，health 请求失败`;
      }
    } else {
      lastState = `active=${isActive.status === 0 ? "是" : "否"}，listener=${listeners.length ? listeners.map((l) => l.pid).join(",") : "无"}`;
    }
    sleepSync(200);
  }
  throw new Error(`systemd 服务 ${unit.name} 未能就绪（${timeoutMs}ms 超时）：${lastState}`);
}

export async function runSystemdRelease({
  workspaceRoot = sourceRoot,
  targetRoot = defaultTargetRoot,
  installSystemd = false,
  noStart = false,
  io,
  spec,
  hooks = {},
} = {}) {
  const unit = spec ?? systemdUnitSpec({ targetRoot, nodeExecutable: io?.nodeExecutable });
  const beforeStep = hooks.beforeStep ?? (() => {});
  const ioRun = (command, args, options = {}) => io.run(command, args, options);
  const previousRoot = previousReleaseRoot(unit.workingDirectory);
  const stagingRoot = `${unit.workingDirectory}.stage-${process.pid}-${stamp}`;
  const unitBackupPath = path.join(previousRoot, systemdBackupDirName, path.basename(unit.unitPath));
  const envBackupPath = path.join(previousRoot, systemdBackupDirName, ".env");
  const commands = systemdControlCommands(unit);

  const requireSuccess = (label, result) => {
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || "").trim().slice(0, 800);
      throw new Error(`${label} 失败（退出码 ${result.status}）${detail ? `：${detail}` : ""}`);
    }
    return result;
  };
  const log = (message) => (io.log ?? console.log)(message);
  const acceptRelease = (label, evidence) => {
    log(`${label}清单：`);
    for (const line of renderSystemdAcceptanceReport(evidence)) log(`  ${line}`);
    const verdict = evaluateSystemdReleaseEvidence(evidence, unit);
    if (!verdict.ok) {
      throw new Error(`${label}未通过：${verdict.errors.join("；")}`);
    }
    log(`${label}通过。`);
  };

  let stopAttempted = false;
  let promoteAttempted = false;
  let envBackedUp = false;
  let envMutated = false;
  let unitInstalled = false;
  let previousExisted = false;
  let previousUnitExisted = fs.existsSync(unit.unitPath);

  try {
    // ---- R4 preflight: platform, root, systemd tools, unit / account ----
    await beforeStep("preflight");
    if (io.platform !== "linux") throw new Error("systemd 发布仅支持 Linux");
    if (!io.isRoot) throw new Error("Linux 正式发布必须以 root 身份运行（sudo node scripts/release.mjs）");
    if (noStart) {
      throw new Error("Linux 正式发布不支持 --no-start：systemd 发布必须启动服务并完成验收（请改用自定义 --target 的隔离发布）");
    }
    requireSuccess("检查 systemctl", ioRun(...commands.toolVersion));
    requireSuccess("检查 systemd-analyze", ioRun(...commands.analyzerVersion));
    const managerState = ioRun(...commands.managerRunning);
    if (!/^(running|degraded)$/.test(managerState.stdout.trim())) {
      throw new Error("未检测到正在运行的系统级 systemd 管理器");
    }

    const unitText = fs.existsSync(unit.unitPath) ? fs.readFileSync(unit.unitPath, "utf8") : null;
    if (!installSystemd) {
      if (!unitText) {
        throw new Error(`未检测到受管理的 ${unit.unitPath}。正常发布要求已安装且安全的 workplan.service；请以 root 重新运行：node scripts/release.mjs --install-systemd`);
      }
      const unitErrors = validateSystemdUnit(parseSystemdUnit(unitText), unit);
      if (unitErrors.length) {
        throw new Error(`现有 ${unit.unitPath} 不符合正式配置要求：${unitErrors.join("；")}。请先以 root 运行 node scripts/release.mjs --install-systemd 重新安装`);
      }
    } else {
      const account = inspectSystemdAccount(io);
      const preflightErrors = validateSystemdAccountPreflight(account);
      if (preflightErrors.length) {
        throw new Error(`服务账户校验失败（未做任何变更）：${preflightErrors.join("；")}`);
      }
      const accountPlan = planSystemdAccount({ ...account, nologinShell: io.nologinShell ?? "/usr/sbin/nologin" });
      for (const step of accountPlan) {
        requireSuccess(`创建系统账户：${step.command.join(" ")}`, ioRun(...step.command));
      }
      const after = inspectSystemdAccount(io);
      const afterErrors = validateSystemdAccountState(after);
      if (afterErrors.length) {
        throw new Error(`服务账户检查失败：${afterErrors.join("；")}`);
      }
      const rendered = renderSystemdUnit(unit);
      const renderErrors = validateSystemdUnit(parseSystemdUnit(rendered), unit);
      if (renderErrors.length) {
        throw new Error(`生成的 unit 配置无效：${renderErrors.join("；")}`);
      }
    }

    // ---- R5: build ----
    await beforeStep("build");
    requireSuccess("构建（corepack pnpm build）", ioRun("corepack", ["pnpm", "build"], { cwd: workspaceRoot }));

    // ---- R5: prepare staging ----
    await beforeStep("staging");
    prepareStaging(workspaceRoot, stagingRoot);

    // ---- R5: stop the unit (never via the manual PID manager) ----
    await beforeStep("stop");
    const activeBeforeStop = ioRun(...commands.isActive);
    if (activeBeforeStop.status === 0) {
      requireSuccess(`systemctl stop ${unit.name}`, ioRun(...commands.stop));
      io.waitPortFree(unit.port);
      stopAttempted = true;
    } else {
      // Nothing managed is running; still record the stop boundary.
      stopAttempted = true;
    }

    // ---- R5: promote managed files ----
    await beforeStep("promote");
    promoteAttempted = true;
    promoteStaging(stagingRoot, unit.workingDirectory);
    previousExisted = fs.existsSync(previousRoot)
      && fs.readdirSync(previousRoot).some((name) => name !== systemdBackupDirName);


    // ---- R5: install production dependencies ----
    await beforeStep("install");
    requireSuccess("安装正式依赖（corepack pnpm install --prod）", ioRun("corepack", ["pnpm", "install", "--prod", "--frozen-lockfile"], { cwd: unit.workingDirectory }));

    // ---- R5: initialize production configuration (systemd-only setup) ----
    await beforeStep("setup");
    if (fs.existsSync(unit.environmentFile)) {
      fs.mkdirSync(path.dirname(envBackupPath), { recursive: true });
      fs.copyFileSync(unit.environmentFile, envBackupPath);
      envBackedUp = true;
    }
    setupSystemdRelease(unit.workingDirectory);
    envMutated = true;

    // ---- R5: apply ownership and permissions ----
    await beforeStep("ownership");
    const plan = buildSystemdOwnershipPlan(unit);
    applyOwnershipPlan(plan, ioRun);

    // ---- R5/R4: install or update the unit when explicitly requested ----
    if (installSystemd) {
      await beforeStep("unit");
      const rendered = renderSystemdUnit(unit);
      // systemd-analyze verify derives the unit name from the file name, so the
      // staged unit must keep the real name in a sibling staging directory.
      const tmpUnitDir = path.join(path.dirname(unit.unitPath), `.wp-stage-${process.pid}`);
      const tmpUnit = path.join(tmpUnitDir, path.basename(unit.unitPath));
      fs.mkdirSync(tmpUnitDir, { recursive: true });
      fs.writeFileSync(tmpUnit, rendered, { encoding: "utf8", mode: 0o644 });
      requireSuccess(`校验新 unit（systemd-analyze verify）`, ioRun(...systemdAnalyzeVerifyCommand(tmpUnit)));
      if (previousUnitExisted) {
        fs.mkdirSync(path.dirname(unitBackupPath), { recursive: true });
        fs.copyFileSync(unit.unitPath, unitBackupPath);
      }
      fs.renameSync(tmpUnit, unit.unitPath);
      unitInstalled = true;
      requireSuccess("systemctl daemon-reload", ioRun(...commands.daemonReload));

      await beforeStep("enable");
      requireSuccess(`systemctl enable ${unit.name}`, ioRun(...commands.enable));
    }

    // ---- R5: start the unit ----
    await beforeStep("start");
    requireSuccess(`systemctl start ${unit.name}`, ioRun(...commands.start));

    // ---- R8: readiness gate - wait for boot/bind/health before the
    // acceptance check. This closes the race where an app that takes ~2s to
    // start is inspected immediately and falsely reported as failed, which
    // previously triggered an automatic rollback. ----
    await beforeStep("verify");
    await waitForSystemdReady(unit, ioRun, commands, io.fetchJson);
    const evidence = await gatherSystemdEvidence(unit, ioRun, commands, io.fetchJson);
    acceptRelease("正式发布验收", evidence);

    log(`Workplan 已由 systemd ${unit.name}.service 启动（PID ${evidence.mainPid}，端口 ${unit.port}）`);
  } catch (error) {
    const rollbackErrors = [];
    const rollbackStep = async (label, action) => {
      try {
        await action();
      } catch (rollbackError) {
        rollbackErrors.push(`${label}：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    };

    if (stopAttempted || promoteAttempted || unitInstalled) {
      // R7: stop whatever the failed release may have started.
      const activeNow = ioRun(...commands.isActive);
      if (activeNow.status === 0) {
        await rollbackStep("停止失败版本", () => {
          requireSuccess("停止失败版本：systemctl stop", ioRun(...commands.stop));
          io.waitPortFree(unit.port);
        });
      }

      if (promoteAttempted && previousExisted) {
        await rollbackStep("恢复上一版本程序文件", () => restorePreviousRelease(unit.workingDirectory));
      }
      if (envMutated && envBackedUp && fs.existsSync(envBackupPath)) {
        await rollbackStep("恢复上一版本 .env", () => fs.copyFileSync(envBackupPath, unit.environmentFile));
      }
      if (unitInstalled) {
        if (previousUnitExisted) {
          await rollbackStep("恢复上一版本 unit", () => {
            fs.copyFileSync(unitBackupPath, unit.unitPath);
            requireSuccess("systemctl daemon-reload", ioRun(...commands.daemonReload));
          });
        } else {
          await rollbackStep("移除新安装的 unit", () => {
            if (fs.existsSync(unit.unitPath)) fs.rmSync(unit.unitPath, { force: true });
            requireSuccess("systemctl daemon-reload", ioRun(...commands.daemonReload));
          });
        }
      }
      await rollbackStep("恢复所有权与权限", () => applyOwnershipPlan(buildSystemdOwnershipPlan(unit), ioRun));

      if (previousExisted || previousUnitExisted) {
        await rollbackStep("启动并验证上一版本", async () => {
          requireSuccess("启动上一版本：systemctl start", ioRun(...commands.start));
          await waitForSystemdReady(unit, ioRun, commands, io.fetchJson);
          const evidence = await gatherSystemdEvidence(unit, ioRun, commands, io.fetchJson);
          acceptRelease("上一版本验收", evidence);
        });
      } else {
        error.recoveryNotice = `首次安装失败：${unit.unitPath} 未安装（或已移除），服务保持停止状态。请检查日志后重新运行：sudo node scripts/release.mjs --install-systemd`;
      }
    }

    if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors;
    throw error;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(unit.unitPath), `.wp-stage-${process.pid}`), { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Legacy macOS launchd / manual manager flow
// ---------------------------------------------------------------------------

async function main() {
  const args = parseReleaseArgs(process.argv);
  const stagingRoot = `${args.targetRoot}.stage-${process.pid}-${stamp}`;
  try {
    assertSafeTarget(args);
    if (args.installSystemd) {
      const errors = assertInstallSystemdPreconditions({
        ...args,
        platform: process.platform,
        isRoot: typeof process.getuid === "function" ? process.getuid() === 0 : false,
      });
      if (errors.length) throw new Error(errors.join("；"));
    }

    const supervisor = detectSupervisor(args);
    if (supervisor?.kind === "systemd") {
      const io = makeRealSystemdIO();
      await runSystemdRelease({
        workspaceRoot: sourceRoot,
        targetRoot: args.targetRoot,
        installSystemd: args.installSystemd,
        noStart: args.noStart,
        io,
      });
      return;
    }

    const productionListeners = args.managesProductionService ? inspectPortListeners(productionPort) : [];
    const expected = { targetRoot: args.targetRoot, nodeExecutable: process.execPath };
    assertSupervisorOwnership(supervisor, productionListeners, expected);
    if (supervisor) {
      console.log(`检测到正式环境由 ${launchdLabel} 监管，发布期间将暂停并在完成后恢复。`);
    } else if (productionListeners.length > 0) {
      console.log(`检测到正式环境 Workplan 正在占用端口 ${productionPort}，发布后将重启（${productionListeners.map(({ pid }) => `PID ${pid}`).join("、")}）。`);
    }

    console.log(`构建源码：${sourceRoot}`);
    runCorepack(["pnpm", "build"]);
    prepareStaging(sourceRoot, stagingRoot);

    let stopAttempted = false;
    let promotionStarted = false;
    try {
      stopAttempted = true;
      stopExistingRelease(supervisor, productionListeners, args.targetRoot, expected);
      promotionStarted = true;
      promoteStaging(stagingRoot, args.targetRoot);

      // pnpm creates Windows junctions with absolute targets. Install only after
      // promotion so those links point at the final release directory.
      console.log(`安装正式依赖：${args.targetRoot}`);
      runCorepack(["pnpm", "install", "--prod", "--frozen-lockfile"], { cwd: args.targetRoot });
      run(process.execPath, [path.join(args.targetRoot, "workplan.mjs"), "setup"], { cwd: args.targetRoot });
      if (!args.noStart) startRelease(supervisor, args.targetRoot);
    } catch (error) {
      if (promotionStarted) {
        console.error("新版本启动失败，正在恢复上一版本。");
        try {
          stopCurrentReleaseForRollback(supervisor, args.targetRoot, expected);
        } catch (stopError) {
          console.error(`停止失败版本时出错：${stopError instanceof Error ? stopError.message : stopError}`);
        }
        restorePreviousRelease(args.targetRoot);
      }
      if (stopAttempted && !args.noStart) {
        try {
          startRelease(supervisor, args.targetRoot);
        } catch (startError) {
          console.error(`恢复上一版本的启动失败：${startError instanceof Error ? startError.message : startError}`);
        }
      }
      throw error;
    }
    if (args.noStart) console.log(`发布完成：${args.targetRoot}（--no-start，服务未启动）`);
    else if (supervisor) console.log(`发布完成：${args.targetRoot}（端口 ${productionPort}，由 ${launchdLabel} 监管）`);
    else console.log(`发布完成：${args.targetRoot}（端口 ${productionPort}，由 workplan.mjs 托管）`);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    if (error && typeof error === "object" && error.recoveryNotice) console.error(error.recoveryNotice);
    if (error && Array.isArray(error.rollbackErrors) && error.rollbackErrors.length > 0) {
      for (const message of error.rollbackErrors) console.error(`回滚报告：${message}`);
    }
    process.exitCode = 1;
  });
}
