// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OwnerBadge, RiskBadge } from "./RiskBadge";

afterEach(cleanup);

describe("risk badge", () => {
  it("maps each of the four vocabulary tiers to its own color class", () => {
    const tiers = [
      ["可接受", "risk-acceptable"],
      ["低", "risk-low"],
      ["中", "risk-medium"],
      ["高", "risk-high"],
    ] as const;
    for (const [label, className] of tiers) {
      render(<RiskBadge label={label} />);
      expect(screen.getByText(label)).toHaveClass("risk-badge", className);
      cleanup();
    }
  });

  it("falls back to neutral gray while keeping the text for labels outside the four tiers", () => {
    render(<RiskBadge label="极高风险" />);
    expect(screen.getByText("极高风险")).toHaveClass("risk-unknown");
    expect(screen.getByText("极高风险")).not.toHaveClass("risk-high");
  });
});

describe("owner badge", () => {
  it("renders the owner name as a neutral pill", () => {
    render(<OwnerBadge label="张三" />);
    expect(screen.getByText("张三")).toHaveClass("owner-badge");
    expect(screen.queryByText("未指定")).not.toBeInTheDocument();
  });

  it("renders 未指定 for a null owner", () => {
    render(<OwnerBadge label={null} />);
    expect(screen.getByText("未指定")).toHaveClass("owner-badge-unassigned");
  });
});
