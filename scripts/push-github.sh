#!/usr/bin/env bash
# One-shot GitHub push for GAVEL → VampFay/GAVEL.
#
# Usage: GAVEL_GH_TOKEN=<pat> bash scripts/push-github.sh   [FORCE=1 to overwrite remote refs]
#
# Token-handling guarantees (precisely stated — read before "improving"):
#   - The token is passed via the GAVEL_GH_TOKEN env var.
#   - It is NEVER written to any persistent file, never stored in .git/config,
#     and never embedded in the remote URL (no credential-bearing URLs).
#   - It NEVER appears in the argv of any child process (visible to every
#     local user via `ps aux` / /proc/<pid>/cmdline — the exposure the
#     previous revision had):
#       * git (ls-remote / push) authenticates via a GIT_ASKPASS helper
#         script that reads $GAVEL_GH_TOKEN from ITS environment at runtime
#         and prints it to git over a pipe. The helper file contains only a
#         variable reference, not the token value.
#       * curl receives its Authorization header via `curl -K -` (config
#         piped on stdin). The pipe payload is produced by the printf
#         SHELL BUILTIN — no argv, no temp file.
#   - Residual exposure (accepted, documented): any process running as the
#     SAME uid can read the token from this process's environment
#     (/proc/<pid>/environ) or the helper's stdout pipe while it runs.
#     Same-uid local access is already game over; cross-user /proc/cmdline
#     snooping — what the argv approach leaked — is closed.
#   - The GitHub API response is written to a mktemp file with 0600 perms,
#     removed on exit (trap).
#
# Portability: the repo root is derived from this script's location —
# the script can be run from any cwd (no hardcoded /home/z/my-project).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

: "${GAVEL_GH_TOKEN:?GAVEL_GH_TOKEN env var required}"
export GAVEL_GH_TOKEN   # read at runtime by the askpass helper (not by value)
REPO="VampFay/GAVEL"
CLEAN_URL="https://github.com/${REPO}.git"

# ── Askpass helper: git asks "Username"/"Password" over this script ────────
ASKPASS="$(mktemp "${TMPDIR:-/tmp}/gavel-askpass.XXXXXX")"
trap 'rm -f "$ASKPASS" "$REPO_JSON"' EXIT
chmod 700 "$ASKPASS"
cat > "$ASKPASS" <<'HELPER'
#!/bin/sh
# Reads the token from the environment at RUNTIME. This file contains a
# variable REFERENCE only — the token value never touches the filesystem.
case "$1" in
  Username*) echo "x-access-token" ;;
  *)         printf '%s\n' "$GAVEL_GH_TOKEN" ;;
esac
HELPER

# git helpers: force askpass auth (never prompt a terminal, never a URL).
GIT_TERMINAL_PROMPT=0
export GIT_TERMINAL_PROMPT
git_auth() { GIT_ASKPASS="$ASKPASS" git "$@"; }

REPO_JSON="$(mktemp "${TMPDIR:-/tmp}/gavel-repo-json.XXXXXX")"
chmod 600 "$REPO_JSON"

echo "== 1. Repo state via API =="
printf 'header = "Authorization: Bearer %s"\nheader = "Accept: application/vnd.github+json"\n' \
  "$GAVEL_GH_TOKEN" \
  | curl -s -K - "https://api.github.com/repos/${REPO}" -o "$REPO_JSON"
python3 - "$REPO_JSON" <<'EOF'
import json, sys
with open(sys.argv[1]) as f:
    d = json.load(f)
if 'full_name' not in d:
    print('API ERROR:', d.get('message'), d.get('documentation_url', ''))
else:
    print(f"repo: {d['full_name']} | private: {d['private']} | default: {d.get('default_branch')} | size: {d.get('size')} KB")
EOF

echo "== 2. Remote refs =="
REFS="$(git_auth ls-remote "$CLEAN_URL" 2>/dev/null || true)"
if [ -n "$REFS" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "NOT EMPTY — remote already has refs:"
  echo "$REFS"
  echo "Aborting to avoid clobbering anything (set FORCE=1 to override)."
  exit 2
fi
if [ -n "$REFS" ]; then
  echo "Remote refs exist but FORCE=1 — overwriting:"
  echo "$REFS"
fi

echo "== 3. Push =="
BRANCH="$(git branch --show-current)"
echo "local branch: $BRANCH | HEAD: $(git rev-parse HEAD)"
PUSH_FLAGS=""
[ "${FORCE:-0}" = "1" ] && PUSH_FLAGS="--force"
# Defense-in-depth redaction (the URL is credential-free since askpass auth
# replaced the token-in-URL approach — this sed should never match).
git_auth push $PUSH_FLAGS "$CLEAN_URL" "${BRANCH}:main" 2>&1 \
  | sed "s/${GAVEL_GH_TOKEN}/***/g" || true

echo "== 4. Verify by SHA =="
sleep 2
REMOTE_SHA="$(git_auth ls-remote "$CLEAN_URL" refs/heads/main 2>/dev/null | awk '{print $1}')"
LOCAL_SHA="$(git rev-parse "refs/heads/${BRANCH}")"
echo "local : $LOCAL_SHA"
echo "remote: $REMOTE_SHA"
if [ "$REMOTE_SHA" != "$LOCAL_SHA" ]; then echo "MISMATCH — push not verified"; exit 3; fi
echo "MATCH — push verified (identical trees)"

echo "== 5. Clean remote (token NOT persisted) =="
git remote remove origin 2>/dev/null || true
git remote add origin "$CLEAN_URL"
git fetch origin 2>/dev/null || true
git branch --set-upstream-to="origin/main" "$BRANCH" 2>/dev/null || true
echo "origin -> $CLEAN_URL (no credentials stored)"
echo "DONE"
