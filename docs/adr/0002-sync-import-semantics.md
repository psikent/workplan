# Sync Import archives, never deletes; type conflicts are reported, never migrated

The Environment Configuration Package supports Additive Import (default) and an optional Sync Import that converges the target environment to match the package. Converging must not silently destroy data: a Custom Field or option absent from the package is **archived**, not physically deleted; every change is graded safe or destructive in the preview; and a field whose type differs from the package is **reported and skipped** — there is no automatic type migration.

## Considered Options

- **Physical deletion on sync** — rejected: Work Plan values reference definitions and options; deleting them orphans or invalidates stored values.
- **Automatic type migration** — rejected: conversion semantics (e.g. text → number) for existing values are undefined per type pair; a bad migration is worse than a reported conflict.
- **Chosen**: archive-not-delete, graded preview, type conflicts skipped and reported.

## Consequences

- Sync Import runs against populated environments, but destructive changes require explicit confirmation.
- Archived Custom Fields keep their stored values; they stop validating and stop appearing.
- The package can never change a Custom Field's type — consistent with the rest of the API, which has no type-change operation either.
- Mappings and templates carry no attached data, so sync deletes them outright when absent from the package.
