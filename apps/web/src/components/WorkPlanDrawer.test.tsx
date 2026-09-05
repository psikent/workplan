// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CustomFieldDefinition, MonthlyGoal, WorkPlan, WorkPlanSeries } from "@workplan/contracts";
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
  version: 1,
  seriesId: null,
  occurrenceKey: null,
  isException: false,
  customFields: {},
  monthlyGoalIds: [],
  ownerAccount: null,
  ownerConflict: null,
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

  describe("monthly goal section", () => {
    const freeGoals: MonthlyGoal[] = [
      monthlyGoal({ id: "11111111-1111-4111-8111-111111111111", title: "官网改版", year: 2026, month: 8, createdAt: "2026-08-01T00:00:00.000Z" }),
      monthlyGoal({ id: "22222222-2222-4222-8222-222222222222", title: "客服培训", year: 2026, month: 7, createdAt: "2026-07-01T00:00:00.000Z" }),
    ];
    const occupiedGoal = monthlyGoal({
      id: "33333333-3333-4333-8333-333333333333",
      title: "季度评审",
      year: 2026,
      month: 8,
      createdAt: "2026-09-01T00:00:00.000Z",
      linkedWorkPlan: { id: "44444444-4444-4444-8444-444444444444", title: "其他任务" },
    });

    it("offers only Monthly Goals in a new Work Plan's covered month", () => {
      const view = render(
        <WorkPlanDrawer
          plan={null}
          fields={[]}
          monthlyGoals={freeGoals}
          initialDate={new Date(2026, 7, 15)}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(screen.getByRole("checkbox", { name: /官网改版/ })).toBeTruthy();
      expect(screen.queryByRole("checkbox", { name: /客服培训/ })).toBeNull();
      view.unmount();
    });

    it("offers Monthly Goals from both months covered by a cross-month Work Plan", () => {
      const septemberGoal = monthlyGoal({
        id: "66666666-6666-4666-8666-666666666666",
        title: "九月上线",
        year: 2026,
        month: 9,
        createdAt: "2026-09-01T00:00:00.000Z",
      });
      const view = render(
        <WorkPlanDrawer
          plan={{
            ...plan,
            startAt: new Date(2026, 7, 31, 23).toISOString(),
            endAt: new Date(2026, 8, 1, 1).toISOString(),
          }}
          fields={[]}
          monthlyGoals={[...freeGoals, septemberGoal]}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.closest("label")?.textContent)).toEqual([
        "2026 年 9 月 · 九月上线",
        "2026 年 8 月 · 官网改版",
      ]);
      view.unmount();
    });

    it("offers Monthly Goals across every month covered by a cross-year Work Plan", () => {
      const novemberGoal = monthlyGoal({ id: "77777777-7777-4777-8777-777777777777", title: "十一月目标", year: 2026, month: 11 });
      const decemberGoal = monthlyGoal({ id: "88888888-8888-4888-8888-888888888888", title: "十二月目标", year: 2026, month: 12 });
      const januaryGoal = monthlyGoal({ id: "99999999-9999-4999-8999-999999999999", title: "一月目标", year: 2027, month: 1 });
      const februaryGoal = monthlyGoal({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "二月目标", year: 2027, month: 2 });
      const view = render(
        <WorkPlanDrawer
          plan={{
            ...plan,
            startAt: new Date(2026, 11, 31, 10).toISOString(),
            endAt: new Date(2027, 0, 1, 2).toISOString(),
          }}
          fields={[]}
          monthlyGoals={[novemberGoal, decemberGoal, januaryGoal, februaryGoal]}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(screen.getAllByRole("checkbox").map((checkbox) => checkbox.closest("label")?.textContent)).toEqual([
        "2027 年 1 月 · 一月目标",
        "2026 年 12 月 · 十二月目标",
      ]);
      view.unmount();
    });

    it("sorts covered Monthly Goals and disables goals occupied by another Work Plan", () => {
      const view = render(
        <WorkPlanDrawer
          plan={null}
          fields={[]}
          monthlyGoals={[occupiedGoal, ...freeGoals]}
          initialDate={new Date(2026, 7, 15)}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(screen.getByRole("group", { name: "月目标" })).toBeTruthy();
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes.map((checkbox) => checkbox.closest("label")?.textContent)).toEqual([
        "2026 年 8 月 · 官网改版",
        "2026 年 8 月 · 季度评审",
      ]);

      const occupied = screen.getByRole("checkbox", { name: /季度评审/ }) as HTMLInputElement;
      expect(occupied.disabled).toBe(true);
      expect(occupied.closest("label")?.getAttribute("title")).toBe("该目标已关联其他工作计划");
      expect((screen.getByRole("checkbox", { name: /官网改版/ }) as HTMLInputElement).disabled).toBe(false);
      view.unmount();
    });

    it("submits checked goal ids and clears them when unchecked", async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const view = render(
        <WorkPlanDrawer
          plan={null}
          fields={[]}
          monthlyGoals={freeGoals}
          initialDate={new Date(2026, 7, 15)}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={onSave}
        />,
      );

      fireEvent.click(screen.getByRole("checkbox", { name: /官网改版/ }));
      fireEvent.change(screen.getByLabelText(/工作内容/), { target: { value: "挂目标计划" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0]?.[0]).toMatchObject({ monthlyGoalIds: ["11111111-1111-4111-8111-111111111111"] });

      fireEvent.click(screen.getByRole("checkbox", { name: /官网改版/ }));
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
      expect(onSave.mock.calls[1]?.[0]).toMatchObject({ monthlyGoalIds: [] });
      view.unmount();
    });

    it("cleans Goal-Plan Links only after date edits form a valid range", async () => {
      const septemberGoal = monthlyGoal({
        id: "66666666-6666-4666-8666-666666666666",
        title: "九月上线",
        year: 2026,
        month: 9,
        createdAt: "2026-09-01T00:00:00.000Z",
      });
      const onSave = vi.fn().mockResolvedValue(undefined);
      const view = render(
        <WorkPlanDrawer
          plan={{
            ...plan,
            monthlyGoalIds: [freeGoals[0]!.id, septemberGoal.id],
          }}
          fields={[]}
          monthlyGoals={[...freeGoals, septemberGoal]}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={onSave}
        />,
      );

      fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: "" } });
      expect((screen.getByRole("checkbox", { name: /官网改版/ }) as HTMLInputElement).checked).toBe(true);
      expect((screen.getByRole("checkbox", { name: /九月上线/ }) as HTMLInputElement).checked).toBe(true);

      fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: "2026-09-10T10:00" } });
      expect((screen.getByRole("checkbox", { name: /官网改版/ }) as HTMLInputElement).checked).toBe(true);
      expect((screen.getByRole("checkbox", { name: /九月上线/ }) as HTMLInputElement).checked).toBe(true);

      fireEvent.change(screen.getByLabelText(/结束时间/), { target: { value: "2026-09-10T11:00" } });
      expect(screen.queryByRole("checkbox", { name: /官网改版/ })).toBeNull();
      expect((screen.getByRole("checkbox", { name: /九月上线/ }) as HTMLInputElement).checked).toBe(true);

      fireEvent.change(screen.getByLabelText(/开始时间/), { target: { value: "2026-08-11T10:00" } });
      fireEvent.change(screen.getByLabelText(/结束时间/), { target: { value: "2026-08-11T11:00" } });
      expect(screen.queryByRole("checkbox", { name: /九月上线/ })).toBeNull();
      expect((screen.getByRole("checkbox", { name: /官网改版/ }) as HTMLInputElement).checked).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0]?.[0]).toMatchObject({ monthlyGoalIds: [] });
      view.unmount();
    });

    it("keeps an out-of-range Monthly Goal visible and linked until the date range changes", async () => {
      const onSave = vi.fn().mockResolvedValue(undefined);
      const view = render(
        <WorkPlanDrawer
          plan={{ ...plan, monthlyGoalIds: ["22222222-2222-4222-8222-222222222222"] }}
          fields={[]}
          monthlyGoals={freeGoals}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={onSave}
        />,
      );

      const historicalGoal = screen.getByRole("checkbox", { name: /客服培训/ }) as HTMLInputElement;
      expect(historicalGoal.checked).toBe(true);
      expect(historicalGoal.closest("label")?.textContent).toContain("当前关联，不在计划覆盖月份");
      expect((screen.getByRole("checkbox", { name: /官网改版/ }) as HTMLInputElement).checked).toBe(false);

      fireEvent.change(screen.getByLabelText(/工作内容/), { target: { value: "仅修改标题" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave.mock.calls[0]?.[0]).toMatchObject({ monthlyGoalIds: [freeGoals[1]!.id] });
      view.unmount();
    });

    it("shows the loading copy while goals are still being fetched", () => {
      const view = render(
        <WorkPlanDrawer
          plan={null}
          fields={[]}
          monthlyGoals={freeGoals}
          monthlyGoalsLoading
          open
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(screen.getByText("正在载入月目标…")).toBeTruthy();
      expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
      view.unmount();
    });

    it("keeps the Monthly Goal section visible when the covered months have no candidates", () => {
      const view = render(
        <WorkPlanDrawer
          plan={null}
          fields={[]}
          monthlyGoals={[]}
          initialDate={new Date(2026, 7, 15)}
          open
          saving={false}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />,
      );

      expect(screen.getByRole("group", { name: "月目标" })).toBeTruthy();
      expect(screen.getByText("计划覆盖月份内暂无可关联月目标")).toBeTruthy();
      view.unmount();
    });
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
    sortOrder: 0,
    defaultValue: null,
    archivedAt: null,
    version: 1,
    options: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function monthlyGoal(overrides: Partial<MonthlyGoal>): MonthlyGoal {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    title: "默认目标",
    description: "",
    year: 2026,
    month: 8,
    archivedAt: null,
    version: 1,
    status: null,
    linkedWorkPlan: null,
    seriesId: null,
    occurrenceKey: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}
