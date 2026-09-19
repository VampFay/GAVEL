#!/bin/bash
# GAVEL — round 6: dismiss verdict flash (confirm label = "Yes, dismiss").
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

P0=$(agent-browser eval "document.body.innerText.match(/Pending \((\d+)\)/)?.[1] ?? 'x'" | tr -d '"')
echo "  (pending at start: $P0)"
LOGN0=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@gavel.demo","password":"gavel-admin-demo"}' -D - -o /dev/null | grep -ioE 'gavel_token=[^;]+' | head -1 > /tmp/tok.txt; cat /tmp/tok.txt > /dev/null; curl -s "http://localhost:3000/api/dashboard" -H "Cookie: $(cat /tmp/tok.txt)" | python3 -c "import json,sys; d=json.load(sys.stdin); al=d.get('auditLog') or d.get('recentActivity') or []; print(len(al))" 2>/dev/null || echo 0)
echo "  (audit log at start: $LOGN0)"

echo "=== [C] Dismiss -> verdict flash ==="
agent-browser eval "[...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Dismiss' && !b.closest('[role=alertdialog]'))[0].click()" > /dev/null
sleep 0.6
DIALOG=$(agent-browser eval "!!document.querySelector('[role=alertdialog]')")
chk "dismiss dialog opens" "$DIALOG" "true"
agent-browser eval "[...document.querySelectorAll('[role=alertdialog] button')].filter(b=>b.textContent.includes('dismiss'))[0].click()" > /dev/null
SEEN=0
for p in $(seq 1 16); do
  F=$(agent-browser get count ".verdict-overlay")
  if [ "$F" -gt 0 ] 2>/dev/null; then SEEN=1; break; fi
  sleep 0.12
done
if [ "$SEEN" = "1" ]; then
  ok "dismiss verdict flash appears (poll #$p)"
  STAMP=$(agent-browser get count ".stamp-xl")
  [ "$STAMP" -gt 0 ] 2>/dev/null && ok "dismissed stamp renders" || bad "stamp missing"
  sleep 1.6
  GONE=$(agent-browser get count ".verdict-overlay")
  chk "dismiss overlay unmounts" "$GONE" "0"
else
  bad "dismiss flash never appeared"
fi

echo "=== [D] server truth ==="
sleep 0.6
P1=$(agent-browser eval "document.body.innerText.match(/Pending \((\d+)\)/)?.[1] ?? 'x'" | tr -d '"')
EXPECT=$((P0 - 1))
chk "pending drained by 1" "$P1" "$EXPECT"
LOGN1=$(curl -s "http://localhost:3000/api/dashboard" -H "Cookie: $(cat /tmp/tok.txt)" | python3 -c "import json,sys; d=json.load(sys.stdin); al=d.get('auditLog') or d.get('recentActivity') or []; print(len(al))" 2>/dev/null || echo 0)
[ "$LOGN1" -gt "$LOGN0" ] 2>/dev/null && ok "audit log grew ($LOGN0 -> $LOGN1)" || bad "audit log did not grow"
agent-browser screenshot download/gavel-final-11-review-queue-post-actions.png > /dev/null
ok "post-actions queue screenshot saved"

ERRS=$(agent-browser errors 2>/dev/null | grep -cE 'Error' || true)
chk "zero page errors" "$ERRS" "0"
agent-browser close > /dev/null

echo
echo "ROUND 6 COMPLETE — PASS: $PASS  FAIL: $FAIL"
pkill -f "next dev" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; sleep 1
rm -f /tmp/tok.txt
exit $FAIL