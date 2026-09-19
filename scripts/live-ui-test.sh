#!/bin/bash
# GAVEL — live UI QA harness (re-runnable).
#
# Boots the dev server, walks every surface with a real browser, and asserts
# the motion system v2 behaviors + the workflows underneath them. Run:
#
#   bash scripts/live-ui-test.sh          (from repo root; needs bun + agent-browser)
#
# Prereqs: deps installed, DB seeded (bun run db:push && bun run seed:dev —
# or click "Reset demo" in-app, which this script also exercises).
# Screenshots land in download/gavel-final-*.png. Exit code = number of failures.
#
# NOTE: run everything in ONE shell invocation — the sandbox may reap the dev
# server between tool calls (see worklog). This script is self-contained:
# boot → assert → teardown.
#
# NEVER `pkill -f "next dev"` — that also kills the PLATFORM-managed dev
# server (.zscripts/dev.sh flow), leaving the preview 502 with nothing to
# restart it. This harness kills ONLY the process group it spawned itself.
set -u
BOOT_PID=""
PLATFORM_SERVER=0
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2' want '$3'"; fi; }
poll_flash() {  # waits for .verdict-overlay mount within ~2s
  SEEN=0
  for p in $(seq 1 16); do
    F=$(agent-browser get count ".verdict-overlay")
    if [ "$F" -gt 0 ] 2>/dev/null; then SEEN=1; break; fi
    sleep 0.12
  done
  return $((1 - SEEN))
}

echo "=== [1/10] boot ==="
# If a server (e.g. the platform-managed one) already serves :3000, use it
# and skip spawning/teardown — we never kill what we didn't start.
if curl -s -m 2 -o /dev/null http://localhost:3000/api/health; then
  PLATFORM_SERVER=1
  ok "reusing already-running dev server (platform-managed)"
else
  # Plain nohup (no setsid): keeps the server a DESCENDANT of this script so
  # teardown can kill exactly this tree by walking children — never the
  # platform-managed server, never a re-parented stray.
  nohup bun run dev > /dev/null 2>&1 &
  BOOT_PID=$!
fi
CODE=000
for i in $(seq 1 90); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)
  [ "$CODE" = "200" ] && break
  sleep 1
done
chk "server health" "$CODE" "200"
[ "$CODE" != "200" ] && { tail -20 dev.log; exit 1; }

echo "=== [2/10] landing: scroll reveals ==="
agent-browser set viewport 1440 900 > /dev/null
agent-browser open http://localhost:3000/ > /dev/null
agent-browser wait --load networkidle > /dev/null
TOTAL=$(agent-browser get count ".reveal")
BEFORE=$(agent-browser get count ".reveal-in")
agent-browser scroll down 700 > /dev/null; sleep 0.4
agent-browser scroll down 700 > /dev/null; sleep 0.4
agent-browser scroll down 700 > /dev/null; sleep 0.6
AFTER=$(agent-browser get count ".reveal-in")
if [ "$AFTER" -gt "$BEFORE" ] 2>/dev/null; then ok "reveals fire on scroll ($BEFORE -> $AFTER / $TOTAL)"; else bad "reveals static ($BEFORE -> $AFTER)"; fi
RULES=$(agent-browser get count ".rule-ink")
[ "$RULES" -gt 0 ] 2>/dev/null && ok "rule-ink lines ($RULES)" || bad "no rule-ink"
agent-browser screenshot --full download/gavel-final-01-landing.png > /dev/null

echo "=== [3/10] login + dashboard ==="
agent-browser open http://localhost:3000/login > /dev/null
agent-browser wait --load networkidle > /dev/null
agent-browser fill "#email" "admin@gavel.demo" > /dev/null
agent-browser fill "#password" "gavel-admin-demo" > /dev/null
agent-browser find role button click --name "Sign in" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 1
SIGNED=$(agent-browser eval "document.body.innerText.includes('Case overview')")
[ "$SIGNED" = "true" ] && ok "authenticated shell reached" || bad "login failed"
KPI=$(agent-browser get count ".anim-row-in, .anim-panel-in")
[ "$KPI" -gt 0 ] 2>/dev/null && ok "dashboard entrances ($KPI)" || bad "dashboard entrances missing"
agent-browser screenshot download/gavel-final-02-dashboard.png > /dev/null

echo "=== [4/10] review queue: tabs + slivers ==="
agent-browser find role button click --name "Review queue" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.8
TABS=$(agent-browser get count ".tabs-ink")
[ "$TABS" -gt 0 ] 2>/dev/null && ok "tabs-ink underline" || bad "tabs-ink missing"
SEGS=$(agent-browser get count ".anim-seg")
[ "$SEGS" -gt 0 ] 2>/dev/null && ok "confidence slivers ($SEGS)" || bad "anim-seg missing"
agent-browser screenshot download/gavel-final-03-review-queue.png > /dev/null

