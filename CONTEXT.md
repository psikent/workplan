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
