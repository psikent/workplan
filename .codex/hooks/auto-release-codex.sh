#!/usr/bin/env bash
# Codex Stop-hook adapter for the existing ZCode release hook.
# The underlying script keeps its ZCode output protocol; Codex needs a valid
# Stop-hook JSON response, so the adapter suppresses the underlying stdout and
# returns a non-blocking Codex response after the release check completes.
set -u

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
HOOK="${PROJECT_ROOT}/.zcode/hooks/auto-release.sh"
LOG_FILE="${PROJECT_ROOT}/.zcode/hooks/auto-release.log"

if [ -z "$PROJECT_ROOT" ] || [ ! -x "$HOOK" ]; then
  printf '%s\n' '{"continue":true,"systemMessage":"Codex auto-release requires the local ignored .zcode/hooks/auto-release.sh; this workspace prerequisite is missing or not executable."}'
  exit 0
fi

STATUS_FILE="$(mktemp "${TMPDIR:-/tmp}/workplan-auto-release-codex.XXXXXX" 2>/dev/null || true)"
if [ -z "$STATUS_FILE" ]; then
  printf '%s\n' '{"continue":true,"systemMessage":"Codex could not create the auto-release status file; no release check was run."}'
  exit 0
fi

cleanup() { rm -f "$STATUS_FILE" "${STATUS_FILE}.tmp"; }
trap cleanup EXIT

AUTO_RELEASE_STATUS_FILE="$STATUS_FILE" "$HOOK" >/dev/null 2>&1 || true
STATUS="$(cat "$STATUS_FILE" 2>/dev/null || true)"

case "$STATUS" in
  success|skipped|dry-run)
    printf '%s\n' '{"continue":true}'
    ;;
  failed)
    printf '%s\n' "{\"continue\":true,\"systemMessage\":\"WorkPlan auto-release failed; inspect ${LOG_FILE}\"}"
    ;;
  *)
    printf '%s\n' "{\"continue\":true,\"systemMessage\":\"WorkPlan auto-release did not report a result; inspect ${LOG_FILE}\"}"
    ;;
esac
exit 0
