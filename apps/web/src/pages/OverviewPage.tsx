import { useQuery } from "@tanstack/react-query";
import type { ReminderType, WorkbenchOverview } from "@workplan/contracts";
import { ArrowRight, CalendarClock, CircleCheckBig, Clock3, PlayCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { api, fetchReminders } from "../lib/api";
import { formatDate, toLocalDateString } from "../lib/format";

const reminderTypeLabels: Record<ReminderType, string> = {
  "work-order": "检修单提醒",
  "plan-submission": "作业计划提交提醒",
};

function workPlanTimelineLink(plan: { id: string; startAt: string }) {
  const params = new URLSearchParams({
    view: "week",
    date: plan.startAt,
    plan: plan.id,
  });
  return `/work-plans?${params.toString()}`;
}

// 区块成员、计数与顺序全部来自服务端（同一求值时刻），前端不再二次分组或排序。
export default function OverviewPage() {
  const overview = useQuery({
    queryKey: ["workbench-overview"],
    queryFn: () => api<WorkbenchOverview>("/workbench/overview?limit=50"),
    refetchInterval: 30_000,
  });
  const today = toLocalDateString(new Date());
  const remindersQuery = useQuery({
    queryKey: ["reminders", today, today],
    queryFn: () => fetchReminders(today, today),
    refetchInterval: 30_000,
  });
  const data = overview.data;
  const todayReminders = remindersQuery.data?.days.find((day) => day.date === today)?.reminders ?? [];
  const reminderRows = todayReminders.flatMap((reminder) => reminder.plans.map((plan) => ({ type: reminder.type, reminder, plan })));
  const planGroups = data
    ? [
        { key: "starting-today", heading: "今日新开工", description: "开始时间是今天的计划", items: data.startingToday.items, viewAll: false },
        { key: "continuing-today", heading: "今日继续开工", description: "此前开工、今天仍在工期内的计划", items: data.continuingToday.items, viewAll: false },
        { key: "upcoming", heading: "接下来的计划", description: "未来 7 个工作日内开工的计划", items: data.upcoming.items, viewAll: true },
      ]
    : [];
  const showEmptyState = !overview.isLoading && reminderRows.length === 0 && planGroups.every((group) => group.items.length === 0);
  const summary = [
    { label: "全部计划", value: data?.summary.all ?? 0, icon: CalendarClock },
    { label: "待开始", value: data?.summary.pending ?? 0, icon: Clock3 },
    { label: "进行中", value: data?.summary.inProgress ?? 0, icon: PlayCircle },
    { label: "已完成", value: data?.summary.completed ?? 0, icon: CircleCheckBig },
  ];
  return (
    <section className="content-page narrow-page overview-page">
      <header className="page-header"><div><h1>工作台</h1><p>今天需要关注的工作计划，一眼看清。</p></div><Link className="primary-button" to="/work-plans">打开时间轴<ArrowRight /></Link></header>
      <div className="summary-rail">{summary.map(({ label, value, icon: Icon }) => <div key={label}><Icon /><span><strong>{value}</strong><small>{label}</small></span></div>)}</div>
      <div className="overview-panels">
        {reminderRows.length > 0 ? (
          <section className="upcoming-section reminder-section">
            <header><div><h2>今日提醒</h2><p>今天提醒日的提醒与错过仍待处理的计划</p></div></header>
            <div className="reminder-list">{reminderRows.map(({ type, reminder, plan }) => <Link to={workPlanTimelineLink(plan)} key={`${reminder.type}-${plan.id}`}><span className={`reminder-type reminder-type-${type}`}>{reminderTypeLabels[type]}</span><span className="upcoming-title"><strong>{plan.title}</strong><small>开始 {formatDate(plan.startAt, true)}{reminder.originalDate ? ` · 原提醒日 ${formatDate(`${reminder.originalDate}T00:00:00`)}` : ""}</small></span><ArrowRight /></Link>)}</div>
          </section>
        ) : null}
        {planGroups.map(({ key, heading, description, items, viewAll }) => items.length === 0 ? null : (
          <section className="upcoming-section" key={key}>
            <header><div><h2>{heading}</h2><p>{description}</p></div>{viewAll ? <Link to="/work-plans">查看全部<ArrowRight /></Link> : null}</header>
            <div className="upcoming-list">{items.map((plan) => <Link to={workPlanTimelineLink(plan)} key={plan.id}><span className={`upcoming-date status-rail-${plan.status}`}><strong>{new Date(plan.startAt).getDate()}</strong><small>{new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(new Date(plan.startAt))}</small></span><span className="upcoming-title"><strong>{plan.title}</strong><small>{formatDate(plan.startAt, true)} — {formatDate(plan.endAt, true)}</small></span><StatusBadge status={plan.status} /><ArrowRight /></Link>)}</div>
          </section>
        ))}
        {showEmptyState ? (
          <section className="upcoming-section">
            <div className="upcoming-list"><div className="empty-state"><CircleCheckBig /><h3>今天没有需要关注的工作计划</h3><p>前往工作计划页面创建下一项安排。</p></div></div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
