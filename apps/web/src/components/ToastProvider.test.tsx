// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastProvider";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ToastProvider", () => {
  it("shows, dismisses and automatically removes success feedback", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("status").textContent).toContain("保存成功");

    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    act(() => vi.advanceTimersByTime(3_500));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows errors as alerts with a longer auto-dismiss window", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);

    fireEvent.click(screen.getByRole("button", { name: "失败" }));
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("保存失败原因");
    expect(alert.className).toBe("error-toast");

    // 错误提示停留更久（6s），到点自动移除
    act(() => vi.advanceTimersByTime(3_500));
    expect(screen.getByRole("alert")).toBeTruthy();
    act(() => vi.advanceTimersByTime(2_500));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

function Trigger() {
  const { showSuccess, showError } = useToast();
  return (
    <>
      <button type="button" onClick={() => showSuccess("保存成功")}>保存</button>
      <button type="button" onClick={() => showError("保存失败原因")}>失败</button>
    </>
  );
}
