# Work Planning

This context describes a personal system for scheduling and following work. Every user-visible work item is a Work Plan; there is no separate task or project container.

## Language

**Work Plan**:
A single scheduled piece of work with its own status, time range, extensible properties, and recurrence.
_Avoid_: Task, project, child plan

**Work Plan Time Range (工作计划时间范围)**:
The half-open interval from a Work Plan's inclusive start instant to its exclusive end instant. A local calendar day uses the same half-open boundary in Asia/Shanghai, so an item ending exactly at midnight does not occupy the new day.
_Avoid_: Inclusive end range, end-day occupancy

**Work Content (工作内容)**:
The required single-line title of a Work Plan; it is the Work Plan's primary identity in the plan list, exports, and Gantt displays. Distinct from the long-text Description field.
_Avoid_: Description, 说明, long text

**Gantt Fullscreen Mode (甘特图全屏模式)**:
A temporary Work Plan page state that focuses the view on the Gantt panel by hiding page navigation and page-level actions while retaining the Work Content list, time axis, and Gantt controls. It ends when the user leaves the page or reloads it.
_Avoid_: Browser fullscreen, native fullscreen

**Schedule Order (排期顺序)**:
The canonical total order for Work Plans: earlier start first, then later end first, then earlier creation first, with identity as the final stable tie-breaker. It is the default and fallback order rather than a manually maintained rank.
_Avoid_: Manual order, task priority, `sortOrder`

**Explicit Sort (显式排序)**:
The user-defined ordering for the Work Plan page: zero to five distinct sortable fields, each ascending or descending, applied ahead of the Schedule Order tie-breaker. It is expressed in the sort panel, the URL `sort=` parameter, and per-account preferences, and drives the table, Gantt, and XLS export alike; it is never a stored rank on Work Plans.
_Avoid_: Manual order, drag rank, `sortOrder`, 人工排序

**Automatic Status**:
The effective Work Plan status derived from its time range: pending before the start, in progress during the range, and completed after the end.
_Avoid_: Default status, calculated flag

**Manual Status Override**:
A user-selected Work Plan status that remains authoritative instead of following Automatic Status; cancellation is always a manual override.
_Avoid_: Forced status, locked status

**Recurring Rule**:
A schedule that creates independent future Work Plan occurrences at a daily, weekly, or monthly cadence.
_Avoid_: Recurring task, cron job

**Occurrence**:
One independently editable Work Plan created by a Recurring Rule for a specific scheduled time.
_Avoid_: Child task, recurrence copy

**Custom Field**:
A globally defined, typed property that can be attached to every Work Plan without changing the Work Plan's built-in attributes.
_Avoid_: Metadata blob, task field

**Option Order (选项顺序)**:
The administrator-maintained sequence of a select Custom Field's options. It is authoritative for option display everywhere and for single_select Work Plan sorting; it is never derived from option label text.
_Avoid_: 标签排序, label sort, alphabetical order

**Field Collapse (字段折叠)**:
An Administrator-maintained flag on a Custom Field definition that presents the field inside the collapsed "更多信息" section at the bottom of the Work Plan drawer, in every drawer mode. The field stays viewable and editable once the section is expanded; the flag never hides the field, changes its data, or affects any view other than the drawer.
_Avoid_: 隐藏字段, Hidden field, drawer visibility, 浏览器列设置

**Remarks (备注)**:
The single_select Custom Field (key `remarks`) classifying a Work Plan's work category, with Administrator-maintained options (currently 值班, 自动化, 网络安全). It is the field the Gantt Color Coding reads.
_Avoid_: notes, comment, 工作类别, work type

**Option Color (选项颜色)**:
An optional color on a single_select Custom Field option, chosen from a fixed Administrator-facing palette that stays readable in both light and dark themes. An option without a color falls back to the neutral Gantt bar color; an archived option never contributes color.
_Avoid_: status color, theme color pair, free-form hex

**Gantt Color Coding (甘特颜色编码)**:
The rule that a Gantt bar takes its fill from the Work Plan's Remarks Option Color — neutral gray when Remarks is unset or holds an archived option — with the Owner Conflict alert color overriding any classification color. Status carries no visual encoding on the Gantt, neither bar color nor progress shading, and may appear only as an opt-in bar/tooltip text property. The Gantt legend lists the unarchived Remarks options in Option Order plus an "unset" entry.
_Avoid_: status-colored bars, progress-by-status shading, 状态色

**Monthly Goal**:
A per-month work objective, defined by an Administrator or an Editor, with its own title, description, and month. It links to at most one Work Plan and derives its completion from that Work Plan's effective status.
_Avoid_: Goal tag, milestone, target

