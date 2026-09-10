#!/usr/bin/env bash
# Codex Stop-hook adapter for the existing ZCode release hook.
# The underlying script keeps its ZCode output protocol; Codex needs a valid
# Stop-hook JSON response, so the adapter suppresses the underlying stdout and
# returns a non-blocking Codex response after the release check completes.
set -u

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
HOOK="${PROJECT_ROOT}/.zcode/hooks/auto-release.sh"

if [ -z "$PROJECT_ROOT" ] || [ ! -x "$HOOK" ]; then
  printf '%s\n' '{"continue":true,"systemMessage":"auto-release：未执行（本地脚本缺失或不可执行）。"}'
  exit 0
fi

STATUS_FILE="$(mktemp "${TMPDIR:-/tmp}/workplan-auto-release-codex.XXXXXX" 2>/dev/null || true)"
if [ -z "$STATUS_FILE" ]; then
  printf '%s\n' '{"continue":true,"systemMessage":"auto-release：未执行（无法创建状态文件）。"}'
  exit 0
fi

cleanup() { rm -f "$STATUS_FILE" "${STATUS_FILE}.tmp"; }
trap cleanup EXIT

AUTO_RELEASE_STATUS_FILE="$STATUS_FILE" "$HOOK" >/dev/null 2>&1 || true
STATUS="$(cat "$STATUS_FILE" 2>/dev/null || true)"

case "$STATUS" in
  success)
    printf '%s\n' '{"continue":true,"systemMessage":"auto-release：发布成功。"}'
    ;;
  noop)
    printf '%s\n' '{"continue":true,"systemMessage":"auto-release：无需发布。"}'
    ;;
  skipped)
    printf '%s\n' '{"continue":true,"systemMessage":"auto-release：已跳过。"}'
    ;;
  dry-run)
    printf '%s\n' '{"continue":true,"systemMessage":"auto-release：演练完成。"}'
    ;;
  failed)
    printf '%s\n' '{"continue":true,"systemMessage":"auto-release：失败（查看 .zcode/hooks/auto-release.log）。"}'
    ;;
  *)
    printf '%s\n' '{"continue":true,"systemMessage":"auto-release：未取得结果（查看 .zcode/hooks/auto-release.log）。"}'
    ;;
esac
exit 0
