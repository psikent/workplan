// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./ToastProvider";

afterEach(() => {
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
});

function Trigger() {
  const { showSuccess } = useToast();
  return <button type="button" onClick={() => showSuccess("保存成功")}>保存</button>;
}