**Goal-Plan Link**:
The association connecting a Monthly Goal to a Work Plan. A Work Plan may carry several Goal-Plan Links for several Monthly Goals; a Monthly Goal accepts at most one Goal-Plan Link.
_Avoid_: Task-Goal Tag, task link, goal tag, free-form tag

**Derived Goal Status**:
The Monthly Goal status computed from its linked Work Plan's effective status, respecting any Manual Status Override. A Monthly Goal without a linked Work Plan is unlinked rather than having a status.
_Avoid_: Manual goal status, goal progress percentage

**Goal Recurrence**:
A Monthly Goal template plus a period rule (frequency monthly/quarterly/yearly × interval, ending at a count or a year-month). Creating or updating a Recurring Series immediately generates one independent Monthly Goal instance per period; instances stay independent (each can be edited, archived, deleted, or linked to a different Work Plan). Stopping a series only halts further generation and preserves the series; dissolving it deletes the rule, keeps the selected or previously used instances as ordinary Monthly Goals, and removes untouched generated instances.
_Avoid_: Goal template, auto-generated task

**Work Owner Account**:
A read-only Work Plan property derived at read and export time by mapping the `owner` Custom Field's displayed person name to an internally maintained account. It is not editable or stored on an individual Work Plan.
Its global name-to-account mappings are maintained by an Administrator in Settings; a mapping change applies immediately to every matching Work Plan.
_Avoid_: Account Custom Field, editable account snapshot

**Owner Conflict (负责人时段冲突)**:
A pairwise relation between two distinct active Work Plans whose `owner` Custom Field value is identical and non-empty and whose Work Plan Time Ranges intersect at exact instants (touching endpoints do not conflict). A draft or edited Work Plan participates only when its effective status under the draft values is active; editing excludes the persisted Work Plan itself, and editing an Occurrence evaluates only that Occurrence rather than future Occurrences in its Recurring Series. Conflicts never block selection or saving; they are computed globally by the server and surfaced as read-only alerts before and after an owner is selected, as well as on Gantt bars, plan list rows, and Gantt tooltips.
_Avoid_: 资源冲突, transitive conflict group, client-side conflict check

**Counterpart (冲突对象)**:
The other Work Plan in one Owner Conflict pair. A Work Plan's conflict list is exactly its Counterparts ordered by start time; overlapping plans that are not pairwise intersecting never appear in it.
_Avoid_: 冲突组, related plans

**Administrator**:
The account responsible for access management, data import, and global Work Plan definitions.
_Avoid_: Owner, superuser

**Editor**:
A password or Token-authenticated account that can query and change business data without managing access or global definitions.
_Avoid_: Collaborator, limited administrator

**Viewer**:
A password or Token-authenticated account that can query and export all business data without changing business data or managing access or global definitions.
_Avoid_: Read-only Editor, Reader, Observer, Query Account

**Token-only Account**:
A kind of Editor or Viewer that authenticates external API requests with an issued access Token and has no password login or Web workbench access.
_Avoid_: API user, service account

**Account Deletion (账户删除)**:
The irreversible removal of an Editor or Viewer account record by an Administrator, which revokes every session and access Token of that account via cascade. It complements Disabled Account (reversible). Only non-admin accounts can be deleted, and an account can never delete itself.
_Avoid_: remove user, 注销账户, 清理账户

**Disabled Account (停用账户)**:
An Editor or Viewer account that cannot authenticate but keeps its record, Tokens, and audit history, so it can be re-enabled later. _Avoid_: deleted account, blocked account

**Environment Configuration Package**:
A versioned JSON document that bundles the global, environment-specific definitions — Custom Field definitions, Work Owner Account mappings, and XLS export templates — so they can be moved between environments or restored into a fresh one.
_Avoid_: 配置快照, 迁移包, 模板包

**Additive Import**:
The default import mode for an Environment Configuration Package: adds definitions whose stable key is absent locally, skips those that already exist, and reports every skip.
_Avoid_: Merge import, incremental import

**Sync Import**:
An optional import mode that converges the target environment to match the package: safe changes apply, destructive changes are confirmed from a graded preview, and a local definition absent from the package is archived rather than physically deleted.
_Avoid_: Replace import, destructive import

**Destructive Change**:
A Sync Import change that would invalidate existing values or retire a definition — archiving a Custom Field or option, making a field required, or a field type conflict. Type conflicts are reported, never migrated.
_Avoid_: Breaking change, lossy change
**Reminder (提醒)**:
A date-bound prompt derived from Work Plan data by a Reminder Rule, surfaced to users on its Reminder Date. A Reminder carries no per-user state.
_Avoid_: Notification, alert

