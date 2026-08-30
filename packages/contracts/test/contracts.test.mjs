import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  barkConfigSchema,
  barkTestPushResponseSchema,
  createManagedUserSchema,
  createPasswordManagedUserSchema,
  createTokenOnlyManagedUserSchema,
  manageableUserRoles,
  updateBarkConfigSchema,
  userRoleSchema,
  userRoles,
} from "../src/index.ts";

describe("user role contracts", () => {
  it("exposes viewer as a user role", () => {
    assert.deepEqual(userRoles, ["admin", "editor", "viewer"]);
    assert.deepEqual(manageableUserRoles, ["editor", "viewer"]);
    assert.equal(userRoleSchema.safeParse("viewer").success, true);
    assert.equal(userRoleSchema.safeParse("guest").success, false);
  });

  it("accepts password viewers with the existing password rules", () => {
    const parsed = createPasswordManagedUserSchema.safeParse({ username: "viewer-1", role: "viewer", loginMode: "password", password: "a".repeat(12) });
    assert.equal(parsed.success, true);
    assert.equal(createPasswordManagedUserSchema.safeParse({ username: "viewer-1", role: "viewer", loginMode: "password", password: "a".repeat(11) }).success, false);
    assert.equal(createPasswordManagedUserSchema.safeParse({ username: "viewer-1", role: "viewer", loginMode: "password", password: "a".repeat(201) }).success, false);
  });

  it("accepts token-only viewers with the existing token rules", () => {
    const parsed = createTokenOnlyManagedUserSchema.safeParse({ username: "viewer-2", role: "viewer", loginMode: "token", tokenName: "导出", tokenExpiresAt: "2027-01-01T00:00:00.000Z" });
    assert.equal(parsed.success, true);
    assert.equal(createTokenOnlyManagedUserSchema.safeParse({ username: "viewer-2", role: "viewer", loginMode: "token", tokenName: "", tokenExpiresAt: "2027-01-01T00:00:00.000Z" }).success, false);
    assert.equal(createTokenOnlyManagedUserSchema.safeParse({ username: "viewer-2", role: "viewer", loginMode: "token", tokenName: "导出", tokenExpiresAt: "not-a-date" }).success, false);
  });

  it("keeps editor payloads valid and rejects administrator creation through this contract", () => {
    assert.equal(createManagedUserSchema.safeParse({ username: "editor-1", role: "editor", loginMode: "password", password: "a".repeat(12) }).success, true);
    assert.equal(createManagedUserSchema.safeParse({ username: "editor-2", role: "editor", loginMode: "token", tokenName: "导入", tokenExpiresAt: "2027-01-01T00:00:00.000Z" }).success, true);
    assert.equal(createManagedUserSchema.safeParse({ username: "admin-2", role: "admin", loginMode: "password", password: "a".repeat(12) }).success, false);
    assert.equal(createManagedUserSchema.safeParse({ username: "guest-1", role: "guest", loginMode: "password", password: "a".repeat(12) }).success, false);
    assert.equal(createManagedUserSchema.safeParse({ role: "viewer", loginMode: "password", password: "a".repeat(12) }).success, false);
  });

  it("requires an explicit role instead of defaulting to editor", () => {
    assert.equal(createManagedUserSchema.safeParse({ username: "someone", loginMode: "password", password: "a".repeat(12) }).success, false);
  });
});

describe("bark config contracts", () => {
  const validConfig = { serverUrl: "https://api.day.app", deviceKey: null };

  it("accepts valid http(s) URLs and null/empty device keys", () => {
    assert.equal(barkConfigSchema.safeParse(validConfig).success, true);
    assert.equal(barkConfigSchema.safeParse({ serverUrl: "http://192.168.1.5:8080", deviceKey: "device-key-1" }).success, true);
    assert.equal(updateBarkConfigSchema.safeParse({ serverUrl: validConfig.serverUrl, deviceKey: "" }).success, true);
    assert.equal(updateBarkConfigSchema.safeParse({ serverUrl: validConfig.serverUrl }).success, true);
  });

  it("rejects malformed and non-http(s) URLs", () => {
    assert.equal(barkConfigSchema.safeParse({ serverUrl: "not-a-url", deviceKey: null }).success, false);
    assert.equal(barkConfigSchema.safeParse({ serverUrl: "ftp://api.day.app", deviceKey: null }).success, false);
    assert.equal(updateBarkConfigSchema.safeParse({ serverUrl: "javascript:alert(1)", deviceKey: null }).success, false);
  });

  it("rejects unknown properties and over-long device keys", () => {
    assert.equal(updateBarkConfigSchema.safeParse({ ...validConfig, extra: 1 }).success, false);
    assert.equal(updateBarkConfigSchema.safeParse({ serverUrl: validConfig.serverUrl, deviceKey: "a".repeat(201) }).success, false);
  });

  it("describes the test push response shape", () => {
    assert.equal(barkTestPushResponseSchema.safeParse({ success: true, message: "推送成功" }).success, true);
    assert.equal(barkTestPushResponseSchema.safeParse({ success: false, message: "Bark 服务器返回 500" }).success, true);
    assert.equal(barkTestPushResponseSchema.safeParse({ success: true }).success, false);
  });
});
