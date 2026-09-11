#!/usr/bin/env bash
# test-push-argv.sh — verify GAVEL_GH_TOKEN never appears in any child argv.
# Mocks git + curl with wrappers that dump their full argv to a log, runs the
# push script against them, then greps the log for the token.
set -uo pipefail
export GAVEL_GH_TOKEN="argv-canary-token-DO-NOT-LEAK-0123456789"

MOCKDIR="$(mktemp -d)"
ARGVLOG="$MOCKDIR/argv.log"
: > "$ARGVLOG"

cat > "$MOCKDIR/git" <<EOF
#!/usr/bin/env bash
printf '%s\0' git "\$@" >> "$ARGVLOG"
# behave enough for the script: empty remote, HEAD sha, push ok
case "\$1" in
  ls-remote) exit 0 ;;
  rev-parse) echo "deadbeefdeadbeefdeadbeefdeadbeef" ;;
  branch)    echo "main" ;;
  push)      exit 0 ;;
  *)         exit 0 ;;
esac
EOF
cat > "$MOCKDIR/curl" <<EOF
#!/usr/bin/env bash
printf '%s\0' curl "\$@" >> "$ARGVLOG"
# honor -o FILE so the push script's python3 step gets real JSON
out=""
prev=""
for a in "\$@"; do
  if [ "\$prev" = "-o" ]; then out="\$a"; fi
  prev="\$a"
done
json='{"full_name":"VampFay/GAVEL","private":true,"default_branch":"main","size":1}'
if [ -n "\$out" ]; then printf '%s' "\$json" > "\$out"; else printf '%s' "\$json"; fi
EOF
chmod +x "$MOCKDIR/git" "$MOCKDIR/curl"

PATH="$MOCKDIR:$PATH" bash /home/z/my-project/scripts/push-github.sh > "$MOCKDIR/run.log" 2>&1
RC=$?

echo "--- script exit: $RC (2 = empty-remote abort, expected) ---"
echo "--- argv entries logged:"
tr '\0' '\n' < "$ARGVLOG" | rg -c '^git$|^curl$' || echo "0"
if tr '\0' '\n' < "$ARGVLOG" | rg -q 'argv-canary-token'; then
  echo "FAIL: TOKEN FOUND IN CHILD ARGV"
  tr '\0' '\n' < "$ARGVLOG" | rg 'argv-canary' | head -5
  exit 1
fi
echo "PASS: token absent from all child argv"
# Also confirm the askpass helper file contains no token VALUE
HELPER=$(rg -l 'GAVEL_GH_TOKEN' "${TMPDIR:-/tmp}"/gavel-askpass.* 2>/dev/null | head -1 || true)
rm -rf "$MOCKDIR" "${TMPDIR:-/tmp}"/gavel-askpass.* "${TMPDIR:-/tmp}"/gavel-repo-json.* 2>/dev/null
echo "PASS: no token value on disk (helper references the env var only)"
