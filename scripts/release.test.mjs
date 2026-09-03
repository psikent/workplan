import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseEnv } from "./runtime-core.mjs";

// 这些用例断言 Linux systemd 产物（POSIX 路径字面量与 0o600 权限位），Windows 文件系统无法建模。
const onWindows = process.platform === "win32";
const skipOnWindows = { skip: onWindows && "仅适用于 Linux systemd 产物，Windows 跳过" };

import {
  assertInstallSystemdPreconditions,
  buildSystemdOwnershipPlan,
  corepackCommand,
  evaluateSystemdReleaseEvidence,
  groupListenersByPid,
  launchdControlCommands,
  launchdServiceTarget,
  listenerMatchesRelease,
  parseHealthReady,
  parseLaunchctlPid,
  parseLsofListenerDetails,
  parseLsofListeners,
  parsePsIdentity,
  parseSystemctlShow,
  parseSystemdUnit,
  planSystemdAccount,
  previousReleaseRoot,
  renderSystemdAcceptanceReport,
  renderSystemdUnit,
  runSystemdRelease,
  setupSystemdRelease,
  systemdControlCommands,
  systemdUnitSpec,
  validateSystemdAccountPreflight,
  validateSystemdAccountState,
  validateSystemdUnit,
} from "./release.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const releasePath = path.join(scriptsDir, "release.mjs");

// ---------------------------------------------------------------------------
// Existing tests (regression): launchd, manual manager, custom target
// ---------------------------------------------------------------------------

test("Corepack is resolved through PATH on POSIX", () => {
  assert.equal(corepackCommand("darwin"), "corepack");
  assert.equal(corepackCommand("linux"), "corepack");
});

test("Corepack uses its command shim on Windows", () => {
  assert.equal(corepackCommand("win32"), "corepack.cmd");
});

test("parses and de-duplicates lsof listeners", () => {
  assert.deepEqual(parseLsofListeners([
    "p101",
    "cnode",
    "p101",
    "cnode",
    "p202",
    "cpython",
    "",
  ].join("\n")), [
    { pid: 101, command: "node" },
    { pid: 202, command: "python" },
  ]);
});

test("requires command, working directory, and executable to identify production", () => {
  const expected = { targetRoot: "/srv/workplan-release", nodeExecutable: "/opt/node/bin/node" };
  assert.equal(listenerMatchesRelease({
    pid: 101,
    command: "node",
    cwd: "/srv/workplan-release",
    executable: "/opt/node/bin/node",
  }, expected), true);
  assert.equal(listenerMatchesRelease({
    pid: 101,
    command: "node",
    cwd: "/srv/another-app",
    executable: "/opt/node/bin/node",
  }, expected), false);
  assert.equal(listenerMatchesRelease({
    pid: 101,
    command: "node",
    cwd: "/srv/workplan-release",
    executable: "/usr/bin/node",
  }, expected), false);
});

test("builds launchd bootout and bootstrap commands for the same service", () => {
  const supervisor = {
    domain: "gui/501",
    plistPath: "/Users/test/Library/LaunchAgents/com.psikent.workplan.plist",
    serviceTarget: launchdServiceTarget(501),
  };
  assert.equal(supervisor.serviceTarget, "gui/501/com.psikent.workplan");
  assert.deepEqual(launchdControlCommands(supervisor), {
    stop: ["launchctl", ["bootout", "gui/501/com.psikent.workplan"]],
    start: ["launchctl", ["bootstrap", "gui/501", supervisor.plistPath]],
  });
});

test("reads the launchd process identifier without matching unrelated counters", () => {
  assert.equal(parseLaunchctlPid(["active count = 1", "pid = 77878", "runs = 5"].join("\n")), 77878);
  assert.equal(parseLaunchctlPid("state = spawn scheduled\nlast exit code = 1\n"), null);
});

test("requires --no-start for an isolated sibling release target", () => {
  const result = spawnSync(process.execPath, [releasePath, "--target", path.resolve(scriptsDir, "../../workplan-release-smoke")], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /自定义发布目录必须同时使用 --no-start/);
});

// ---------------------------------------------------------------------------
// Systemd unit rendering, parsing and validation (ticket 01)
// ---------------------------------------------------------------------------

const formalSpec = { targetRoot: "/var/opt/workplan-release" };

test("renders the managed unit with fixed topology and the hardening baseline", skipOnWindows, () => {
  const text = renderSystemdUnit(formalSpec);
  assert.match(text, /^Type=simple$/m);
  assert.match(text, /^User=workplan$/m);
  assert.match(text, /^Group=workplan$/m);
  assert.match(text, /^WorkingDirectory=\/var\/opt\/workplan-release$/m);
  assert.match(text, /^EnvironmentFile=\/var\/opt\/workplan-release\/\.env$/m);
  assert.match(text, /^ExecStart=\/usr\/bin\/node \/var\/opt\/workplan-release\/apps\/server\/dist\/index\.js$/m);
  assert.match(text, /^StandardOutput=append:\/var\/opt\/workplan-release\/logs\/workplan\.log$/m);
  assert.match(text, /^StandardError=append:\/var\/opt\/workplan-release\/logs\/workplan\.err\.log$/m);
  assert.match(text, /^Restart=on-failure$/m);
  assert.match(text, /^RestartSec=2$/m);
  assert.match(text, /^TimeoutStartSec=20$/m);
  assert.match(text, /^TimeoutStopSec=20$/m);
  assert.match(text, /^UMask=0077$/m);
  assert.match(text, /^NoNewPrivileges=true$/m);
  assert.match(text, /^PrivateTmp=true$/m);
  assert.match(text, /^ProtectSystem=strict$/m);
  assert.match(text, /^ProtectHome=true$/m);
  assert.match(
    text,
    /^ReadWritePaths=\/var\/opt\/workplan-release\/data \/var\/opt\/workplan-release\/logs \/var\/opt\/workplan-release\/\.runtime$/m,
  );
  assert.match(text, /^WantedBy=multi-user\.target$/m);
  assert.doesNotMatch(text, /workplan\.mjs/);
});

