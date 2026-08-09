// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("status badges", () => {
  it("renders the Chinese labels used by the work-plan domain", () => {
    render(<StatusBadge status="in_progress" />);
    expect(screen.getByText("进行中")).toBeInTheDocument();
  });
});
