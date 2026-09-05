import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  barkConfigSchema,
  barkTestPushResponseSchema,
  createManagedUserSchema,
  createPasswordManagedUserSchema,
  createTokenOnlyManagedUserSchema,
  createWorkPlanSchema,
  manageableUserRoles,
  ownerConflictSchema,
  updateBarkConfigSchema,
  userRoleSchema,
  userRoles,
  workPlanConflictCheckRequestSchema,
  workPlanConflictCheckResponseSchema,
} from "../src/index.ts";

const planUuid = "123e4567-e89b-42d3-a456-426614174000";
const otherUuid = "123e4567-e89b-42d3-a456-426614174001";
const counterpart = { id: otherUuid, label: "乙", startAt: "2026-05-01T04:00:00.000Z", endAt: "2026-05-01T08:00:00.000Z" };

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

describe("owner conflict contracts", () => {
  it("derived ownerConflict requires a non-empty owner and at least one counterpart", () => {
    assert.equal(ownerConflictSchema.safeParse({ owner: "zhangsan", counterparts: [counterpart] }).success, true);
    // 派生字段语义：无冲突时整体为 null，而不是空 counterparts
    assert.equal(ownerConflictSchema.safeParse({ owner: "zhangsan", counterparts: [] }).success, false);
    assert.equal(ownerConflictSchema.safeParse({ owner: "", counterparts: [counterpart] }).success, false);
    assert.equal(ownerConflictSchema.safeParse({ owner: "zhangsan", counterparts: [{ ...counterpart, id: "not-a-uuid" }] }).success, false);
    assert.equal(ownerConflictSchema.safeParse({ owner: "zhangsan", counterparts: [{ ...counterpart, endAt: "2026-05-01 08:00:00" }] }).success, false);
  });

  it("conflict-check request accepts an optional uuid id and rejects bad input strictly", () => {
    const valid = { owner: "zhangsan", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" };
    assert.equal(workPlanConflictCheckRequestSchema.safeParse({ ...valid, id: planUuid }).success, true);
    assert.equal(workPlanConflictCheckRequestSchema.safeParse(valid).success, true);
    assert.equal(workPlanConflictCheckRequestSchema.safeParse({ ...valid, id: "not-a-uuid" }).success, false);
    // superRefine：结束时间必须晚于开始时间
    assert.equal(workPlanConflictCheckRequestSchema.safeParse({ ...valid, endAt: valid.startAt }).success, false);
    assert.equal(workPlanConflictCheckRequestSchema.safeParse({ ...valid, owner: "" }).success, false);
    // strict：未知键在契约层即被拒绝
    assert.equal(workPlanConflictCheckRequestSchema.safeParse({ ...valid, extra: 1 }).success, false);
  });

  it("conflict-check response allows an empty counterparts list (= 无冲突)", () => {
    assert.equal(workPlanConflictCheckResponseSchema.safeParse({ owner: "zhangsan", counterparts: [] }).success, true);
    assert.equal(workPlanConflictCheckResponseSchema.safeParse({ owner: "zhangsan", counterparts: [counterpart] }).success, true);
    assert.equal(workPlanConflictCheckResponseSchema.safeParse({ owner: "zhangsan" }).success, false);
  });

  it("create input (strict) rejects the derived ownerConflict field", () => {
    const input = { title: "计划", startAt: "2026-05-01T02:00:00.000Z", endAt: "2026-05-01T06:00:00.000Z" };
    assert.equal(createWorkPlanSchema.safeParse(input).success, true);
    // 派生只读字段不可经入参写入（ADR 0008）
    assert.equal(createWorkPlanSchema.safeParse({ ...input, ownerConflict: { owner: "zhangsan", counterparts: [counterpart] } }).success, false);
  });
});