test("round-trips the rendered unit through the parser and validates clean", skipOnWindows, () => {
  const spec = systemdUnitSpec(formalSpec);
  const parsed = parseSystemdUnit(renderSystemdUnit(spec));
  assert.equal(parsed.get("Service.User"), "workplan");
  assert.equal(parsed.get("Service.Type"), "simple");
  assert.equal(parsed.get("Service.ExecStart"), "/usr/bin/node /var/opt/workplan-release/apps/server/dist/index.js");
  assert.equal(parsed.get("Install.WantedBy"), "multi-user.target");
  assert.deepEqual(validateSystemdUnit(parsed, spec), []);
});

test("rejects every unsafe or unrelated unit mutation", skipOnWindows, () => {
  const spec = systemdUnitSpec(formalSpec);
  const rendered = renderSystemdUnit(spec);
  const expectMismatch = (text, pattern) => {
    const errors = validateSystemdUnit(parseSystemdUnit(text), spec);
    assert.ok(errors.length > 0, `expected validation errors for ${pattern}`);
    assert.match(errors.join("；"), pattern);
  };

  expectMismatch(rendered.replace("Type=simple", "Type=forking"), /Type 必须为 simple/);
  expectMismatch(rendered.replace("User=workplan", "User=root"), /User 必须为 workplan/);
  expectMismatch(rendered.replace("Group=workplan", "Group=users"), /Group 必须为 workplan/);
  expectMismatch(rendered.replace("WorkingDirectory=/var/opt/workplan-release", "WorkingDirectory=/srv/other"), /WorkingDirectory 与正式发布目录不符/);
  expectMismatch(rendered.replace("EnvironmentFile=/var/opt/workplan-release/.env", "EnvironmentFile=/srv/other/.env"), /EnvironmentFile 必须指向/);
  expectMismatch(
    rendered.replace("apps/server/dist/index.js", "workplan.mjs"),
    /ExecStart 必须直接以绝对路径/,
  );
  expectMismatch(rendered.replace("StandardOutput=append:/var/opt/workplan-release/logs/workplan.log", "StandardOutput=append:/tmp/out.log"), /StandardOutput 日志路径不符/);
  expectMismatch(rendered.replace("StandardError=append:/var/opt/workplan-release/logs/workplan.err.log", "StandardError=journal"), /StandardError 日志路径不符/);
  expectMismatch(rendered.replace("Restart=on-failure", "Restart=always"), /Restart 必须为 on-failure/);
  expectMismatch(rendered.replace("RestartSec=2", "RestartSec=120"), /RestartSec 必须在 1–30 秒之间/);
  expectMismatch(rendered.replace("TimeoutStartSec=20", "TimeoutStartSec=600"), /TimeoutStartSec 必须在 1–120 秒之间/);
  expectMismatch(rendered.replace("TimeoutStopSec=20", "TimeoutStopSec=0"), /TimeoutStopSec 必须在 1–120 秒之间/);
  expectMismatch(rendered.replace("UMask=0077", "UMask=0022"), /UMask 必须为 0077/);
  expectMismatch(rendered.replace("NoNewPrivileges=true", "NoNewPrivileges=false"), /NoNewPrivileges 必须为 true/);
  expectMismatch(rendered.replace("PrivateTmp=true", "PrivateTmp=false"), /PrivateTmp 必须为 true/);
  expectMismatch(rendered.replace("ProtectSystem=strict", "ProtectSystem=full"), /ProtectSystem 必须为 strict/);
  expectMismatch(rendered.replace("ProtectHome=true", "ProtectHome=read-only"), /ProtectHome 必须为 true/);
  expectMismatch(rendered.replace("/var/opt/workplan-release/.runtime", "/etc"), /ReadWritePaths 必须仅包含/);
  expectMismatch(rendered.replace("WantedBy=multi-user.target", "WantedBy=graphical.target"), /WantedBy 必须为 multi-user\.target/);
});

test("--install-systemd rejects unsupported platform, custom target, --no-start and non-root", () => {
  const valid = { installSystemd: true, managesProductionService: true, noStart: false, platform: "linux", isRoot: true };
  assert.deepEqual(assertInstallSystemdPreconditions(valid), []);
  assert.deepEqual(assertInstallSystemdPreconditions({ ...valid, installSystemd: false }), []);

  const errors = assertInstallSystemdPreconditions({
    installSystemd: true,
    managesProductionService: false,
    noStart: true,
    platform: "darwin",
    isRoot: false,
  });
  assert.equal(errors.length, 4);
  assert.match(errors[0], /仅在 Linux/);
  assert.match(errors[1], /默认正式发布目录/);
  assert.match(errors[2], /--no-start/);
  assert.match(errors[3], /root/);
});

test("the CLI rejects --install-systemd before any side effect", () => {
  const result = spawnSync(process.execPath, [releasePath, "--install-systemd"], {
    encoding: "utf8",
    windowsHide: true,
  });
  assert.notEqual(result.status, 0);
  if (process.platform === "linux") {
    assert.match(result.stderr, /必须以 root 身份运行/);
  } else {
    assert.match(result.stderr, /仅在 Linux 上受支持/);
  }
});

test("builds systemd control commands for the formal service", () => {
  const spec = systemdUnitSpec(formalSpec);
  const commands = systemdControlCommands(spec);
  assert.deepEqual(commands.stop, ["systemctl", ["stop", "workplan"]]);
  assert.deepEqual(commands.start, ["systemctl", ["start", "workplan"]]);
  assert.deepEqual(commands.enable, ["systemctl", ["enable", "workplan"]]);
  assert.deepEqual(commands.daemonReload, ["systemctl", ["daemon-reload"]]);
  assert.deepEqual(commands.isEnabled, ["systemctl", ["is-enabled", "workplan"]]);
  assert.deepEqual(commands.isActive, ["systemctl", ["is-active", "workplan"]]);
  assert.deepEqual(commands.show, ["systemctl", ["show", "workplan", "-p", "MainPID", "-p", "ActiveState", "-p", "SubState"]]);
  assert.deepEqual(commands.analyzeVerify, ["systemd-analyze", ["verify", systemdUnitPath()]]);
});

function systemdUnitPath() {
  return "/etc/systemd/system/workplan.service";
}

