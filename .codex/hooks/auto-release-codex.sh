#!/usr/bin/env bash
# Codex Stop-hook adapter for the existing ZCode release hook.
set -u

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
HOOK="${PROJECT_ROOT}/.zcode/hooks/auto-release.sh"
LOG_FILE="${PROJECT_ROOT}/.zcode/hooks/auto-release.log"
REVIEW_MARKER="${PROJECT_ROOT}/.zcode/hooks/review-approved.sha"
FINGERPRINT_SCRIPT="${PROJECT_ROOT}/.codex/hooks/tree-fingerprint.sh"

if [ -z "$PROJECT_ROOT" ] || [ ! -x "$HOOK" ]; then
  printf '%s\n' '{"continue":true,"systemMessage":"auto-release：未执行（本地脚本缺失或不可执行）。"}'
  exit 0
fi

# 只有本轮 dirty diff 已由 code-reviewer 子代理确认后才允许提交/发布。
# 主代理在审查通过后调用 approve-review.sh 写入当前工作树指纹；缺失或过期时只提示。
CURRENT_TREE="$(git status --porcelain=v1; git diff --binary; git ls-files --others --exclude-standard)"
CURRENT_FINGERPRINT=""
if [ -r "$FINGERPRINT_SCRIPT" ]; then
  # shellcheck source=/dev/null
  . "$FINGERPRINT_SCRIPT"
  CURRENT_FINGERPRINT="$(tree_fingerprint "$PROJECT_ROOT")"
fi
APPROVED_FINGERPRINT="$(cat "$REVIEW_MARKER" 2>/dev/null || true)"
if [ -n "$CURRENT_TREE" ] && { [ -z "$CURRENT_FINGERPRINT" ] || [ "$APPROVED_FINGERPRINT" != "$CURRENT_FINGERPRINT" ]; }; then
  printf '%s\n' '{"continue":true,"systemMessage":"WorkPlan 自动发布已跳过：等待 code-reviewer 子代理审查通过。"}'
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
    printf '%s\n' '{"continue":true,"systemMessage":"WorkPlan 自动发布完成：测试、审查、提交、推送和 hk3 验收均通过。"}'
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
  review-needed)
    printf '%s\n' '{"continue":true,"systemMessage":"WorkPlan 自动发布已跳过：等待 code-reviewer 子代理审查通过。"}'
    ;;
  failed)
    printf '%s\n' '{"continue":true,"systemMessage":"auto-release：失败（查看 .zcode/hooks/auto-release.log）。"}'
    ;;
  *)
    printf '%s\n' '{"continue":true,"systemMessage":"auto-release：未取得结果（查看 .zcode/hooks/auto-release.log）。"}'
    ;;
esac
exit 0
