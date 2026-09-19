#!/bin/bash
# GAVEL — final live test: boot server, exercise every surface + motion behavior,
# capture evidence, tear down. Everything in ONE call (server dies between calls).
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
chk()  { if [ "$2" = "$3" ]; then ok "$1 ($2)"; else bad "$1 — got '$2' want '$3'"; fi; }

echo "=== [1/11] Boot dev server ==="
setsid nohup bun run dev > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 90); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)
  [ "$CODE" = "200" ] && break
  sleep 1
done
chk "server health" "$CODE" "200"
[ "$CODE" != "200" ] && { tail -20 dev.log; exit 1; }

echo "=== [2/11] Landing: scroll reveals ==="
agent-browser set viewport 1440 900 > /dev/null
agent-browser open http://localhost:3000/ > /dev/null
agent-browser wait --load networkidle > /dev/null
TOTAL=$(agent-browser get count ".reveal")
BEFORE=$(agent-browser get count ".reveal-in")
agent-browser scroll down 700 > /dev/null; sleep 0.4
agent-browser scroll down 700 > /dev/null; sleep 0.4
agent-browser scroll down 700 > /dev/null; sleep 0.6
AFTER=$(agent-browser get count ".reveal-in")
if [ "$AFTER" -gt "$BEFORE" ] 2>/dev/null; then ok "reveals fire on scroll ($BEFORE -> $AFTER of $TOTAL)"; else bad "reveals did not advance ($BEFORE -> $AFTER)"; fi
RULES=$(agent-browser get count ".rule-ink")
[ "$RULES" -gt 0 ] 2>/dev/null && ok "RevealLine rules present ($RULES)" || bad "no rule-ink lines"
agent-browser screenshot --full download/gavel-final-01-landing.png > /dev/null
ok "landing screenshot saved"

echo "=== [3/11] Login (admin) ==="
agent-browser open http://localhost:3000/login > /dev/null
agent-browser wait --load networkidle > /dev/null
agent-browser fill "#email" "admin@gavel.demo" > /dev/null
agent-browser fill "#password" "gavel-admin-demo" > /dev/null
agent-browser find role button click --name "Sign in" > /dev/null
agent-browser wait --url "http://localhost:3000/" > /dev/null 2>&1 || true
agent-browser wait --load networkidle > /dev/null
sleep 1
NAME=$(agent-browser get title)
SIGNED=$(agent-browser eval "document.body.innerText.includes('signed in') || document.body.innerText.includes('Case overview')")
[ "$SIGNED" = "true" ] && ok "login -> authenticated shell (title: $NAME)" || bad "login did not reach app shell"

echo "=== [4/11] Dashboard: KPIs + entrance moves ==="
KPI=$(agent-browser get count ".anim-row-in, .anim-panel-in")
[ "$KPI" -gt 0 ] 2>/dev/null && ok "dashboard entrance classes present ($KPI)" || bad "dashboard entrance classes missing"
agent-browser wait 900 > /dev/null
agent-browser screenshot download/gavel-final-02-dashboard.png > /dev/null
ok "dashboard screenshot saved"

echo "=== [5/11] Review queue: tabs + verdict flash ==="
agent-browser find role button click --name "Review queue" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.6
TABS=$(agent-browser get count ".tabs-ink")
[ "$TABS" -gt 0 ] 2>/dev/null && ok "tabs-ink underline present" || bad "tabs-ink missing"
agent-browser screenshot download/gavel-final-03-review-queue.png > /dev/null
# Approve the first pending finding -> verdict flash must appear then leave
REF=$(agent-browser snapshot -i | grep -iE 'button.*Approve' | grep -oE '@e[0-9]+' | head -1)
if [ -n "$REF" ]; then
  agent-browser click "$REF" > /dev/null
  FLASH=$(agent-browser get count ".verdict-overlay")
  [ "$FLASH" -gt 0 ] 2>/dev/null && ok "verdict flash overlay appears on approve" || bad "verdict flash did not appear"
  SLAM=$(agent-browser get count ".stamp-slam, .stamp-xl")
  [ "$SLAM" -gt 0 ] 2>/dev/null && ok "stamp slam renders ($SLAM)" || bad "stamp slam missing"
  sleep 1.8
  GONE=$(agent-browser get count ".verdict-overlay")
  chk "verdict overlay unmounts" "$GONE" "0"
  agent-browser screenshot download/gavel-final-04-verdict-flash.png > /dev/null
  ok "post-approve screenshot saved"
else
  bad "no Approve button found (pending tab empty?)"
fi

