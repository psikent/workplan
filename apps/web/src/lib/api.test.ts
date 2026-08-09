// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadWorkPlansXlsCustom, setCsrfToken } from "./api";

describe("downloadWorkPlansXlsCustom", () => {
  beforeEach(() => {
    setCsrfToken("token-123");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "导出失败" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the CSRF token on the export POST", async () => {
    await expect(downloadWorkPlansXlsCustom([], "工作计划")).rejects.toThrow("导出失败");
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/work-plans/export.xls");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Headers).get("X-CSRF-Token")).toBe("token-123");
  });
});
