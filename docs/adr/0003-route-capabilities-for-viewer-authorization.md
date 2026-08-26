# Authorize Viewer access by route capability, not HTTP method

Viewer accounts may query and export all business data, but some existing query operations use `POST` because they accept structured input: Work Plan search and custom XLS export. Authorization therefore classifies authenticated routes by capability — query by default, `write` for business mutations, and `admin` for access or global-definition management — instead of treating every non-GET request as a write.

## Considered Options

- **Deny every non-GET request to a Viewer** — rejected because it would incorrectly block structured search and custom XLS export.
- **Maintain a Viewer allowlist of individual paths** — rejected because new routes could silently receive the wrong policy and the list would duplicate route intent.
- **Chosen: declare required capability on each protected route** — query operations remain available regardless of HTTP method, while write and administrator routes state their stronger requirement beside the handler.

## Consequences

- Every business mutation must declare `write` or `admin`; an unclassified authenticated route is query-capable.
- A Viewer calling a write or administrator route receives the existing `403 INSUFFICIENT_PERMISSION` response.
- CSRF and Origin checks remain based on request mechanics and continue to apply to session-authenticated non-safe requests, including query operations that use `POST`.