echo "=== [5/10] approve -> verdict flash ==="
agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Approve & bill') && !b.closest('[role=alertdialog]'))[0]?.click()" > /dev/null
sleep 0.6
DIALOG=$(agent-browser eval "!!document.querySelector('[role=alertdialog]')")
chk "approve dialog opens" "$DIALOG" "true"
agent-browser eval "[...document.querySelectorAll('[role=alertdialog] button')].filter(b=>b.textContent.includes('Approve'))[0]?.click()" > /dev/null
if poll_flash; then
  ok "verdict flash appears"
  STAMP=$(agent-browser get count ".stamp-xl")
  [ "$STAMP" -gt 0 ] 2>/dev/null && ok "stamp slam renders" || bad "stamp missing"
  agent-browser screenshot download/gavel-final-04-verdict-flash.png > /dev/null
  sleep 1.6
  chk "overlay unmounts" "$(agent-browser get count '.verdict-overlay')" "0"
else
  bad "verdict flash never appeared"
fi

echo "=== [6/10] dismiss -> second flash ==="
sleep 1
agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Dismiss' && !b.closest('[role=alertdialog]'))[0]?.click()" > /dev/null
sleep 0.6
agent-browser eval "[...document.querySelectorAll('[role=alertdialog] button')].filter(b=>b.textContent.includes('dismiss'))[0]?.click()" > /dev/null
if poll_flash; then
  ok "dismiss flash appears"
  sleep 1.6
  chk "overlay unmounts" "$(agent-browser get count '.verdict-overlay')" "0"
else
  bad "dismiss flash never appeared (no pending left?)"
fi
agent-browser screenshot download/gavel-final-11-review-queue-post-actions.png > /dev/null

echo "=== [7/10] finding detail: timeline + ink-fill ==="
agent-browser find role tab click --name "All" > /dev/null 2>/dev/null || true
sleep 0.6
agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Open case file'))[0]?.click()" > /dev/null
sleep 0.9
TL=$(agent-browser get count ".anim-timeline")
[ "$TL" -gt 0 ] 2>/dev/null && ok "timeline spine" || bad "anim-timeline missing"
IF=$(agent-browser get count ".ink-fill")
[ "$IF" -ge 3 ] 2>/dev/null && ok "ink-fill pillars ($IF)" || bad "ink-fill missing ($IF)"
agent-browser screenshot download/gavel-final-05-finding-detail.png > /dev/null

echo "=== [8/10] audits + monitoring ==="
agent-browser find role button click --name "Audits" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.8
IF2=$(agent-browser get count ".ink-fill")
[ "$IF2" -ge 4 ] 2>/dev/null && ok "audits 4-segment bars ($IF2)" || bad "audits ink-fill ($IF2)"
agent-browser screenshot download/gavel-final-06-audits.png > /dev/null
agent-browser find role button click --name "Monitoring" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.6
BEAT=$(agent-browser get count ".anim-breathe-fast")
[ "$BEAT" -gt 0 ] 2>/dev/null && ok "critical heartbeat ($BEAT)" || echo "  note: no unacknowledged critical alert"
agent-browser screenshot download/gavel-final-08-monitoring.png > /dev/null

echo "=== [9/10] theme flip + mobile drawer ==="
PREV=$(agent-browser eval "document.documentElement.classList.contains('dark')")
LBL=$([ "$PREV" = "true" ] && echo "Switch to light" || echo "Switch to dark")
agent-browser find role button click --name "$LBL" > /dev/null
sleep 1.4
NOW=$(agent-browser eval "document.documentElement.classList.contains('dark')")
[ "$PREV" != "$NOW" ] && ok "theme flipped" || bad "theme did not flip"
agent-browser screenshot download/gavel-final-09-theme-flip.png > /dev/null
agent-browser set viewport 390 844 > /dev/null
agent-browser reload > /dev/null; agent-browser wait --load networkidle > /dev/null; sleep 1
agent-browser find role button click --name "Open menu" > /dev/null
sleep 0.5
DRAWER=$(agent-browser get count ".anim-drawer")
[ "$DRAWER" -gt 0 ] 2>/dev/null && ok "drawer slides in" || bad "drawer missing"
agent-browser screenshot download/gavel-final-10-mobile-drawer.png > /dev/null
agent-browser find role button click --name "Close menu" > /dev/null
sleep 0.5
chk "drawer unmounts" "$(agent-browser get count '.anim-drawer, .anim-drawer-out')" "0"
agent-browser set viewport 1440 900 > /dev/null

echo "=== [10/10] console hygiene ==="
ERRS=$(agent-browser errors 2>/dev/null | grep -cE 'Error' || true)
chk "zero page errors" "$ERRS" "0"
agent-browser close > /dev/null

echo
echo "LIVE UI QA COMPLETE — PASS: $PASS  FAIL: $FAIL"
# Teardown: kill ONLY the tree this harness spawned (walk real descendants of
# the recorded PID). Never pkill — a platform-managed server must survive QA.
kill_tree() {
  local p="$1" c
  for c in $(ps -o pid= --ppid "$p" 2>/dev/null); do kill_tree "$c"; done
  echo "$p"
}
if [ -n "$BOOT_PID" ]; then
  PIDS=$(kill_tree "$BOOT_PID")
  # children first, parent (bun) last
  kill $PIDS 2>/dev/null || true
  sleep 1
elif [ "$PLATFORM_SERVER" = "1" ]; then
  echo "(left platform-managed server running)"
fi
exit $FAIL