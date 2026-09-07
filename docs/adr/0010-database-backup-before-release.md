# Snapshot the production database before every Linux release

Status: accepted

Every systemd release snapshots the live SQLite database (online `sqlite3 .backup`, consistent under WAL) into `data/pre-release-backups/` before the service is stopped, keeping the five most recent snapshots. The snapshot is verified with `PRAGMA integrity_check`; a missing `sqlite3` CLI, a failed snapshot, or a failed verification aborts the release before any file is promoted or the service is touched. A fresh install without an existing database skips the step.

## Context

The application applies its own SQLite migrations at startup, so a release can carry irreversible schema changes without the release flow knowing about them (2026-09-07: migration 13 dropped the legacy `work_plans.sort_order` column). Until then the release flow only rolled back program files, `.env`, and the unit — a broken migration could not be recovered quickly, and the work-plan ordering spec made a recoverable database backup a hard precondition for that column drop. This ADR makes that precondition a permanent part of every release instead of a one-off manual step.

## Considered Options

- **Keep backups manual (ad-hoc `better-sqlite3` scripts over SSH)** — rejected as the default: it relied on remembering, and the server initially lacked a usable CLI, which made each backup an improvisation.
- **Warn but continue when the snapshot fails** — rejected: the backup exists precisely for the releases that break, and a release cannot know in advance whether it carries migrations.
- **Snapshot inside the application at startup** — rejected: it runs after migrations, which is too late to protect against them.

## Consequences

- `sqlite3` CLI is a hard release dependency on Linux production hosts (`apt-get install sqlite3`; Ubuntu 22.04 ships 3.37, file-format compatible with the SQLite 3.53 bundled in better-sqlite3).
- Releases that cannot produce a verified snapshot fail closed; routine releases pay a few seconds for the snapshot.
- Snapshots are 0600 inside the service-owned `data/` directory; manually named backup files are never pruned by the retention pass.
- CLI access stays read/backup-only — production writes must go through the application API (optimistic version locking, sort-key recomputation, and foreign-key actions live in the application layer).
- The legacy macOS launchd / manual release path does not perform the snapshot; Linux systemd remains the only formal production target.
