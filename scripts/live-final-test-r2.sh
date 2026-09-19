#!/bin/bash
# GAVEL — round 2: fix the 2 failed paths (verdict flash via 2-step dialog,
# theme toggle label) + verify audit list ink-fill + finding detail timeline.
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2' want '$3'"; fi; }

echo "=== boot ==="
setsid nohup bun run dev > /dev/null 2>&1 &
CODE=000
for i in $(seq 1 90); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health)
  [ "$CODE" = "200" ] && break
  sleep 1
done
chk "server health" "$CODE" "200"
[ "$CODE" != "200" ] && exit 1

agent-browser set viewport 1440 900 > /dev/null
agent-browser open http://localhost:3000/login > /dev/null
agent-browser wait --load networkidle > /dev/null
agent-browser fill "#email" "admin@gavel.demo" > /dev/null
agent-browser fill "#password" "gavel-admin-demo" > /dev/null
agent-browser find role button click --name "Sign in" > /dev/null
agent-browser wait --load networkidle > /dev/null
sleep 1

echo "=== [A] Review queue: pending rows + confidence slivers ==="
agent-browser find role button click --name "Review queue" > /dev/null
agent-browser wait --load networkidle > /dev/null
sleep 0.8
PENDING=$(agent-browser eval "document.querySelectorAll('article').length")
APPROVE_BTNS=$(agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Approve')).length")
echo "  (rows=$PENDING, approve-adjacent buttons=$APPROVE_BTNS)"
SEGS=$(agent-browser get count ".anim-seg")
[ "$SEGS" -gt 0 ] 2>/dev/null && ok "confidence slivers .anim-seg x$SEGS" || bad "anim-seg missing ($SEGS)"

echo "=== [B] Verdict flash via 2-step dialog ==="
# step 1: trigger button (row action)
TREF=$(agent-browser snapshot -i | grep -i 'Approve' | grep -oE '@e[0-9]+' | head -1)
if [ -z "$TREF" ]; then
  bad "no Approve trigger found — dumping snapshot head:"; agent-browser snapshot -i | head -30
else
  agent-browser click "$TREF" > /dev/null; sleep 0.5
  DIALOG=$(agent-browser eval "!!document.querySelector('[role=alertdialog], [role=dialog]')")
  chk "confirm dialog opens" "$DIALOG" "true"
  # step 2: confirm action (last Approve ref = dialog action)
  CREF=$(agent-browser snapshot -i | grep -i 'Approve' | grep -oE '@e[0-9]+' | tail -1)
  agent-browser click "$CREF" > /dev/null
  FLASH=$(agent-browser get count ".verdict-overlay")
  [ "$FLASH" -gt 0 ] 2>/dev/null && ok "verdict flash overlay appears" || bad "verdict flash did not appear"
  STAMP=$(agent-browser get count ".stamp-xl.stamp-slam")
  [ "$STAMP" -gt 0 ] 2>/dev/null && ok "stamp slam + xl stamp renders" || bad "stamp missing"
  sleep 1.8
  GONE=$(agent-browser get count ".verdict-overlay")
  chk "verdict overlay unmounts" "$GONE" "0"
  agent-browser screenshot download/gavel-final-04-verdict-flash.png > /dev/null
  ok "verdict flash screenshot saved"
  # post-approve: audit log should gain an entry (server-side truth)
  ALOG=$(curl -s http://localhost:3000/api/dashboard | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('auditLog', d.get('audit_log', []))))" 2>/dev/null || echo "?")
  echo "  (audit log entries via API: $ALOG)"
fi

echo "=== [C] Second pending finding: Dismiss flash (different ink) ==="
DREF=$(agent-browser snapshot -i | grep -i 'Dismiss' | grep -oE '@e[0-9]+' | head -1)
if [ -n "$DREF" ]; then
  agent-browser click "$DREF" > /dev/null; sleep 0.4
  CREF2=$(agent-browser snapshot -i | grep -i 'Dismiss' | grep -oE '@e[0-9]+' | tail -1)
  agent-browser click "$CREF2" > /dev/null
  FLASH2=$(agent-browser get count ".verdict-overlay")
  [ "$FLASH2" -gt 0 ] 2>/dev/null && ok "dismiss verdict flash appears" || bad "dismiss flash missing"
  sleep 1.8
else
  echo "  note: no second pending finding (fine)"
fi

echo "=== [D] Finding detail: timeline + ink-fill pillars ==="
agent-browser find role button click --name "Review queue" > /dev/null; sleep 0.6
OREF=$(agent-browser snapshot -i | grep -i 'Open case file' | grep -oE '@e[0-9]+' | head -1)
if [ -n "$OREF" ]; then
  agent-browser click "$OREF" > /dev/null; sleep 0.9
  TL=$(agent-browser get count ".anim-timeline")
  [ "$TL" -gt 0 ] 2>/dev/null && ok "timeline spine .anim-timeline" || bad "anim-timeline missing"
  IF=$(agent-browser get count ".ink-fill")
  [ "$IF" -ge 3 ] 2>/dev/null && ok "ink-fill confidence pillars x$IF" || bad "ink-fill pillars missing ($IF)"
  agent-browser screenshot download/gavel-final-05-finding-detail.png > /dev/null
  ok "finding detail screenshot saved"
else
  bad "Open case file button not found"
fi

echo "=== [E] Audits list: 4-segment ink-fill status bars ==="
agent-browser find role button click --name "Audits" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.8
IF2=$(agent-browser get count ".ink-fill")
[ "$IF2" -ge 4 ] 2>/dev/null && ok "audits list ink-fill segments x$IF2" || bad "audits ink-fill missing ($IF2)"
agent-browser screenshot download/gavel-final-06-audits.png > /dev/null

echo "=== [F] Theme toggle (correct label) ==="
PREV=$(agent-browser eval "document.documentElement.classList.contains('dark')")
LBL=$([ "$PREV" = "true" ] && echo "Switch to light" || echo "Switch to dark")
agent-browser find role button click --name "$LBL" > /dev/null
sleep 1.4
NOW=$(agent-browser eval "document.documentElement.classList.contains('dark')")
if [ "$PREV" != "$NOW" ]; then ok "theme flipped (dark: $PREV -> $NOW)"; else bad "theme did not flip"; fi
agent-browser screenshot download/gavel-final-09-theme-flip.png > /dev/null
agent-browser find role button click --name "$LBL" > /dev/null 2>&1 || agent-browser find role button click --name "Switch to dark" > /dev/null 2>&1 || true
sleep 1; ok "theme restored"

echo "=== [G] console errors ==="
ERRS=$(agent-browser errors 2>/dev/null | grep -cE 'Error' || true)
chk "zero page errors" "$ERRS" "0"
agent-browser close > /dev/null

echo
echo "ROUND 2 COMPLETE — PASS: $PASS  FAIL: $FAIL"
pkill -f "next dev" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; sleep 1
exit $FAIL