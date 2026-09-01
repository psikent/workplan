# Ship the web app as an installable PWA with an offline app shell

Status: accepted

The web app gains PWA support scoped to installability plus an offline app shell: vite-plugin-pwa (workbox GenerateSW) precaches the built assets, a Web App Manifest makes「工作计划」installable on desktop and mobile home screens, and SPA navigations fall back to the precached `index.html` when offline. API traffic (`/api`, `/health`) never passes through the service worker — no response caching, no offline fallback — so the cookie session, CSRF header, and data freshness semantics are untouched; when offline the shell opens and data requests fail visibly. New versions use a prompt-and-reload flow (`registerType: 'prompt'`) rather than silent auto-reload, to avoid discarding in-progress edits.

Static cache headers become part of the serving contract: content-hashed `assets/*` get `public, max-age=31536000, immutable`, `sw.js` gets `public, max-age=0, must-revalidate`, and everything else (including the SPA fallback `index.html` and the manifest) gets `no-cache`.

## Considered Options

- **Manifest only (no service worker)** — rejected because offline launches show a dead "正在载入…" screen (the bootstrap fetch has no failure branch) and releases get no cache discipline.
- **Offline read-only data (persisted query cache)** — deferred because it drags cookie/CSRF semantics and cache-invalidation policy into the service worker; the shell-only scope already delivers install + offline launch.
- **Silent auto-update** — rejected because an automatic reload mid-edit would discard unsaved work; the prompt flow keeps the user in control.
- **Hand-rolled service worker** — rejected because workbox GenerateSW via vite-plugin-pwa already handles precache manifesting of Vite's hashed output and waiting-worker lifecycle with no bespoke cache-versioning code to maintain.

## Consequences

- The app is installable; offline launches reach the cached shell, which shows an explicit offline/retry state instead of data.
- Deployments ship `sw.js` + manifest inside `apps/web/dist`; the release pipeline is unchanged.
- New frontend chrome (offline banner, update prompt) must maintain dark-theme overrides per the existing styles.css convention.
- Precaching includes all lazy route chunks but excludes sourcemaps to keep the precache payload lean.
