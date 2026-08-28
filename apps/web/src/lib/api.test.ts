// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadEnvConfig, downloadWorkPlansXlsCustom, fetchReminders, setCsrfToken } from "./api";

describe("downloadEnvConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads the Environment Configuration Package using the response filename", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:env-config");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    let clickedHref = "";
    let clickedDownload = "";
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownload = this.download;
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "Content-Disposition": 'attachment; filename="env-config-2026-08-16.json"' },
    })));

    await downloadEnvConfig();

    expect(fetch).toHaveBeenCalledWith("/api/v1/env-config/file", { credentials: "include" });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickedHref).toBe("blob:env-config");
    expect(clickedDownload).toBe("env-config-2026-08-16.json");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:env-config");
  });

  it("rejects a failed Environment Configuration Package download", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));

    await expect(downloadEnvConfig()).rejects.toThrow("环境配置下载失败");
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe("fetchReminders", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("requests the reminders for the visible date range", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ days: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const response = await fetchReminders("2026-08-03", "2026-08-09");

    expect(fetch).toHaveBeenCalledWith("/api/v1/reminders?from=2026-08-03&to=2026-08-09", expect.objectContaining({ credentials: "include" }));
    expect(response).toEqual({ days: [] });
  });

  it("surfaces a failed reminder request as an ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: 422, code: "VALIDATION", detail: "日期范围无效" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(fetchReminders("2026-08-10", "2026-08-09")).rejects.toThrow("日期范围无效");
  });
});

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
    await expect(downloadWorkPlansXlsCustom([], "工作计划", "周报导出")).rejects.toThrow("导出失败");
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/work-plans/export.xls");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect((init?.headers as Headers).get("X-CSRF-Token")).toBe("token-123");
    expect(JSON.parse(String(init?.body))).toMatchObject({ name: "周报导出", sheetName: "工作计划", columns: [] });
  });
});
