# Use systemd and a dedicated non-root account for Linux production

Status: accepted

Linux formal releases use `workplan.service` as the only application process supervisor, with the Node process fixed to `workplan:workplan`; root privileges may deploy files and control systemd but may not run the application. Installing or replacing the unit requires the explicit `--install-systemd` release option so an ordinary release cannot silently rewrite host configuration, and a missing or unsafe unit causes the release to stop instead of falling back to the detached process manager.

## Considered Options

- **Continue using `workplan.mjs` on Linux** — rejected because the application inherits the release command's identity and a sudo release can create a root-owned production process outside systemd.
- **Install or rewrite the unit on every release** — rejected because routine application deployment should not implicitly replace host-level configuration.
- **Run releases as an unprivileged deploy account with narrow sudo rules** — deferred because it requires a separate host authorization model; the chosen boundary already separates root deployment from non-root application execution.

## Consequences

- Linux formal releases require root/sudo for deployment and systemd control, while the application always runs without root privileges.
- The managed unit, runtime ownership, loopback listener, process identity, and ready health become release acceptance criteria and rollback gates.
- macOS launchd and isolated `--no-start` releases remain supported; Linux production does not fall back to manual PID management.
