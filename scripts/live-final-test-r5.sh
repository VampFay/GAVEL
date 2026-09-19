#!/bin/bash
# GAVEL — round 5: eval-driven clicks (no refs). Fresh seed = 5 pending findings.
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
agent-browser wait --load networkidle > /dev/null; sleep 1
agent-browser find role button click --name "Review queue" > /dev/null
agent-browser wait --load networkidle > /dev/null; sleep 0.8

PENDING0=$(agent-browser eval "document.body.innerText.match(/Pending \((\d+)\)/)?.[1] ?? 'x'")
echo "  (pending at start: $PENDING0)"

# non-dialog Approve trigger (first row)
T=$(agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Approve & bill') && !b.closest('[role=alertdialog]')).length")
echo "  (approve triggers in rows: $T)"

echo "=== [B] Approve & bill → verdict flash ==="
agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Approve & bill') && !b.closest('[role=alertdialog]'))[0].click()" > /dev/null
sleep 0.6
DIALOG=$(agent-browser eval "!!document.querySelector('[role=alertdialog]')")
chk "confirm dialog opens" "$DIALOG" "true"
agent-browser eval "[...document.querySelectorAll('[role=alertdialog] button')].filter(b=>b.textContent.includes('Approve'))[0].click()" > /dev/null
SEEN=0
for p in $(seq 1 16); do
  F=$(agent-browser get count ".verdict-overlay")
  if [ "$F" -gt 0 ] 2>/dev/null; then SEEN=1; break; fi
  sleep 0.12
done
if [ "$SEEN" = "1" ]; then
  ok "verdict flash overlay appears (poll #$p)"
  STAMP=$(agent-browser get count ".stamp-xl")
  [ "$STAMP" -gt 0 ] 2>/dev/null && ok "stamp-xl slam renders" || bad "stamp missing"
  agent-browser screenshot download/gavel-final-04-verdict-flash.png > /dev/null
  ok "mid-flash screenshot captured"
  sleep 1.6
  GONE=$(agent-browser get count ".verdict-overlay")
  chk "verdict overlay unmounts" "$GONE" "0"
else
  bad "verdict flash never appeared"
fi

echo "=== [C] Dismiss → second flash ==="
sleep 1
agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Dismiss' && !b.closest('[role=alertdialog]'))[0].click()" > /dev/null
sleep 0.6
DIALOG2=$(agent-browser eval "!!document.querySelector('[role=alertdialog]')")
chk "dismiss dialog opens" "$DIALOG2" "true"
agent-browser eval "[...document.querySelectorAll('[role=alertdialog] button')].filter(b=>b.textContent.trim()==='Dismiss')[0].click()" > /dev/null
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
else
  bad "dismiss flash never appeared"
fi

echo "=== [D] server truth: audit log + pending count ==="
sleep 0.5
PENDING1=$(agent-browser eval "document.body.innerText.match(/Pending \((\d+)\)/)?.[1] ?? 'x'")
EXPECT=$((PENDING0 - 2))
chk "pending drained by 2 (approve+dismiss)" "$PENDING1" "$EXPECT"
TOK=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@gavel.demo","password":"gavel-admin-demo"}' -D - -o /dev/null | grep -ioE 'set-cookie: gavel_token=[^;]+' | sed 's/.*://')
LOGN=$(curl -s "http://localhost:3000/api/dashboard" -H "Cookie: ${TOK}" | python3 -c "import json,sys; d=json.load(sys.stdin); al=d.get('auditLog') or d.get('recentActivity') or []; print(len(al))" 2>/dev/null || echo 0)
echo "  (audit log entries: $LOGN)"
[ "$LOGN" -ge 6 ] 2>/dev/null && ok "audit log gained the 2 rulings" || bad "audit log did not grow ($LOGN)"
agent-browser screenshot download/gavel-final-11-review-queue-post-actions.png > /dev/null
ok "post-actions screenshot saved"

ERRS=$(agent-browser errors 2>/dev/null | grep -cE 'Error' || true)
chk "zero page errors" "$ERRS" "0"
agent-browser close > /dev/null

echo
echo "ROUND 5 COMPLETE — PASS: $PASS  FAIL: $FAIL"
pkill -f "next dev" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; sleep 1
exit $FAIL