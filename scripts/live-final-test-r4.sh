#!/bin/bash
# GAVEL — round 4: verdict flash timing (poll the 1.15s window after fetch completes).
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  PASS: $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL: $1"; }
chk() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2' want '$3'"; fi; }
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

echo "=== [R] Reset demo (re-seed via UI) ==="
agent-browser find role button click --name "Reset demo" > /dev/null
sleep 2.5
agent-browser reload > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 1
agent-browser find role button click --name "Review queue" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.8
ROWS=$(agent-browser eval "document.querySelectorAll('article').length")
echo "  (pending rows after reset: $ROWS)"
chk "reset demo restores pending findings" "$ROWS" "2"

echo "=== [B] Approve & bill → verdict flash (polled) ==="
TREF=$(getref 'Approve & bill')
agent-browser click "$TREF" > /dev/null; sleep 0.5
CREF=$(getlastref 'Approve & bill')
agent-browser click "$CREF" > /dev/null
# poll for the overlay mount (fetch + trigger), window = 1.15s after mount
SEEN=0
for p in $(seq 1 16); do
  F=$(agent-browser get count ".verdict-overlay")
  if [ "$F" -gt 0 ] 2>/dev/null; then SEEN=1; break; fi
  sleep 0.12
done
if [ "$SEEN" = "1" ]; then
  ok "verdict flash overlay appears (poll #$p)"
  STAMP=$(agent-browser get count ".stamp-xl.stamp-slam")
  [ "$STAMP" -gt 0 ] 2>/dev/null && ok "stamp-xl slam renders" || bad "stamp missing"
  agent-browser screenshot download/gavel-final-04-verdict-flash.png > /dev/null
  ok "mid-flash screenshot captured"
  sleep 1.6
  GONE=$(agent-browser get count ".verdict-overlay")
  chk "verdict overlay unmounts" "$GONE" "0"
else
  bad "verdict flash never appeared within 2s"
fi

echo "=== [C] Dismiss → second flash (polled) ==="
DREF=$(getref 'button "Dismiss"')
agent-browser click "$DREF" > /dev/null; sleep 0.5
CREF2=$(getlastref 'Dismiss')
agent-browser click "$CREF2" > /dev/null
SEEN2=0
for p in $(seq 1 16); do
  F2=$(agent-browser get count ".verdict-overlay")
  if [ "$F2" -gt 0 ] 2>/dev/null; then SEEN2=1; break; fi
  sleep 0.12
done
if [ "$SEEN2" = "1" ]; then
  ok "dismiss verdict flash appears"
  sleep 1.6
  GONE2=$(agent-browser get count ".verdict-overlay")
  chk "dismiss overlay unmounts" "$GONE2" "0"
  agent-browser screenshot download/gavel-final-11-review-queue-post-actions.png > /dev/null
  ok "post-actions queue screenshot saved"
else
  bad "dismiss flash never appeared"
fi

# tabs recount: pending should be 0 now
PENDING0=$(agent-browser eval "document.body.innerText.match(/Pending \((\d)\)/)?.[1] ?? 'x'")
chk "pending tab drained after actions" "$PENDING0" "0"

ERRS=$(agent-browser errors 2>/dev/null | grep -cE 'Error' || true)
chk "zero page errors" "$ERRS" "0"
agent-browser close > /dev/null

echo
echo "ROUND 4 COMPLETE — PASS: $PASS  FAIL: $FAIL"
pkill -f "next dev" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; sleep 1
exit $FAIL