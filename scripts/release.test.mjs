import assert from "node:assert/strict";
import test from "node:test";

import { corepackCommand } from "./release.mjs";

test("Corepack is resolved through PATH on POSIX", () => {
  assert.equal(corepackCommand("darwin"), "corepack");
  assert.equal(corepackCommand("linux"), "corepack");
});

test("Corepack uses its command shim on Windows", () => {
  assert.equal(corepackCommand("win32"), "corepack.cmd");
});
