#!/usr/bin/env bash
# Run by the primary Codex agent immediately after code-reviewer reports no P0/P1.
set -eu

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
FINGERPRINT_SCRIPT="${PROJECT_ROOT}/.codex/hooks/tree-fingerprint.sh"
MARKER="${PROJECT_ROOT}/.zcode/hooks/review-approved.sha"

if [ -z "$PROJECT_ROOT" ] || [ ! -r "$FINGERPRINT_SCRIPT" ]; then
  printf '%s\n' "无法生成审查标记：缺少项目或指纹脚本" >&2
  exit 1
fi

# shellcheck source=/dev/null
. "$FINGERPRINT_SCRIPT"
mkdir -p "$(dirname "$MARKER")"
tree_fingerprint "$PROJECT_ROOT" > "$MARKER"
printf '%s\n' "已记录当前工作树的 code-reviewer 审查通过标记"
