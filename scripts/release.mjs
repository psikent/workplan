import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetArgIndex = process.argv.indexOf("--target");
const targetRoot = path.resolve(
  targetArgIndex >= 0 && process.argv[targetArgIndex + 1]
    ? process.argv[targetArgIndex + 1]
    : path.resolve(sourceRoot, "../workplan-release"),
);
const noStart = process.argv.includes("--no-start");
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

export function corepackCommand(platform = process.platform) {
  return platform === "win32" ? "corepack.cmd" : "corepack";
}

function runCorepack(args, options = {}) {
  return run(corepackCommand(), args, {
    ...options,
    shell: process.platform === "win32",
  });
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

function stopExistingRelease() {
  const manager = path.join(targetRoot, "workplan.mjs");
  if (fs.existsSync(manager)) run(process.execPath, [manager, "stop"], { cwd: targetRoot, allowFailure: true });
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

function main() {
  assertSafeTarget();
  console.log(`构建源码：${sourceRoot}`);
  runCorepack(["pnpm", "build"]);
  prepareStaging();

  stopExistingRelease();
  promoteStaging();
  try {
    // pnpm creates Windows junctions with absolute targets. Install only after
    // promotion so those links point at the final release directory.
    console.log(`安装正式依赖：${targetRoot}`);
    runCorepack(["pnpm", "install", "--prod", "--frozen-lockfile"], { cwd: targetRoot });
    run(process.execPath, [path.join(targetRoot, "workplan.mjs"), "setup"], { cwd: targetRoot });
    if (!noStart) run(process.execPath, [path.join(targetRoot, "workplan.mjs"), "start"], { cwd: targetRoot });
  } catch (error) {
    console.error("新版本启动失败，正在恢复上一版本。");
    restorePreviousRelease();
    const previousManager = path.join(targetRoot, "workplan.mjs");
    if (!noStart && fs.existsSync(previousManager)) run(process.execPath, [previousManager, "start"], { cwd: targetRoot, allowFailure: true });
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