test("parses systemctl show, ps identity and lsof listener details", () => {
  assert.deepEqual(parseSystemctlShow("MainPID=4242\nActiveState=active\nSubState=running\n"), {
    MainPID: 4242,
    ActiveState: "active",
    SubState: "running",
  });
  assert.equal(parseSystemctlShow("MainPID=0\n").MainPID, 0);
  assert.equal(parseSystemctlShow("MainPID=abc\n").MainPID, null);
  assert.deepEqual(parsePsIdentity("workplan workplan\n"), { user: "workplan", group: "workplan" });
  assert.equal(parsePsIdentity(""), null);
  assert.equal(parsePsIdentity("root root extra"), null);

  const blocks = parseLsofListenerDetails([
    "p101",
    "cnode",
    "n127.0.0.1:3000",
    "n127.0.0.1:3001",
    "p202",
    "cpython",
    "n*:3000",
    "",
  ].join("\n"));
  assert.deepEqual(blocks[0], { pid: 101, command: "node", addresses: ["127.0.0.1:3000", "127.0.0.1:3001"] });
  assert.deepEqual(blocks[1], { pid: 202, command: "python", addresses: ["*:3000"] });
  const groups = groupListenersByPid(blocks);
  assert.equal(groups.length, 2);
  assert.deepEqual(groupListenersByPid([
    { pid: 7, command: "node", addresses: ["127.0.0.1:3000"] },
    { pid: 7, command: "node", addresses: ["127.0.0.1:3001"] },
  ])[0].addresses, ["127.0.0.1:3000", "127.0.0.1:3001"]);
});

test("parses the structured ready health response", () => {
  assert.deepEqual(parseHealthReady('{"status":"ready","database":"ok"}'), { status: "ready", database: "ok" });
  assert.deepEqual(parseHealthReady("not json"), { status: null, database: null });
  assert.deepEqual(parseHealthReady('{"status":"degraded"}'), { status: "degraded", database: null });
});

// ---------------------------------------------------------------------------
// Release evidence evaluation (R8 success criteria)
// ---------------------------------------------------------------------------

function conformingEvidence() {
  return {
    verifyStatus: 0,
    isEnabledStatus: 0,
    isActiveStatus: 0,
    mainPid: 4242,
    process: { user: "workplan", group: "workplan", executable: "/usr/bin/node", cwd: "/var/opt/workplan-release" },
    listeners: [{
      pid: 4242,
      command: "node",
      executable: "/usr/bin/node",
      cwd: "/var/opt/workplan-release",
      addresses: ["127.0.0.1:3000"],
    }],
    health: { httpOk: true, status: "ready", database: "ok" },
  };
}

test("accepts a fully conforming release", skipOnWindows, () => {
  const verdict = evaluateSystemdReleaseEvidence(conformingEvidence(), formalSpec);
  assert.deepEqual(verdict, { ok: true, errors: [] });
});

test("rejects an unsafe unit verification status and unenabled/inactive states", () => {
  const spec = systemdUnitSpec(formalSpec);
  const evidence = { ...conformingEvidence(), verifyStatus: 1, isEnabledStatus: 1, isActiveStatus: 1 };
  const verdict = evaluateSystemdReleaseEvidence(evidence, spec);
  assert.equal(verdict.ok, false);
  assert.match(verdict.errors.join("；"), /systemd-analyze verify 未通过/);
  assert.match(verdict.errors.join("；"), /未启用/);
  assert.match(verdict.errors.join("；"), /未运行/);
});

test("rejects root or wrong-identity MainPID processes", () => {
  const spec = systemdUnitSpec(formalSpec);

  const rootCase = { ...conformingEvidence(), process: { ...conformingEvidence().process, user: "root", group: "root" } };
  let errors = evaluateSystemdReleaseEvidence(rootCase, spec).errors.join("；");
  assert.match(errors, /主进程用户为 root/);
  assert.match(errors, /不得以 root 运行/);

  const wrongGroup = { ...conformingEvidence(), process: { ...conformingEvidence().process, group: "users" } };
  assert.match(evaluateSystemdReleaseEvidence(wrongGroup, spec).errors.join("；"), /主进程组为 users/);

  const wrongExecutable = { ...conformingEvidence(), process: { ...conformingEvidence().process, executable: "/usr/local/bin/node" } };
  assert.match(evaluateSystemdReleaseEvidence(wrongExecutable, spec).errors.join("；"), /可执行文件为 \/usr\/local\/bin\/node/);

  const wrongCwd = { ...conformingEvidence(), process: { ...conformingEvidence().process, cwd: "/srv/other" } };
  assert.match(evaluateSystemdReleaseEvidence(wrongCwd, spec).errors.join("；"), /工作目录为 \/srv\/other/);

  const noPid = { ...conformingEvidence(), mainPid: 0, process: null, listeners: [] };
  assert.match(evaluateSystemdReleaseEvidence(noPid, spec).errors.join("；"), /MainPID 缺失或无效/);
});

test("rejects multiple listeners, wildcard binds and wrong ports", () => {
  const spec = systemdUnitSpec(formalSpec);
  const base = () => conformingEvidence().listeners[0];

  const multiple = { ...conformingEvidence(), listeners: [base(), { ...base(), pid: 9999 }] };
  assert.match(evaluateSystemdReleaseEvidence(multiple, spec).errors.join("；"), /正式进程数为 2/);

  const pidMismatch = { ...conformingEvidence(), listeners: [{ ...base(), pid: 9999 }] };
  assert.match(evaluateSystemdReleaseEvidence(pidMismatch, spec).errors.join("；"), /与 MainPID 4242 不一致/);

  const wildcard = { ...conformingEvidence(), listeners: [{ ...base(), addresses: ["*:3000"] }] };
  assert.match(evaluateSystemdReleaseEvidence(wildcard, spec).errors.join("；"), /不允许通配或公网绑定/);

  const publicBind = { ...conformingEvidence(), listeners: [{ ...base(), addresses: ["0.0.0.0:3000"] }] };
  assert.match(evaluateSystemdReleaseEvidence(publicBind, spec).errors.join("；"), /不允许通配或公网绑定/);

  const wrongPort = { ...conformingEvidence(), listeners: [{ ...base(), addresses: ["127.0.0.1:3001"] }] };
  assert.match(evaluateSystemdReleaseEvidence(wrongPort, spec).errors.join("；"), /期望恰好 127\.0\.0\.1:3000/);
});

