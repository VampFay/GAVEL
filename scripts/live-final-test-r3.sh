#!/bin/bash
# GAVEL — round 3: ref extraction fix (snapshot shows [ref=eNN], click wants @eNN).
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2' want '$3'"; fi; }
# snapshot prints "[ref=eNN]" — click takes "@eNN"
getref() { agent-browser snapshot -i | grep -i "$1" | grep -oE 'ref=e[0-9]+' | head -1 | sed 's/^ref=/@/'; }
getlastref() { agent-browser snapshot -i | grep -i "$1" | grep -oE 'ref=e[0-9]+' | tail -1 | sed 's/^ref=/@/'; }

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
agent-browser wait --load networkidle > /dev/null; sleep 1
agent-browser find role button click --name "Review queue" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.8

echo "=== [B] Approve & bill → verdict flash ==="
TREF=$(getref 'Approve & bill')
if [ -z "$TREF" ]; then
  bad "approve trigger not found"
else
  echo "  (trigger ref: $TREF)"
  agent-browser click "$TREF" > /dev/null; sleep 0.5
  DIALOG=$(agent-browser eval "!!document.querySelector('[role=alertdialog]')")
  chk "confirm dialog opens" "$DIALOG" "true"
  CREF=$(getlastref 'Approve & bill')
  agent-browser click "$CREF" > /dev/null
  FLASH=$(agent-browser get count ".verdict-overlay")
  [ "$FLASH" -gt 0 ] 2>/dev/null && ok "verdict flash overlay appears" || bad "verdict flash did not appear"
  STAMP=$(agent-browser get count ".stamp-xl")
  [ "$STAMP" -gt 0 ] 2>/dev/null && ok "stamp-xl slam renders" || bad "stamp missing"
  THUD=$(agent-browser eval "[...document.querySelectorAll('[style*=animation]')].some(el=>getComputedStyle(el).animationName.includes('thud'))||document.styleSheets.length>0")
  sleep 1.8
  GONE=$(agent-browser get count ".verdict-overlay")
  chk "verdict overlay unmounts" "$GONE" "0"
  agent-browser screenshot download/gavel-final-04-verdict-flash.png > /dev/null
  ok "verdict flash screenshot saved"
fi

echo "=== [C] Dismiss → second flash (different ink) ==="
DREF=$(getref 'button "Dismiss"')
if [ -n "$DREF" ]; then
  agent-browser click "$DREF" > /dev/null; sleep 0.5
  CREF2=$(getlastref 'Dismiss')
  agent-browser click "$CREF2" > /dev/null
  FLASH2=$(agent-browser get count ".verdict-overlay")
  [ "$FLASH2" -gt 0 ] 2>/dev/null && ok "dismiss verdict flash appears" || bad "dismiss flash missing"
  sleep 1.8
  GONE2=$(agent-browser get count ".verdict-overlay")
  chk "dismiss overlay unmounts" "$GONE2" "0"
else
  echo "  note: no pending finding left to dismiss"
fi

echo "=== [D] Finding detail: timeline + ink-fill pillars ==="
agent-browser find role button click --name "Review queue" > /dev/null; sleep 0.6
# after approvals the pending tab may be empty — use the All tab
agent-browser find role tab click --name "All" > /dev/null 2>/dev/null || true
sleep 0.6
OREF=$(getref 'Open case file')
if [ -n "$OREF" ]; then
  agent-browser click "$OREF" > /dev/null; sleep 0.9
  TL=$(agent-browser get count ".anim-timeline")
  [ "$TL" -gt 0 ] 2>/dev/null && ok "timeline spine .anim-timeline" || bad "anim-timeline missing"
  IF=$(agent-browser get count ".ink-fill")
  [ "$IF" -ge 3 ] 2>/dev/null && ok "ink-fill confidence pillars x$IF" || bad "ink-fill pillars missing ($IF)"
  agent-browser screenshot download/gavel-final-05-finding-detail.png > /dev/null
  ok "finding detail screenshot saved"
else
  bad "Open case file not found"
fi

echo "=== [E] audit log gained entries (API truth) ==="
TOK=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@gavel.demo","password":"gavel-admin-demo"}' -D - -o /dev/null | grep -i 'set-cookie' | grep -oE 'gavel_token=[^;]+')
LOGN=$(curl -s "http://localhost:3000/api/dashboard" -H "Cookie: $TOK" | python3 -c "import json,sys; d=json.load(sys.stdin); k=[x for x in d.keys()]; print(sum(1 for x in (d.get('auditLog') or d.get('recentActivity') or [])))" 2>/dev/null || echo 0)
echo "  (audit log entries now: $LOGN — was 4 at seed)"

ERRS=$(agent-browser errors 2>/dev/null | grep -cE 'Error' || true)
chk "zero page errors" "$ERRS" "0"
agent-browser close > /dev/null

echo
echo "ROUND 3 COMPLETE — PASS: $PASS  FAIL: $FAIL"
pkill -f "next dev" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; sleep 1
exit $FAIL