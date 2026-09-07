# Retire manual work plan `sortOrder` in favor of schedule order and user sort

Status: accepted

Work plans have no manual ranking. Display order is always: scenario filter → user-defined sort (zero to five fields on the work-plan page) → the fixed schedule order (`startAt` asc, `endAt` desc, `createdAt` asc, `id` asc) as the final tie-breaker. The legacy manual `sort_order` column, its index, and the `POST /api/v1/work-plans/reorder` endpoint are removed entirely; the JSON business backup format is version 5 and importers accept versions 1–4 by ignoring legacy keys. Custom field and option `sortOrder` are unrelated and untouched (see ADR-0009).

## Context

A `sort_order` column and reorder API predated the unified query engine but no UI exposed manual ranking, and the stored numbers did not match actual display order — a meaning-conflict with the schedule order that everything else sorts by. The work-plan ordering spec retired it in four phases: stop reading (ticket 08–13), stop publishing and turn the reorder route into a side-effect-free `410 Gone` tombstone with zero-call logging (ticket 14), keep the column and backup compatibility through a 14-day production observation window (tickets 15–16), and finally rebuild the table without the column (ticket 17, migration 13, 2026-09-07). Legacy values were never migrated into sort preferences or any business priority.

## Consequences

- Migration 13 rebuilds `work_plans` without `sort_order` and drops `work_plans_sort_idx`; all other constraints, foreign keys, and indexes are preserved. The migration runs automatically at startup and is irreversible in place.
- Rollback path for an older binary: `apps/server/scripts/forward-fix-sort-order.ts` transactionally re-adds `sort_order` (neutral `0`) and the index without a full-database restore.
- `POST /api/v1/work-plans/reorder` now 404s; the `WORK_PLAN_REORDER_RETIRED` error code is gone from the public contract. The work-plan page sort panel, URL `sort=` parameter, and per-account preferences are the only ordering controls.
- JSON business backup exports `schemaVersion: 5`; importers of versions 1–4 silently drop the legacy column via target-table column filtering (see ADR-0010 for the pre-release database snapshots that back this migration path).