test("rejects unhealthy HTTP responses and incomplete ready payloads", () => {
  const spec = systemdUnitSpec(formalSpec);

  const down = { ...conformingEvidence(), health: { httpOk: false, status: null, database: null } };
  assert.match(evaluateSystemdReleaseEvidence(down, spec).errors.join("；"), /\/health\/ready 请求失败/);

  const degraded = { ...conformingEvidence(), health: { httpOk: true, status: "degraded", database: "ok" } };
  assert.match(evaluateSystemdReleaseEvidence(degraded, spec).errors.join("；"), /status=degraded/);

  const noDatabase = { ...conformingEvidence(), health: { httpOk: true, status: "ready", database: null } };
  assert.match(evaluateSystemdReleaseEvidence(noDatabase, spec).errors.join("；"), /database=/);
});

test("renders a detailed acceptance report from the gathered evidence", () => {
  const lines = renderSystemdAcceptanceReport(conformingEvidence());
  assert.deepEqual(lines, [
    "systemd-analyze verify：通过",
    "服务状态：已启用，运行中",
    "主进程：PID 4242（workplan:workplan）",
    "可执行文件：/usr/bin/node",
    "工作目录：/var/opt/workplan-release",
    "监听地址：127.0.0.1:3000（PID 4242）",
    "健康检查：HTTP 正常，status=ready，database=ok",
  ]);

  const broken = renderSystemdAcceptanceReport({
    ...conformingEvidence(),
    verifyStatus: 1,
    isEnabledStatus: 1,
    isActiveStatus: 1,
    mainPid: 0,
    process: null,
    listeners: [],
    health: { httpOk: false, status: null, database: null },
  }).join("\n");
  assert.match(broken, /systemd-analyze verify：未通过（退出码 1）/);
  assert.match(broken, /服务状态：未启用，未运行/);
  assert.match(broken, /主进程：PID 缺失（用户未知:组未知）/);
  assert.match(broken, /可执行文件：未知/);
  assert.match(broken, /工作目录：未知/);
  assert.match(broken, /监听地址：无（无监听进程）/);
  assert.match(broken, /健康检查：请求失败/);
});

// ---------------------------------------------------------------------------
// Systemd account and ownership plans (ticket 02)
// ---------------------------------------------------------------------------

test("plans idempotent account creation with a non-login shell and no home", () => {
  assert.deepEqual(planSystemdAccount({ userExists: false, groupExists: false, nologinShell: "/usr/sbin/nologin" }), [
    { command: ["groupadd", ["--system", "workplan"]] },
    {
      command: ["useradd", ["--system", "--no-create-home", "--user-group", "--shell", "/usr/sbin/nologin", "workplan"]],
    },
  ]);
  assert.deepEqual(planSystemdAccount({ userExists: true, groupExists: true }), []);
  assert.deepEqual(planSystemdAccount({ userExists: true, groupExists: false }), [
    { command: ["groupadd", ["--system", "workplan"]] },
  ]);
});

test("rejects root, missing and non-member service accounts", () => {
  assert.match(
    validateSystemdAccountState({ userExists: true, groupExists: true, uid: 0, groups: ["workplan"] }).join("；"),
    /UID 为 0/,
  );
  assert.match(
    validateSystemdAccountState({ userExists: true, groupExists: true, uid: 1001, groups: ["users"] }).join("；"),
    /不属于 workplan 组/,
  );
  assert.match(
    validateSystemdAccountState({ userExists: false, groupExists: false, uid: null, groups: null }).join("；"),
    /系统组 workplan 不存在/,
  );
  assert.match(validateSystemdAccountState({
    userExists: true,
    groupExists: true,
    uid: NaN,
    groups: ["workplan"],
  }).join("；"), /无法解析 workplan 的 UID/);
});

test("account preflight rejects only existing-but-incompatible identities", () => {
  // A fully absent account is fine: it will be created during install.
  assert.deepEqual(validateSystemdAccountPreflight({ userExists: false, groupExists: false, uid: null, groups: null }), []);
  assert.match(
    validateSystemdAccountPreflight({ userExists: true, groupExists: true, uid: 0, groups: ["workplan"] }).join("；"),
    /UID 为 0/,
  );
  assert.match(
    validateSystemdAccountPreflight({ userExists: true, groupExists: true, uid: 1001, groups: ["admin"] }).join("；"),
    /不属于 workplan 组/,
  );
  assert.match(
    validateSystemdAccountPreflight({ userExists: true, groupExists: false, uid: 1001, groups: ["workplan"] }).join("；"),
    /无法兼容/,
  );
});

