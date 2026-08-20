# Work Planning

This context describes a personal system for scheduling and following work. Every user-visible work item is a Work Plan; there is no separate task or project container.

## Language

**Work Plan**:
A single scheduled piece of work with its own status, time range, extensible properties, and recurrence.
_Avoid_: Task, project, child plan

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

**Monthly Goal**:
A per-month work objective, defined by an Administrator or an Editor, with its own title, description, and month. It links to at most one Work Plan and derives its completion from that Work Plan's effective status.
_Avoid_: Goal tag, milestone, target

**Task-Goal Tag**:
The link marker on a Work Plan that references a Monthly Goal. A Work Plan may carry several Task-Goal Tags for several Monthly Goals; a Monthly Goal accepts at most one Task-Goal Tag.
_Avoid_: Free-form tag, label, remark tag

**Derived Goal Status**:
The Monthly Goal status computed from its linked Work Plan's effective status, respecting any Manual Status Override. A Monthly Goal without a linked Work Plan is unlinked rather than having a status.
_Avoid_: Manual goal status, goal progress percentage

**Work Owner Account**:
A read-only Work Plan property derived at read and export time by mapping the `owner` Custom Field's displayed person name to an internally maintained account. It is not editable or stored on an individual Work Plan.
Its global name-to-account mappings are maintained by an Administrator in Settings; a mapping change applies immediately to every matching Work Plan.
_Avoid_: Account Custom Field, editable account snapshot

**Administrator**:
The account responsible for access management, data import, and global Work Plan definitions.
_Avoid_: Owner, superuser

**Editor**:
A password or Token-authenticated account that can use the Work Plan workbench and read or change every Work Plan without managing access or global definitions.
_Avoid_: Collaborator, limited administrator

**Token-only Account**:
A kind of Editor that authenticates external API requests with an issued access Token and has no password login or Web workbench access.
_Avoid_: API user, service account

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
