// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomFieldDefinition, WorkPlan, WorkPlanSeries } from "@workplan/contracts";
import { describe, expect, it, vi } from "vitest";
import WorkPlanDrawer from "./WorkPlanDrawer";

const plan: WorkPlan = {
  id: "b70cff45-b93c-4dff-ab87-e15ef3d2494f",
  title: "示例计划",
  description: "",
  status: "pending",
  statusMode: "automatic",
  startAt: "2026-08-11T02:00:00.000Z",
  endAt: "2026-08-11T03:00:00.000Z",
  sortOrder: 0,
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: {},
  ownerAccount: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const series: WorkPlanSeries = {
  id: "6fd55ca8-b1e1-49e6-966c-d12704e3f835",
  workPlan: {
    title: plan.title,
    description: plan.description,
    status: plan.status,
    startAt: plan.startAt,
    endAt: plan.endAt,
    customFields: plan.customFields,
  },
  recurrence: { frequency: "weekly", interval: 2, until: null, count: null, timeZone: "Asia/Shanghai" },
  generatedThrough: null,
  active: true,
  version: 1,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt,
};

describe("WorkPlanDrawer", () => {
  it("defaults a new work plan to 08:30 through 18:00 on the current day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 7, 9, 22, 15));
    try {
      const view = render(
        <WorkPlanDrawer
          plan={null}
          fields={[]}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect((screen.getByLabelText(/开始时间/) as HTMLInputElement).value).toBe("2026-08-09T08:30");
      expect((screen.getByLabelText(/结束时间/) as HTMLInputElement).value).toBe("2026-08-09T18:00");
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prefills a supplied local date while retaining the standard work hours", () => {
    const view = render(
      <WorkPlanDrawer
        plan={null}
        fields={[]}
        initialDate={new Date(2026, 7, 15)}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect((screen.getByLabelText(/开始时间/) as HTMLInputElement).value).toBe("2026-08-15T08:30");
    expect((screen.getByLabelText(/结束时间/) as HTMLInputElement).value).toBe("2026-08-15T18:00");
    view.unmount();
  });

  it("prefills active custom-field defaults for a new work plan", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const fields = [
      customField({ id: "6e8aa51e-c452-4511-b7de-c5eec15bd4dd", key: "owner", label: "负责人", defaultValue: "自动化" }),
      customField({ id: "2400832b-7f1d-48b3-a7ab-52925de1048e", key: "effort", label: "工时", type: "number", defaultValue: 8 }),
      customField({ id: "a827d5fc-7f0d-4422-bb78-a1114d15f1d5", key: "important", label: "重点", type: "boolean", defaultValue: true }),
      customField({ id: "c1867260-2641-4777-8de1-e7113c352c34", key: "archived", label: "已归档", defaultValue: "不应填充", archivedAt: "2026-08-02T00:00:00.000Z" }),
    ];
    const view = render(
      <WorkPlanDrawer
        plan={null}
        fields={fields}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect((screen.getByLabelText("负责人") as HTMLInputElement).value).toBe("自动化");
    expect((screen.getByLabelText("工时") as HTMLInputElement).value).toBe("8");
    expect(screen.getByText("重点").closest("label")?.querySelector("button")?.classList.contains("on")).toBe(true);
    expect(screen.queryByText("已归档")).toBeNull();

    fireEvent.change(screen.getByLabelText(/工作内容/), { target: { value: "默认字段计划" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      customFields: { owner: "自动化", effort: 8, important: true },
    }), null));
    view.unmount();
  });

  it("does not expose removed tag or reminder properties", () => {
    const view = render(
      <WorkPlanDrawer
        plan={null}
        fields={[]}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("新建工作计划")).toBeTruthy();
    expect(screen.getByLabelText(/工作内容/)).toBeTruthy();
    expect(screen.queryByLabelText(/标题/)).toBeNull();
    expect(screen.getByRole("group", { name: "计划周期" })).toBeTruthy();
    expect(screen.queryByText("标签")).toBeNull();
    expect(screen.queryByText("提醒")).toBeNull();
    expect(screen.queryByText("优先级")).toBeNull();
    view.unmount();
  });

  it("uses automatic status until the user explicitly selects a status", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <WorkPlanDrawer
        plan={null}
        fields={[]}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("自动")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/工作内容/), { target: { value: "自动状态计划" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ statusMode: "automatic" });
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("status");

    fireEvent.change(screen.getByRole("combobox", { name: /状态/ }), { target: { value: "cancelled" } });
    expect(screen.getByText("手动")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1]?.[0]).toMatchObject({ status: "cancelled", statusMode: "manual" });
    view.unmount();
  });

  it("can restore a manually overridden status to automatic", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <WorkPlanDrawer
        plan={{ ...plan, status: "cancelled", statusMode: "manual" }}
        fields={[]}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("手动")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "恢复自动" }));
    expect(screen.getByText("自动")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ statusMode: "automatic" });
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("status");
    view.unmount();
  });

  it("places required custom fields first and renders one field per row", () => {
    const optionalField = customField({ id: "70054ddb-233c-4512-8102-677424de7fac", key: "optional", label: "可选字段", required: false, sortOrder: 0 });
    const requiredField = customField({ id: "fc2022cb-06c7-4a25-922a-a90f5593c85f", key: "required", label: "必填字段", required: true, sortOrder: 9 });
    const view = render(
      <WorkPlanDrawer
        plan={null}
        fields={[optionalField, requiredField]}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    const rows = Array.from(view.container.querySelectorAll(".custom-field-list > .field"));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.textContent)).toEqual(["必填字段 *", "可选字段"]);
    view.unmount();
  });

  it("shows a read-only owner account immediately below the owner and updates it before save", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const owner = customField({
      id: "f9a9dc48-e819-4b1b-89a3-ee680649e842",
      key: "owner",
      label: "工作负责人",
      type: "single_select",
      options: [
        { id: "44a6325a-caa8-43e1-b998-567a816ec272", value: "fengmingqian", label: "冯铭倩", sortOrder: 0, archivedAt: null, version: 1 },
        { id: "a1a22ca6-4a22-496d-9ac0-077dd5278463", value: "linyaqian", label: "林雅茜", sortOrder: 1, archivedAt: null, version: 1 },
      ],
    });
    const view = render(
      <WorkPlanDrawer
        plan={null}
        fields={[owner]}
        ownerAccountMappings={[{ ownerName: "冯铭倩", account: "fengmingqian@zh.gd.csg.cn" }]}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const controls = Array.from(view.container.querySelectorAll(".custom-field-list > .field"));
    expect(controls.map((control) => control.querySelector("span")?.textContent)).toEqual(["工作负责人", "工作负责人账号"]);
    const account = screen.getByLabelText("工作负责人账号") as HTMLInputElement;
    expect(account.readOnly).toBe(true);
    expect(account.value).toBe("未配置");

    fireEvent.change(screen.getByLabelText("工作负责人"), { target: { value: "fengmingqian" } });
    expect(account.value).toBe("fengmingqian@zh.gd.csg.cn");
    fireEvent.change(screen.getByLabelText("工作负责人"), { target: { value: "linyaqian" } });
    expect(account.value).toBe("未配置");

    fireEvent.change(screen.getByLabelText(/工作内容/), { target: { value: "账号联动计划" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ customFields: { owner: "linyaqian" } });
    expect(onSave.mock.calls[0]?.[0]).not.toHaveProperty("ownerAccount");
    view.unmount();
  });

  it("distinguishes owner mapping loading failures from unmapped owners", () => {
    const owner = customField({ key: "owner", label: "工作负责人", type: "single_select" });
    const loading = render(
      <WorkPlanDrawer plan={null} fields={[owner]} ownerAccountMappingsLoading open saving={false} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect((screen.getByLabelText("工作负责人账号") as HTMLInputElement).value).toBe("加载中…");
    loading.unmount();

    const failed = render(
      <WorkPlanDrawer plan={null} fields={[owner]} ownerAccountMappingsError open saving={false} onClose={vi.fn()} onSave={vi.fn()} />,
    );
    expect((screen.getByLabelText("工作负责人账号") as HTMLInputElement).value).toBe("映射加载失败");
    failed.unmount();
  });

  it("opens cleanly after being rendered closed", () => {
    const owner = customField({ key: "owner", label: "工作负责人", type: "single_select" });
    const props = {
      plan: null,
      fields: [owner],
      saving: false,
      onClose: vi.fn(),
      onSave: vi.fn(),
    };
    const view = render(<WorkPlanDrawer {...props} open={false} />);
    view.rerender(<WorkPlanDrawer {...props} open />);
    expect(screen.getByLabelText("工作负责人账号")).toBeTruthy();
    view.unmount();
  });

  it("allows an existing one-time plan to become recurring", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <WorkPlanDrawer
        plan={plan}
        fields={[]}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("group", { name: "计划周期" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("周期"), { target: { value: "weekly" } });
    fireEvent.change(screen.getByLabelText("间隔"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: "示例计划", version: 1 }),
      { frequency: "weekly", interval: 2, timeZone: "Asia/Shanghai" },
    ));
    view.unmount();
  });

  it("offers a copy action for an existing work plan", async () => {
    const onDuplicate = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <WorkPlanDrawer
        plan={plan}
        fields={[]}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onDuplicate={onDuplicate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "复制" }));

    await waitFor(() => expect(onDuplicate).toHaveBeenCalledWith(plan));
    view.unmount();
  });

  it("loads an existing cycle and can stop future occurrences", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(
      <WorkPlanDrawer
        plan={{ ...plan, seriesId: series.id, occurrenceKey: plan.startAt }}
        series={series}
        fields={[]}
        open
        saving={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    expect((screen.getByLabelText("周期") as HTMLSelectElement).value).toBe("weekly");
    expect((screen.getByLabelText("间隔") as HTMLInputElement).value).toBe("2");
    fireEvent.change(screen.getByLabelText("周期"), { target: { value: "none" } });
    expect(screen.getByText("保存后将停止生成后续计划，当前计划会保留。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.any(Object), null));
    view.unmount();
  });
});

function customField(overrides: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "326557bb-aa3d-4de6-b07e-f8f222c9ecff",
    key: "field",
    label: "字段",
    description: "",
    type: "short_text",
    required: false,
    defaultValue: null,
    sortOrder: 0,
    archivedAt: null,
    version: 1,
    options: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}