**Reminder Rule (提醒规则)**:
An entry in the code-level reminder rule table: a trigger condition over a Work Plan's Custom Field values and effective status, the Reminder Date computation, and the prompt text.
_Avoid_: Hardcoded notification, cron job

**Reminder Date (提醒日)**:
The calendar date a Reminder is attached to.
_Avoid_: Due date, 截止日

**Working Day (工作日)**:
A calendar day that is neither Saturday nor Sunday; reminder date arithmetic counts only Working Days.
_Avoid_: Business day, 营业日

**Work Order Reminder (检修单提醒)**:
A Reminder to raise a Maintenance Work Order, attached seven Working Days before the start of a pending Work Plan marked Work Order Required.
_Avoid_: 工单提醒

**Plan Submission Reminder (作业计划提交提醒)**:
A Reminder on Wednesday of the current week to submit next week's work plans, produced when any Work Plan whose Risk Level is 中 or 高 overlaps the next calendar week (Monday to Sunday).
_Avoid_: Weekly report reminder

**Maintenance Work Order (检修单)**:
The work-order document that must be raised before work on a Work Plan marked Work Order Required begins.
_Avoid_: 工单, repair ticket

**Work Order Required (需检修单)**:
The boolean Custom Field (key `ticket`) marking a Work Plan as requiring a Maintenance Work Order; defaults to unchecked.
_Avoid_: Needs-ticket flag

**Risk Level (风险等级)**:
The single_select Custom Field (key `risk`) on a Work Plan rating the riskiness of the work; values 可接受, 低, 中, 高; defaults to 低.
_Avoid_: Priority, severity

**Plan Nature (计划性质)**:
The single_select Custom Field (key `plan_nature`) on a Work Plan classifying the work as 生产类 or 非生产类; it may be left unset and has no default.
_Avoid_: 工作类别, Work Class, work type

**Bark Push (Bark 推送)**:
The output channel that repeats a Work Order Reminder to the single Bark device configured by the Administrator. One push is sent daily at 09:30 Asia/Shanghai, starting on the Reminder Date and ending the day before the Work Plan starts; pushing stops immediately when the plan is cancelled or manually completed. An empty device key disables pushing. The push is text-only (no deep link).
_Avoid_: 推送通知, notification, push notification

**Starting Today (今日新开工)**:
A non-cancelled Work Plan whose local start day is today, including one already completed later that day. It is listed in the workbench group of the same name and is mutually exclusive with the other plan groups.
_Avoid_: New task today, first-day plan

**Continuing Today (今日继续开工)**:
A non-completed, non-cancelled Work Plan that started before today and whose Work Plan Time Range intersects today. It leaves the group at its exclusive end instant and is mutually exclusive with the other plan groups.
_Avoid_: Ongoing work, in-progress filter

**Upcoming Window (接下来的窗口)**:
The calendar range after today through the seventh Working Day from today, including the boundary and intervening weekends. The workbench 接下来的计划 group lists non-completed, non-cancelled Work Plans whose local start day falls in this window, regardless of end day.
_Avoid_: Next week, seven-day window

**Production Work (生产类工作)**:
A Work Plan whose Plan Nature is 生产类; an unset or 非生产类 Plan Nature is not Production Work. The workbench plan groups and the workbench status summary cover Production Work only; Reminders are independent of Plan Nature.
_Avoid_: 生产计划, production plan, 生产任务

**Week View (周视图)**:
The Gantt presentation showing exactly one calendar week at a time — Monday 00:00 to the next Monday 00:00, sharing the Work Plan Time Range's half-open boundary. Navigating moves week by week, and a Work Plan appears in every week its Time Range intersects.
_Avoid_: frappe Week view mode, seven-day window

**Month View (月视图)**:
The Gantt presentation showing exactly one calendar month at a time; navigating moves month by month, and a Work Plan appears in every month its Time Range intersects.
_Avoid_: frappe Month view mode

**Visible Segment (可见条段)**:
The intersection of a Work Plan's Time Range with the range a Week View or Month View presents — the part of its Gantt bar that can appear in that view. A plan shown in a view always has a non-empty Visible Segment in it.
_Avoid_: clipped bar, week slice, 残段

**Gantt Bar Label (甘特条内文字)**:
The single line of text shown with a Gantt bar, composed of the plan's selected Gantt bar display properties in order. It is centered on the bar's Visible Segment, always kept inside the presented range, and truncated with an ellipsis only when that range cannot hold it; the Gantt tooltip always carries the full content.
_Avoid_: bar title, task name label, 条外文字
