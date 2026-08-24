---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go. Use when the user proposes a new feature, a new requirement, or an extension of an existing one — grill first, then hand them a requirements plan for approval before any development.
---

Run a `/grilling` session (load the `grilling` skill and follow its interview protocol), using the `/domain-modeling` skill (load it and maintain the glossary and ADRs as the design tree settles).

When the interview is done — the frontier is empty and the user confirms the shared understanding — write the requirements plan: update the spec under `.scratch/<feature-slug>/spec.md` and the tickets under `.scratch/<feature-slug>/issues/` per `docs/agents/issue-tracker.md`, plus the glossary/ADR entries per `docs/agents/domain.md`.

Present that plan to the user and wait for explicit approval before starting any implementation.
