import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  corepackCommand,
  launchdControlCommands,
  launchdServiceTarget,
  listenerMatchesRelease,
  parseLaunchctlPid,
  parseLsofListeners,
} from "./release.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const releasePath = path.join(scriptsDir, "release.mjs");

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
