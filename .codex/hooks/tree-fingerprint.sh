#!/usr/bin/env bash
# Stable fingerprint for the current tracked and untracked worktree contents.
set -u

tree_fingerprint() {
  local project_root="${1:-$(git rev-parse --show-toplevel)}"
  (
    cd "$project_root" || exit 1
    git rev-parse HEAD^{tree}
    git status --porcelain=v1
    git diff --cached --binary
    git diff --binary
    git ls-files --others --exclude-standard | sort | while IFS= read -r path; do
      git diff --no-index --binary /dev/null "$path" || true
    done
  ) | sha256sum | awk '{print $1}'
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  tree_fingerprint "${1:-$(git rev-parse --show-toplevel)}"
fi
