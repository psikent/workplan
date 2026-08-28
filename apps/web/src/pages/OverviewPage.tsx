import { useQuery } from "@tanstack/react-query";
import { compareWorkPlansBySchedule, type ReminderType, type WorkPlan } from "@workplan/contracts";
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

export default function OverviewPage() {
  const plans = useQuery({ queryKey: ["work-plans"], queryFn: () => api<WorkPlan[]>("/work-plans?limit=500"), refetchInterval: 30_000 });
  const today = toLocalDateString(new Date());
  const remindersQuery = useQuery({
    queryKey: ["reminders", today, today],
    queryFn: () => fetchReminders(today, today),
    refetchInterval: 30_000,
  });
  const data = plans.data ?? [];
  const now = Date.now();
  const upcoming = [...data]
    .filter((plan) => !["completed", "cancelled"].includes(plan.status) && Date.parse(plan.endAt) >= now)
    .sort(compareWorkPlansBySchedule)
    .slice(0, 6);
  const todayReminders = remindersQuery.data?.days.find((day) => day.date === today)?.reminders ?? [];
  const reminderRows = todayReminders.flatMap((reminder) => reminder.plans.map((plan) => ({ type: reminder.type, reminder, plan })));
  const summary = [
    { label: "全部计划", value: data.length, icon: CalendarClock },
    { label: "待开始", value: data.filter((plan) => plan.status === "pending").length, icon: Clock3 },
    { label: "进行中", value: data.filter((plan) => plan.status === "in_progress").length, icon: PlayCircle },
    { label: "已完成", value: data.filter((plan) => plan.status === "completed").length, icon: CircleCheckBig },
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
        <section className="upcoming-section">
          <header><div><h2>接下来的工作计划</h2><p>按开始时间排列的未完成计划</p></div><Link to="/work-plans">查看全部<ArrowRight /></Link></header>
          <div className="upcoming-list">{upcoming.map((plan) => <Link to={workPlanTimelineLink(plan)} key={plan.id}><span className={`upcoming-date status-rail-${plan.status}`}><strong>{new Date(plan.startAt).getDate()}</strong><small>{new Intl.DateTimeFormat("zh-CN", { month: "short" }).format(new Date(plan.startAt))}</small></span><span className="upcoming-title"><strong>{plan.title}</strong><small>{formatDate(plan.startAt, true)} — {formatDate(plan.endAt, true)}</small></span><StatusBadge status={plan.status} /><ArrowRight /></Link>)}{!plans.isLoading && upcoming.length === 0 ? <div className="empty-state"><CircleCheckBig /><h3>当前没有待跟进计划</h3><p>前往工作计划页面创建下一项安排。</p></div> : null}</div>
        </section>
      </div>
    </section>
  );
}
