#!/usr/bin/env bash
# One-shot GitHub push for GAVEL → VampFay/GAVEL.
# Token is passed via env var (never written to any file or .git/config).
# Usage: GAVEL_GH_TOKEN=<pat> bash scripts/push-github.sh
set -euo pipefail
cd /home/z/my-project

: "${GAVEL_GH_TOKEN:?GAVEL_GH_TOKEN env var required}"
TOKEN="$GAVEL_GH_TOKEN"
REPO="VampFay/GAVEL"
URL="https://x-access-token:${TOKEN}@github.com/${REPO}.git"
CLEAN_URL="https://github.com/${REPO}.git"

echo "== 1. Repo state via API =="
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}" > /tmp/repo.json
python3 - <<'EOF'
import json
d = json.load(open('/tmp/repo.json'))
if 'full_name' not in d:
    print('API ERROR:', d.get('message'), d.get('documentation_url', ''))
else:
    print(f"repo: {d['full_name']} | private: {d['private']} | default: {d.get('default_branch')} | size: {d.get('size')} KB")
EOF

echo "== 2. Remote refs =="
REFS=$(git ls-remote "$URL" 2>/dev/null || true)
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
BRANCH=$(git branch --show-current)
echo "local branch: $BRANCH | HEAD: $(git rev-parse HEAD)"
PUSH_FLAGS=""
[ "${FORCE:-0}" = "1" ] && PUSH_FLAGS="--force"
git push $PUSH_FLAGS "$URL" "${BRANCH}:main" 2>&1 | sed "s/${TOKEN}/***/g"

echo "== 4. Verify by SHA =="
sleep 2
REMOTE_SHA=$(git ls-remote "$URL" refs/heads/main 2>/dev/null | awk '{print $1}')
LOCAL_SHA=$(git rev-parse "refs/heads/${BRANCH}")
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
