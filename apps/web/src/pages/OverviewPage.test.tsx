// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { WorkPlan } from "@workplan/contracts";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OverviewPage from "./OverviewPage";

const apiMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({ api: apiMock }));

const plan: WorkPlan = {
  id: "f6251b28-a2d2-4f7f-bff1-b901cb1d9a53",
  title: "下周计划",
  description: "",
  status: "pending",
  statusMode: "automatic",
  startAt: new Date(2026, 7, 17, 8, 30).toISOString(),
  endAt: new Date(2026, 7, 21, 18).toISOString(),
  sortOrder: 0,
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: {},
  ownerAccount: null,
  createdAt: new Date(2026, 7, 1).toISOString(),
  updatedAt: new Date(2026, 7, 1).toISOString(),
};

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockResolvedValue([plan]);
});

describe("OverviewPage", () => {
  it("links an upcoming plan to its week and detail drawer", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/overview"]}>
          <OverviewPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const link = await screen.findByRole("link", { name: /下周计划/ });
    const url = new URL(link.getAttribute("href")!, "http://localhost");
    const params = new URLSearchParams(url.search);
    expect(url.pathname).toBe("/work-plans");
    expect(params.get("view")).toBe("week");
    expect(params.get("date")).toBe(plan.startAt);
    expect(params.get("plan")).toBe(plan.id);
    view.unmount();
  });
});
