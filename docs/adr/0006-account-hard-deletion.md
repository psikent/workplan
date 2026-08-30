# Hard-delete non-admin accounts with cascading credential revocation

Account management already supports disabling an Editor or Viewer (reversible). Some accounts, however, exist only for temporary API access or a short-term contractor period, and the Administrator wants the account record gone — not merely locked. We therefore add a hard delete path alongside disable.

## Considered Options

- **Reuse disable for everything** — rejected: disabled accounts accumulate forever, Tokens stay stored, and the UI offers no way to actually remove a credential lineage.
- **Soft-delete with a tombstone flag** — rejected: it keeps sessions/access Tokens conceptually alive, adds a third state to every query, and contradicts the existing `CASCADE` foreign keys which already define what happens when a user row disappears.
- **Chosen: hard delete of non-admin accounts, guarded at both route and service level** — `DELETE /api/v1/users/:id` removes the row; `sessions` and `access_tokens` rows are revoked via the existing `ON DELETE CASCADE`. Only `editor`/`viewer` accounts are deletable; deleting an `admin` account or deleting yourself is rejected with 400, keeping the system self-locking safe.

## Consequences

- Account Deletion irrevocably revokes the account's Web sessions and API Tokens; the caller must confirm in the UI before issuing the call.
- Business data (Work Plans, Monthly Goals, Custom Field Values, Owner Account Mappings) has no foreign key to `users`, so deleting an account never touches business data.
- Disabled Account remains the reversible path; the UI keeps both actions side by side and distinguishes them in the confirmation copy.
- Optimistic locking (`version`) follows the existing `PATCH /users/:id` convention; version conflicts surface as the existing `409 VERSION_CONFLICT`.