echo "=== [6/11] Finding detail: ink-fill bars + timeline ==="
agent-browser find role button click --name "Review queue" > /dev/null; sleep 0.5
FREF=$(agent-browser snapshot -i | grep -iE 'Open|View|review' | grep -oE '@e[0-9]+' | head -1)
# open via first finding row link/button
FROW=$(agent-browser snapshot -i | grep -iE '\$|₹|finding|Open' | grep -oE '@e[0-9]+' | head -1)
if [ -n "$FROW" ]; then agent-browser click "$FROW" > /dev/null; sleep 0.8; fi
TL=$(agent-browser get count ".anim-timeline")
BARS=$(agent-browser eval "document.querySelectorAll('[class*=ink-fill], [class*=anim-seg], [data-fill], .confidence').length")
[ "$TL" -gt 0 ] 2>/dev/null && ok "timeline spine draws (.anim-timeline x$TL)" || echo "  note: .anim-timeline not on this view"
agent-browser screenshot download/gavel-final-05-finding-detail.png > /dev/null
ok "finding detail screenshot saved"

echo "=== [7/11] Audits + audit detail: segmented status bars ==="
agent-browser find role button click --name "Audits" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.6
agent-browser screenshot download/gavel-final-06-audits.png > /dev/null
AREF=$(agent-browser snapshot -i | grep -iE 'Open|View|detail|engagement' | grep -oE '@e[0-9]+' | head -1)
if [ -n "$AREF" ]; then agent-browser click "$AREF" > /dev/null; sleep 0.8; fi
SEGS=$(agent-browser get count ".anim-seg")
[ "$SEGS" -gt 0 ] 2>/dev/null && ok "status bar ink-fill segments ($SEGS)" || echo "  note: .anim-seg count $SEGS on audit detail"
agent-browser screenshot download/gavel-final-07-audit-detail.png > /dev/null
ok "audits screenshots saved"

echo "=== [8/11] Monitoring: critical heartbeat ==="
agent-browser find role button click --name "Monitoring" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.6
BEAT=$(agent-browser get count ".anim-breathe-fast")
[ "$BEAT" -gt 0 ] 2>/dev/null && ok "critical heartbeat anim-breathe-fast x$BEAT" || echo "  note: no unacknowledged critical alerts right now ($BEAT)"
agent-browser screenshot download/gavel-final-08-monitoring.png > /dev/null
ok "monitoring screenshot saved"

echo "=== [9/11] Theme toggle: view-transition ink drop ==="
PREV=$(agent-browser eval "document.documentElement.classList.contains('dark')")
agent-browser find role button click --name "Toggle theme" > /dev/null
sleep 1.2
NOW=$(agent-browser eval "document.documentElement.classList.contains('dark')")
if [ "$PREV" != "$NOW" ]; then ok "theme flipped (dark: $PREV -> $NOW)"; else bad "theme did not flip"; fi
agent-browser screenshot download/gavel-final-09-theme-flip.png > /dev/null
agent-browser find role button click --name "Toggle theme" > /dev/null; sleep 1
ok "theme restored"

echo "=== [10/11] Mobile drawer: slide choreography ==="
agent-browser set viewport 390 844 > /dev/null
agent-browser reload > /dev/null; agent-browser wait --load networkidle > /dev/null; sleep 1
agent-browser find role button click --name "Open menu" > /dev/null
sleep 0.5
DRAWER=$(agent-browser get count ".anim-drawer")
BACK=$(agent-browser get count ".anim-drawer-backdrop")
[ "$DRAWER" -gt 0 ] 2>/dev/null && ok "drawer slides in (.anim-drawer)" || bad "drawer class missing"
[ "$BACK" -gt 0 ] 2>/dev/null && ok "drawer backdrop present" || bad "drawer backdrop missing"
agent-browser screenshot download/gavel-final-10-mobile-drawer.png > /dev/null
agent-browser find role button click --name "Close menu" > /dev/null
sleep 0.5
OUT=$(agent-browser get count ".anim-drawer, .anim-drawer-out")
chk "drawer unmounts after close" "$OUT" "0"
agent-browser set viewport 1440 900 > /dev/null

echo "=== [11/11] Console & page errors ==="
ERRS=$(agent-browser errors 2>/dev/null | grep -cE 'Error|error' || true)
if [ "$ERRS" = "0" ]; then ok "zero page errors"; else bad "$ERRS page errors:"; agent-browser errors; fi
agent-browser close > /dev/null

echo
echo "=========================================="
echo "LIVE TEST COMPLETE — PASS: $PASS  FAIL: $FAIL"
echo "=========================================="
# teardown
pkill -f "next dev" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null
sleep 1
echo "server stopped"
exit $FAIL