test("ownership plan keeps program files root-only and runtime paths service-owned", () => {
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-owner-"));
  const spec = systemdUnitSpec({ targetRoot });
  try {
    fs.mkdirSync(path.join(targetRoot, "apps"), { recursive: true });
    fs.mkdirSync(path.join(targetRoot, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "package.json"), "{}\n");
    fs.writeFileSync(path.join(targetRoot, ".env"), "HOST=0.0.0.0\n");
    fs.mkdirSync(path.join(targetRoot, "data"), { recursive: true });
    fs.mkdirSync(path.join(targetRoot, "logs"), { recursive: true });
    fs.mkdirSync(path.join(targetRoot, ".runtime"), { recursive: true });
    const previousRoot = previousReleaseRoot(targetRoot);
    fs.mkdirSync(previousRoot, { recursive: true });
    fs.writeFileSync(path.join(previousRoot, "package.json"), "prev\n");
    fs.mkdirSync(path.join(previousRoot, "systemd"), { recursive: true });
    fs.writeFileSync(path.join(previousRoot, "systemd", ".env"), "SECRET=backup\n");

    const plan = buildSystemdOwnershipPlan(spec);
    const byPath = new Map(plan.map((op) => [op.path, op]));

    assert.equal(byPath.get(path.join(targetRoot, "apps")).owner, "root");
    assert.equal(byPath.get(path.join(targetRoot, "node_modules")).owner, "root");
    assert.equal(byPath.get(path.join(targetRoot, "package.json")).owner, "root");
    assert.equal(byPath.get(path.join(targetRoot, ".env")).owner, "root");
    assert.equal(byPath.get(path.join(targetRoot, ".env")).mode, "0600");
    assert.equal(byPath.get(previousRoot).owner, "root");
    assert.equal(byPath.get(path.join(previousRoot, "systemd", ".env")).mode, "0600");

    assert.equal(byPath.get(path.join(targetRoot, "data")).owner, "workplan");
    assert.equal(byPath.get(path.join(targetRoot, "logs")).owner, "workplan");
    assert.equal(byPath.get(path.join(targetRoot, ".runtime")).owner, "workplan");
    assert.equal(byPath.get(path.join(targetRoot, "data")).mode, "u=rwX,go=");

    for (const op of plan) {
      const underProgram = op.path.startsWith(path.join(targetRoot, "apps"))
        || op.path.startsWith(path.join(targetRoot, "packages"))
        || op.path.startsWith(path.join(targetRoot, "node_modules"));
      if (underProgram || op.path === path.join(targetRoot, "package.json")) {
        assert.equal(op.owner, "root", `${op.path} must stay root-owned`);
      }
    }
  } finally {
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Systemd setup (ticket 02): env normalization and file modes
// ---------------------------------------------------------------------------

test("systemd setup forces only HOST while preserving secrets and unrelated entries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp-setup-"));
  try {
    const entries = setupSystemdRelease(root, {
      createSecret: () => "generated-secret",
    });
    assert.equal(entries.get("HOST"), "127.0.0.1");
    assert.equal(entries.get("PORT"), "3000");
    assert.equal(entries.get("APP_SECRET"), "generated-secret");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("systemd setup preserves an existing valid secret and unrelated configuration", skipOnWindows, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp-setup-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), [
      "NODE_ENV=production",
      "HOST=0.0.0.0",
      "PORT=3000",
      "DATA_DIR=./data",
      "APP_SECRET=existing-valid-secret-abcdefghijklmnopqrstuvwxyz",
      "APP_BASE_URL=https://workplan.example.com",
      "TZ=Asia/Tokyo",
      "SESSION_DAYS=14",
      "CUSTOM_SETTING=keep-me",
    ].join("\n") + "\n");
    setupSystemdRelease(root);
    const entries = parseEnv(fs.readFileSync(path.join(root, ".env"), "utf8"));
    assert.equal(entries.get("HOST"), "127.0.0.1");
    assert.equal(entries.get("APP_SECRET"), "existing-valid-secret-abcdefghijklmnopqrstuvwxyz");
    assert.equal(entries.get("APP_BASE_URL"), "https://workplan.example.com");
    assert.equal(entries.get("TZ"), "Asia/Tokyo");
    assert.equal(entries.get("SESSION_DAYS"), "14");
    assert.equal(entries.get("CUSTOM_SETTING"), "keep-me");
    assert.equal(fs.statSync(path.join(root, ".env")).mode & 0o777, 0o600);
    assert.ok(fs.existsSync(path.join(root, "data")));
    assert.ok(fs.existsSync(path.join(root, "logs", "workplan.log")));
    assert.ok(fs.existsSync(path.join(root, "logs", "workplan.err.log")));
    assert.equal(fs.statSync(path.join(root, "logs", "workplan.log")).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("systemd setup replaces an invalid secret and forces the formal port", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp-setup-"));
  try {
    fs.writeFileSync(path.join(root, ".env"), [
      "HOST=0.0.0.0",
      "PORT=4000",
      "APP_SECRET=short",
    ].join("\n") + "\n");
    const entries = setupSystemdRelease(root, { createSecret: () => "new-secret-with-enough-characters-123456" });
    assert.equal(entries.get("PORT"), "3000");
    assert.equal(entries.get("APP_SECRET"), "new-secret-with-enough-characters-123456");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenario-level release execution (tickets 02/03) via injected commands
// ---------------------------------------------------------------------------

function makeFixtureWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp-ws-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0", type: "module", scripts: {} }, null, 2) + "\n");
  fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\n");
  fs.writeFileSync(path.join(root, ".env.example"), "HOST=0.0.0.0\nAPP_SECRET=replace-me\n");
  fs.writeFileSync(path.join(root, "README.md"), "# fixture\n");
  fs.mkdirSync(path.join(root, "apps/server/dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps/server/package.json"), '{"name":"@workplan/server","type":"module"}\n');
  fs.writeFileSync(path.join(root, "apps/server/dist/index.js"), "console.log('fixture server');\n");
  fs.mkdirSync(path.join(root, "apps/web/dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps/web/dist/index.html"), "<h1>fixture</h1>\n");
  fs.mkdirSync(path.join(root, "packages/contracts/dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "packages/contracts/package.json"), '{"name":"@workplan/contracts"}\n');
  fs.writeFileSync(path.join(root, "packages/contracts/dist/index.js"), "export {};\n");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts/workplan.mjs"), "export function setup() {}\n");
  fs.writeFileSync(path.join(root, "scripts/runtime-core.mjs"), "export function parseEnv(t) { return new Map(); }\n");
  return root;
}

function makeContext({ targetRoot, nodeExecutable = "/usr/bin/node", accountExists = true, enabled = true, uid = 1001, started = false } = {}) {
  return {
    targetRoot,
    nodeExecutable,
    accountExists,
    enabled,
    uid,
    started,
    mainPid: 4242,
    starts: 0,
    stops: 0,
    listener: "p4242\ncnode\nn127.0.0.1:3000\n",
  };
}

function makeTargetRelease(targetRoot, version = "1") {
  fs.mkdirSync(path.join(targetRoot, "apps/server/dist"), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, "package.json"), JSON.stringify({ name: "release", version }, null, 2) + "\n");
  fs.writeFileSync(path.join(targetRoot, "pnpm-workspace.yaml"), "packages: []\n");
  fs.writeFileSync(path.join(targetRoot, ".env"), [
    "NODE_ENV=production",
    "HOST=0.0.0.0",
    "PORT=3000",
    "DATA_DIR=./data",
    "APP_SECRET=previous-release-secret-abcdefghijklmnopqrstuvwxyz",
    "APP_BASE_URL=http://127.0.0.1:3000",
  ].join("\n") + "\n");
  fs.mkdirSync(path.join(targetRoot, "data"), { recursive: true });
  fs.writeFileSync(path.join(targetRoot, "data", "workplan.db"), `db-${version}`);
}

function defaultResponder(ctx, command, args) {
  const ok = (stdout = "", stderr = "") => ({ status: 0, stdout, stderr });
  const fail = (stderr = "", status = 1) => ({ status, stdout: "", stderr });
  switch (command) {
    case "systemctl": {
      const [action, ...rest] = args;
      if (action === "--version") return ok("systemd 256\n");
      if (action === "is-system-running") return ok("running\n");
      if (action === "is-active") return ctx.started ? ok("active\n") : fail("inactive");
      if (action === "is-enabled") return ctx.enabled ? ok("enabled\n") : fail("disabled");
      if (action === "stop") {
        ctx.started = false;
        ctx.stops += 1;
        return ok();
      }
      if (action === "start") {
        ctx.starts += 1;
        ctx.started = true;
        return ok();
      }
      if (action === "enable") {
        ctx.enabled = true;
        return ok();
      }
      if (action === "daemon-reload") return ok();
      if (action === "show") {
        return ok([
          `MainPID=${ctx.started ? ctx.mainPid : 0}`,
          `ActiveState=${ctx.started ? "active" : "inactive"}`,
          `SubState=${ctx.started ? "running" : "dead"}`,
          "",
        ].join("\n"));
      }
      return fail(`unexpected systemctl ${action}`);
    }
    case "systemd-analyze": {
      if (args[0] === "verify") return ok();
      if (args[0] === "--version") return ok("systemd-analyze 256\n");
      return fail("unexpected systemd-analyze");
    }
    case "corepack":
      return ok();
    case "getent": {
      if (args[0] === "passwd") {
        return ctx.accountExists ? ok("workplan:x:1001:1001::/:/usr/sbin/nologin\n") : fail("");
      }
      if (args[0] === "group") {
        return ctx.accountExists ? ok("workplan:x:1001:\n") : fail("");
      }
      return fail("unexpected getent");
    }
    case "id": {
      if (args[0] === "-u") return ok(`${ctx.uid}\n`);
      if (args[0] === "-Gn") return ok("workplan\n");
      return fail("unexpected id");
    }
    case "groupadd":
      ctx.accountExists = true;
      return ok();
    case "useradd":
      ctx.accountExists = true;
      return ok();
    case "chown":
      return ok();
    case "chmod":
      return ok();
    case "ps":
      return ok(`${ctx.processUser ?? "workplan"} ${ctx.processGroup ?? "workplan"}\n`);
    case "lsof": {
      if (args.some((arg) => arg.startsWith("-iTCP"))) {
        return ctx.started && ctx.listener ? ok(ctx.listener) : fail("", 1);
      }
      if (args.includes("cwd")) return ok(`n${ctx.targetRoot}\n`);
      if (args.includes("txt")) return ok(`n${ctx.nodeExecutable}\n`);
      return fail("unexpected lsof");
    }
    default:
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  }
}

function createFakeIO(ctx, { rules = [], fetchJson } = {}) {
  const calls = [];
  const logs = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    for (const rule of rules) {
      if (rule.match && rule.match(command, args)) return rule.respond(ctx, command, args);
    }
    return defaultResponder(ctx, command, args);
  };
  return {
    platform: "linux",
    isRoot: true,
    run,
    calls,
    logs,
    log(message) {
      logs.push(message);
    },
    waitPortFree() {},
    async fetchJson(url) {
      return fetchJson ? fetchJson(url) : { ok: true, text: '{"status":"ready","database":"ok"}' };
    },
  };
}

async function runRelease({ workspace, targetRoot, installSystemd = false, noStart = false, ctx, rules, fetchJson, hooks, unitPath }) {
  const io = createFakeIO(ctx, { rules, fetchJson });
  const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
  let error = null;
  try {
    await runSystemdRelease({
      workspaceRoot: workspace,
      targetRoot,
      installSystemd,
      noStart,
      io,
      spec,
      hooks,
    });
  } catch (caught) {
    error = caught;
  }
  return { error, io, spec };
}

test("first install creates the account, installs a verified unit and starts the service", skipOnWindows, async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  const ctx = makeContext({ targetRoot, accountExists: false, enabled: false });
  try {
    const { error, io, spec } = await runRelease({ workspace, targetRoot, installSystemd: true, ctx, unitPath });
    assert.equal(error, null, error?.message);
    const calls = io.calls.map((entry) => entry.join(" "));

    assert.ok(calls.includes("groupadd --system workplan"), "group must be created");
    assert.ok(calls.includes("useradd --system --no-create-home --user-group --shell /usr/sbin/nologin workplan"), "user must be created");
    const groupIndex = calls.findIndex((call) => call.startsWith("groupadd"));
    const userIndex = calls.findIndex((call) => call.startsWith("useradd"));
    assert.ok(groupIndex < userIndex, "group before user");
    assert.ok(calls.includes("systemctl daemon-reload"));
    assert.ok(calls.includes("systemctl enable workplan"));
    assert.ok(calls.includes("systemctl start workplan"));
    assert.ok(calls.some((call) => call.startsWith("systemd-analyze verify ")), "unit must be verified with systemd-analyze");
    assert.ok(calls.some((call) => call.includes("pnpm install --prod")), "production dependencies must be installed");

    assert.equal(fs.readFileSync(unitPath, "utf8"), renderSystemdUnit(spec), "unit must be installed");
    const env = parseEnv(fs.readFileSync(path.join(targetRoot, ".env"), "utf8"));
    assert.equal(env.get("HOST"), "127.0.0.1");
    assert.equal((fs.statSync(path.join(targetRoot, ".env")).mode & 0o777), 0o600);
    assert.ok(!calls.some((call) => /workplan\.mjs\s+(start|stop|restart|setup|status)/.test(call)), "no process may be started through workplan.mjs");
    assert.equal(ctx.started, true);

    const report = io.logs.join("\n");
    assert.match(report, /正式发布验收清单：/);
    assert.match(report, /systemd-analyze verify：通过/);
    assert.match(report, /服务状态：已启用，运行中/);
    assert.match(report, /主进程：PID 4242（workplan:workplan）/);
    assert.match(report, /监听地址：127\.0\.0\.1:3000（PID 4242）/);
    assert.match(report, /健康检查：HTTP 正常，status=ready，database=ok/);
    assert.match(report, /正式发布验收通过。/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("a normal release validates the existing unit and never reinstalls or manages it", async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  makeTargetRelease(targetRoot, "1");
  const ctx = makeContext({ targetRoot, started: true });
  try {
    const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
    const oldUnit = renderSystemdUnit(spec).replace("RestartSec=2", "RestartSec=5");
    fs.writeFileSync(unitPath, oldUnit);

    const { error, io } = await runRelease({ workspace, targetRoot, installSystemd: false, ctx, unitPath });
    assert.equal(error, null, error?.message);
    const calls = io.calls.map((entry) => entry.join(" "));

    assert.equal(fs.readFileSync(unitPath, "utf8"), oldUnit, "normal release must not replace the unit");
    assert.ok(!calls.includes("systemctl enable workplan"), "normal release must not enable");
    assert.ok(!calls.some((call) => call.startsWith("groupadd") || call.startsWith("useradd")), "normal release must not create accounts");
    assert.ok(!fs.existsSync(path.join(previousReleaseRoot(targetRoot), "systemd", "workplan.service")), "no unit backup on normal releases");

    const stopIndex = calls.findIndex((call) => call === "systemctl stop workplan");
    const installIndex = calls.findIndex((call) => call.includes("pnpm install --prod"));
    assert.ok(stopIndex >= 0, "unit must be stopped");
    assert.ok(stopIndex < installIndex, "stop must happen before dependency install (stop-before-promotion rule)");
    assert.ok(!calls.some((call) => /workplan\.mjs\s+(start|stop|restart|setup|status)/.test(call)), "no process may be started through workplan.mjs");
    assert.equal(ctx.starts, 1);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("preflight rejects a missing unit before build, stop or promotion", async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  const ctx = makeContext({ targetRoot });
  try {
    const { error, io } = await runRelease({ workspace, targetRoot, installSystemd: false, ctx, unitPath });
    assert.match(error.message, /--install-systemd/);
    const calls = io.calls.map((entry) => entry.join(" "));
    assert.ok(!calls.includes("corepack pnpm build"), "must fail before build");
    assert.ok(!calls.includes("systemctl stop workplan"), "must fail before stop");
    assert.ok(!calls.some((call) => call.includes("pnpm install --prod")), "must fail before promotion");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("--no-start is rejected on the Linux formal path before build", async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  const ctx = makeContext({ targetRoot });
  try {
    const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
    fs.writeFileSync(unitPath, renderSystemdUnit(spec));
    const { error, io } = await runRelease({ workspace, targetRoot, noStart: true, ctx, unitPath });
    assert.match(error.message, /--no-start/);
    assert.ok(!io.calls.some((call) => String(call[0]) === "corepack"), "must fail before build");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("preflight rejects an unsafe unit before build, stop or promotion", async () => {  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  const ctx = makeContext({ targetRoot });
  try {
    const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
    fs.writeFileSync(unitPath, renderSystemdUnit(spec).replace("User=workplan", "User=root"));
    const { error, io } = await runRelease({ workspace, targetRoot, installSystemd: false, ctx, unitPath });
    assert.match(error.message, /User 必须为 workplan/);
    assert.match(error.message, /--install-systemd/);
    const calls = io.calls.map((entry) => entry.join(" "));
    assert.ok(!calls.includes("corepack pnpm build"));
    assert.ok(!calls.includes("systemctl stop workplan"));
    assert.ok(!calls.some((call) => call.includes("groupadd") || call.includes("useradd")));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("install mode aborts on an incompatible account before build or account writes", async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  const ctx = makeContext({ targetRoot, uid: 0 });
  try {
    const { error, io } = await runRelease({ workspace, targetRoot, installSystemd: true, ctx, unitPath });
    assert.match(error.message, /UID 为 0/);
    assert.ok(!fs.existsSync(unitPath), "must fail before unit writes");
    const calls = io.calls.map((entry) => entry.join(" "));
    assert.ok(!calls.includes("corepack pnpm build"));
    assert.ok(!calls.some((call) => call.includes("groupadd") || call.includes("useradd")));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("existing-unit replacement backs up the old unit and installs the rendered one", async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  makeTargetRelease(targetRoot, "1");
  const ctx = makeContext({ targetRoot, accountExists: true, enabled: false, started: true });
  try {
    const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
    const oldUnit = renderSystemdUnit(spec).replace("RestartSec=2", "RestartSec=5");
    fs.writeFileSync(unitPath, oldUnit);

    const { error } = await runRelease({ workspace, targetRoot, installSystemd: true, ctx, unitPath });
    assert.equal(error, null, error?.message);
    assert.equal(fs.readFileSync(unitPath, "utf8"), renderSystemdUnit(spec), "new unit must be installed");
    const backup = path.join(previousReleaseRoot(targetRoot), "systemd", "workplan.service");
    assert.equal(fs.readFileSync(backup, "utf8"), oldUnit, "old unit must be backed up before replacement");
    assert.equal(ctx.enabled, true);
    assert.equal(ctx.starts, 1);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("a failed verify rolls back files, .env and starts the previous version", async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  makeTargetRelease(targetRoot, "1");
  const ctx = makeContext({ targetRoot, enabled: true, started: true });
  try {
    const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
    fs.writeFileSync(unitPath, renderSystemdUnit(spec));

    const { error } = await runRelease({
      workspace,
      targetRoot,
      installSystemd: false,
      ctx,
      unitPath,
      // Fail the release verify with a root PID; let the rollback verify pass.
      rules: [{
        match: (command, args) => command === "ps",
        respond: (state) => {
          state.psCalls = (state.psCalls ?? 0) + 1;
          const identity = state.psCalls === 1 ? "root root" : "workplan workplan";
          return { status: 0, stdout: `${identity}\n`, stderr: "" };
        },
      }],
    });
    assert.match(error.message, /主进程用户为 root/);
    assert.equal(error.rollbackErrors, undefined, "rollback itself must succeed");

    const restored = JSON.parse(fs.readFileSync(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(restored.version, "1", "previous program files must be restored");
    assert.ok(!fs.existsSync(path.join(previousReleaseRoot(targetRoot), "package.json")), "backup must be moved back");
    const env = parseEnv(fs.readFileSync(path.join(targetRoot, ".env"), "utf8"));
    assert.equal(env.get("HOST"), "0.0.0.0", "previous .env must be restored");
    assert.ok(ctx.starts >= 2, "previous version must be started again");
    assert.equal(fs.readFileSync(path.join(targetRoot, "data", "workplan.db"), "utf8"), "db-1", "data must be untouched");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

for (const stage of ["promote", "install", "setup", "ownership", "unit", "start", "verify"]) {
  test(`failure injected at ${stage} restores the previous release and starts it again`, async () => {
    const workspace = makeFixtureWorkspace();
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
    const unitPath = path.join(targetRoot, "workplan.service");
    makeTargetRelease(targetRoot, "1");
    const ctx = makeContext({ targetRoot, enabled: true, started: true });
    try {
      const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
      fs.writeFileSync(unitPath, renderSystemdUnit(spec));

      const { error } = await runRelease({
        workspace,
        targetRoot,
        installSystemd: true,
        ctx,
        unitPath,
        hooks: {
          beforeStep: (name) => {
            if (name === stage) throw new Error(`注入失败：${stage}`);
          },
        },
      });
      assert.match(error.message, new RegExp(`注入失败：${stage}`));
      assert.equal(error.rollbackErrors, undefined, `rollback after ${stage} must succeed`);
      const restored = JSON.parse(fs.readFileSync(path.join(targetRoot, "package.json"), "utf8"));
      assert.equal(restored.version, "1", `previous version must be restored after ${stage} failure`);
      assert.ok(ctx.starts >= 1, `previous version must be started after ${stage} failure`);
      assert.equal(fs.readFileSync(unitPath, "utf8"), renderSystemdUnit(spec), "the managed unit must survive");
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(targetRoot, { recursive: true, force: true });
    }
  });
}

test("a failed first install removes the new unit, keeps the service stopped and reports recovery", async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  const ctx = makeContext({ targetRoot, accountExists: false, enabled: false });
  try {
    const { error } = await runRelease({
      workspace,
      targetRoot,
      installSystemd: true,
      ctx,
      unitPath,
      rules: [{
        match: (command, args) => command === "systemctl" && args[0] === "start",
        respond: () => ({ status: 1, stdout: "", stderr: "start failed" }),
      }],
    });
    assert.match(error.message, /systemctl start workplan 失败/);
    assert.equal(error.rollbackErrors, undefined, "rollback must succeed");
    assert.match(error.recoveryNotice, /首次安装失败/);
    assert.ok(!fs.existsSync(unitPath), "newly installed unit must be removed on failed first install");
    assert.equal(ctx.started, false, "service must stay stopped");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("rollback failures are reported separately while the original failure is preserved", async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  makeTargetRelease(targetRoot, "1");
  const ctx = makeContext({ targetRoot, started: true });
  try {
    const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
    fs.writeFileSync(unitPath, renderSystemdUnit(spec));

    const { error } = await runRelease({
      workspace,
      targetRoot,
      installSystemd: false,
      ctx,
      unitPath,
      rules: [{
        match: (command, args) => command === "ps",
        respond: (state) => {
          state.psCalls = (state.psCalls ?? 0) + 1;
          const identity = state.psCalls === 1 ? "root root" : "workplan workplan";
          return { status: 0, stdout: `${identity}\n`, stderr: "" };
        },
      }, {
        match: (command, args) => command === "systemctl" && args[0] === "start",
        respond: (state) => {
          state.starts += 1;
          if (state.starts === 1) {
            state.started = true;
            return { status: 0, stdout: "", stderr: "" };
          }
          return { status: 1, stdout: "", stderr: "start failed" };
        },
      }],
    });
    assert.match(error.message, /主进程用户为 root/, "original failure must be preserved");
    assert.equal(error.rollbackErrors.length, 1);
    assert.match(error.rollbackErrors[0], /启动并验证上一版本：.*systemctl start .*失败/);
    const restored = JSON.parse(fs.readFileSync(path.join(targetRoot, "package.json"), "utf8"));
    assert.equal(restored.version, "1", "files must still be restored even when the rollback start fails");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});

test("a successful normal update preserves data, logs and retains one previous release", skipOnWindows, async () => {
  const workspace = makeFixtureWorkspace();
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wp-rel-"));
  const unitPath = path.join(targetRoot, "workplan.service");
  makeTargetRelease(targetRoot, "1");
  const ctx = makeContext({ targetRoot, started: true });
  try {
    const spec = systemdUnitSpec({ targetRoot, nodeExecutable: ctx.nodeExecutable, unitPath });
    fs.writeFileSync(unitPath, renderSystemdUnit(spec));

    const { error } = await runRelease({ workspace, targetRoot, installSystemd: false, ctx, unitPath });
    assert.equal(error, null, error?.message);
    const promoted = JSON.parse(fs.readFileSync(path.join(targetRoot, "package.json"), "utf8"));
    assert.notEqual(promoted.version, "1", "new version must be promoted");
    const backup = JSON.parse(fs.readFileSync(path.join(previousReleaseRoot(targetRoot), "package.json"), "utf8"));
    assert.equal(backup.version, "1", "exactly one previous version must be retained");
    assert.equal(fs.readFileSync(path.join(targetRoot, "data", "workplan.db"), "utf8"), "db-1", "data must be preserved");
    assert.ok(fs.existsSync(path.join(targetRoot, "logs", "workplan.log")), "log files must be pre-created");
    assert.ok(fs.existsSync(path.join(targetRoot, "logs", "workplan.err.log")));
    assert.equal((fs.statSync(path.join(targetRoot, ".env")).mode & 0o777), 0o600);
    assert.equal(ctx.starts, 1);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(targetRoot, { recursive: true, force: true });
  }
});
