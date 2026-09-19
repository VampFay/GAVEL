#!/usr/bin/env bash
# GAVEL — single-invocation live verification of the production-blocker fixes.
#
# WHY THIS SHAPE: the sandbox reaps every spawned process at the end of each
# tool invocation, so the dev server must be started, exercised, and stopped
# WITHIN one run. This script does exactly that and writes a markdown report.
#
# Verified here:
#   1. demo login + tenant-stamped data (demo tenant)
#   2. tenant isolation (second tenant sees NOTHING of the demo tenant)
#   3. provisioning: tenant create → invite → set password → login
#   4. role gating (viewer cannot administer)
#   5. instant revocation (disable → 401 on next request)
#   6. live GitHub connector: save → sync → evidence committed
#   7. cross-tenant id masking (404, not data)

set -uo pipefail
cd /home/z/my-project

REPORT=/tmp/gavel-verify.md
: > "$REPORT"
PASS=0; FAIL=0

say()  { echo "$1" | tee -a "$REPORT"; }
step() { say ""; say "## $1"; }
ok()   { PASS=$((PASS+1)); say "✅ PASS: $1"; }
bad()  { FAIL=$((FAIL+1)); say "❌ FAIL: $1"; }

jsonq() { python3 -c "import json,sys;d=json.load(sys.stdin);print(eval(sys.argv[1]))" "$1" 2>/dev/null; }

# ── Start the dev server ────────────────────────────────────────────────────
say "# GAVEL production-blocker verification — $(date -u +%FT%TZ)"
say ""
say "Starting dev server…"

node_modules/.bin/next dev -p 3000 >> dev.log 2>&1 &
SERVER_PID=$!

READY=0
for i in $(seq 1 60); do
  code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null)
  if [ "$code" = "200" ]; then READY=1; break; fi
  sleep 3
done
if [ "$READY" != "1" ]; then
  say "❌ dev server never became healthy"
  kill $SERVER_PID 2>/dev/null
  exit 1
fi
ok "dev server healthy"

JAR=/tmp/gavel-admin.jar; JAR2=/tmp/gavel-t2.jar; JAR3=/tmp/gavel-t2u.jar
rm -f "$JAR" "$JAR2" "$JAR3"

# ── 1. Demo admin login + tenant data ───────────────────────────────────────
step "1. Demo tenant login + scoping"
LOGIN=$(curl -s -m 30 -c "$JAR" -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@gavel.demo","password":"gavel-admin-demo"}')
ROLE=$(echo "$LOGIN" | jsonq "d['user']['role']")
[ "$ROLE" = "admin" ] && ok "demo admin login (role=admin)" || bad "demo admin login: $LOGIN"

USERS=$(curl -s -m 30 -b "$JAR" http://localhost:3000/api/admin/users)
NU=$(echo "$USERS" | jsonq "len(d['users'])")
TEN1=$(echo "$USERS" | jsonq "d['users'][0]['tenantId']")
[ "$NU" = "3" ] && ok "admin/users lists 3 demo users" || bad "expected 3 users, got: $NU"
[ "$TEN1" = "demo-tenant" ] && ok "demo users are stamped tenantId=demo-tenant" || bad "tenantId=$TEN1"

CLIENTS=$(curl -s -m 30 -b "$JAR" http://localhost:3000/api/clients)
NC=$(echo "$CLIENTS" | jsonq "len(d['clients'])")
[ "$NC" = "1" ] && ok "demo admin sees the 1 demo client (scoped read)" || bad "expected 1 client, got $NC"
DEMO_CLIENT_ID=$(echo "$CLIENTS" | jsonq "d['clients'][0]['id']")

DASH=$(curl -s -m 30 -b "$JAR" http://localhost:3000/api/dashboard)
OKD=$(echo "$DASH" | jsonq "d['ok']")
[ "$OKD" = "True" ] && ok "dashboard renders for demo admin" || bad "dashboard: $DASH"

FINDINGS=$(curl -s -m 30 -b "$JAR" http://localhost:3000/api/findings)
NF=$(echo "$FINDINGS" | jsonq "len(d.get('findings',[]))")
say "   findings visible to demo admin: $NF"

# ── 2. Second tenant via CLI ────────────────────────────────────────────────
step "2. Tenant 2 bootstrap (CLI) + invite acceptance"
CLI_OUT=$(bun scripts/create-tenant.ts "Meridian Systems" meridian \
  --admin "ops@meridian.test" --admin-name "Meridian Ops" 2>&1)
say '```'; say "$CLI_OUT"; say '```'
INVITE_TOKEN=$(echo "$CLI_OUT" | grep -o 'invite=[A-Za-z0-9._%-]*' | head -1 | sed 's/invite=//;s/%3A/:/g;s/%2F/\//g;s/%2B/+/g')
if [ -n "$INVITE_TOKEN" ]; then
  ACC=$(curl -s -m 30 -X POST http://localhost:3000/api/auth/invite \
    -H 'Content-Type: application/json' \
    -d "{\"token\":\"$INVITE_TOKEN\",\"password\":\"meridian-ops-passw0rd\"}")
  echo "$ACC" | grep -q '"ok":true' && ok "invite accepted — password set" || bad "invite accept: $ACC"

  L2=$(curl -s -m 30 -c "$JAR2" -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"ops@meridian.test","password":"meridian-ops-passw0rd"}')
  echo "$L2" | grep -q '"role":"admin"' && ok "tenant-2 admin login" || bad "t2 login: $L2"
else
  bad "no invite token in CLI output"
fi

# ── 3. Tenant isolation ─────────────────────────────────────────────────────
step "3. Tenant isolation (the core security property)"
C2=$(curl -s -m 30 -b "$JAR2" http://localhost:3000/api/clients)
NC2=$(echo "$C2" | jsonq "len(d['clients'])")
[ "$NC2" = "0" ] && ok "tenant-2 admin sees ZERO demo clients" || bad "ISOLATION LEAK: tenant 2 sees $NC2 clients"

D2=$(curl -s -m 30 -b "$JAR2" http://localhost:3000/api/dashboard)
NF2=$(echo "$D2" | jsonq "d.get('kpis',{}).get('pendingReview','?')")
say "   tenant-2 dashboard pendingReview: $NF2 (demo admin saw: see findings count above)"

X1=$(curl -s -m 30 -o /dev/null -w "%{http_code}" -b "$JAR2" "http://localhost:3000/api/audits/$DEMO_CLIENT_ID")
[ "$X1" = "404" ] && ok "cross-tenant client id masked as 404" || bad "cross-tenant audit GET returned $X1 (expected 404)"

U2=$(curl -s -m 30 -b "$JAR2" http://localhost:3000/api/admin/users)
NU2=$(echo "$U2" | jsonq "len(d['users'])")
[ "$NU2" = "1" ] && ok "tenant-2 user list shows only its own admin (1)" || bad "t2 users: $NU2"

# ── 4. Provisioning + role gating + revocation ──────────────────────────────
step "4. Provisioning flow (invite → role → revoke)"
PU=$(curl -s -m 30 -b "$JAR2" -X POST http://localhost:3000/api/admin/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"analyst@meridian.test","name":"J. Analyst","role":"viewer"}')
PU_TOKEN=$(echo "$PU" | grep -o '"token":"[^"]*"' | head -1 | sed 's/"token":"//;s/"$//')
if [ -n "$PU_TOKEN" ]; then
  ok "viewer provisioned in tenant 2 (invite returned, not emailed)"
  ACC2=$(curl -s -m 30 -X POST http://localhost:3000/api/auth/invite \
    -H 'Content-Type: application/json' \
    -d "{\"token\":\"$PU_TOKEN\",\"password\":\"analyst-passw0rd\"}")
  echo "$ACC2" | grep -q '"ok":true' && ok "viewer accepted invite" || bad "viewer invite: $ACC2"

  L3=$(curl -s -m 30 -c "$JAR3" -X POST http://localhost:3000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"analyst@meridian.test","password":"analyst-passw0rd"}')
  echo "$L3" | grep -q '"role":"viewer"' && ok "viewer login" || bad "viewer login: $L3"

  V403=$(curl -s -m 30 -o /dev/null -w "%{http_code}" -b "$JAR3" http://localhost:3000/api/admin/users)
  [ "$V403" = "403" ] && ok "viewer denied admin API (403)" || bad "viewer admin access returned $V403"

  VIEWER_ID=$(echo "$PU" | jsonq "d['user']['id']")
  DIS=$(curl -s -m 30 -b "$JAR2" -X PATCH "http://localhost:3000/api/admin/users/$VIEWER_ID" \
    -H 'Content-Type: application/json' -d '{"status":"disabled"}')
  echo "$DIS" | grep -q '"status":"disabled"' && ok "viewer disabled by tenant-2 admin" || bad "disable: $DIS"

  REV=$(curl -s -m 30 -o /dev/null -w "%{http_code}" -b "$JAR3" http://localhost:3000/api/dashboard)
  [ "$REV" = "401" ] && ok "disabled user's session revoked instantly (401)" || bad "revocation returned $REV"
else
  bad "provisioning failed: $PU"
fi

# ── 5. Live GitHub connector ────────────────────────────────────────────────
step "5. Live GitHub connector (public repo, no token)"
GH_CHECK=$(curl -s -m 10 -o /dev/null -w "%{http_code}" https://api.github.com/repos/vercel/next.js)
if [ "$GH_CHECK" = "200" ]; then
  PUT=$(curl -s -m 30 -b "$JAR" -X PUT http://localhost:3000/api/connectors \
    -H 'Content-Type: application/json' \
    -d "{\"clientId\":\"$DEMO_CLIENT_ID\",\"kind\":\"github\",\"config\":{\"owner\":\"vercel\",\"repo\":\"next.js\",\"includePrs\":true,\"days\":30}}")
  CID=$(echo "$PUT" | jsonq "d['connector']['id']")
  if [ -n "$CID" ] && [ "$CID" != "None" ]; then
    ok "GitHub connector saved (config validated + tenant-scoped)"
    SYNC=$(curl -s -m 120 -b "$JAR" -X POST "http://localhost:3000/api/connectors/$CID/sync" \
      -H 'Content-Type: application/json' -d '{}')
    AC=$(echo "$SYNC" | jsonq "d['committed']['activitiesCreated']")
    say '```'; echo "$SYNC" | head -c 500 | tee -a "$REPORT"; say ''; say '```'
    if [ -n "$AC" ] && [ "$AC" != "None" ] && [ "$AC" -gt 0 ] 2>/dev/null; then
      ok "live sync committed $AC code activities through the shared pipeline"
    else
      bad "sync did not commit activities: $SYNC"
    fi
    # Idempotence: re-sync → mostly duplicates.
    SYNC2=$(curl -s -m 120 -b "$JAR" -X POST "http://localhost:3000/api/connectors/$CID/sync" \
      -H 'Content-Type: application/json' -d '{}')
    AC2=$(echo "$SYNC2" | jsonq "d['committed']['activitiesCreated']")
    DUP2=$(echo "$SYNC2" | jsonq "d['committed']['duplicates']")
    say "   re-sync: created=$AC2 duplicates=$DUP2 (idempotence check)"
    [ "${AC2:-0}" -lt "${AC:-1}" ] && ok "re-sync is idempotent (created dropped to $AC2)" || bad "re-sync created $AC2 again"
  else
    bad "connector save failed: $PUT"
  fi
else
  say "⚠️ GitHub API unreachable ($GH_CHECK) — connector live test SKIPPED (unit tests cover the mapper)"
fi

# ── 6. Deep health ──────────────────────────────────────────────────────────
step "6. Deep health probe"
DH=$(curl -s -m 30 "http://localhost:3000/api/health?deep=1")
LAT=$(echo "$DH" | jsonq "d['db']['latencyMs']")
TEN=$(echo "$DH" | jsonq "d['db']['tenants']")
say '```'; echo "$DH" | head -c 400 | tee -a "$REPORT"; say ''; say '```'
[ "$TEN" = "2" ] && ok "deep health: 2 tenants, db latency ${LAT}ms" || bad "deep health tenants=$TEN"

# ── Done ────────────────────────────────────────────────────────────────────
kill $SERVER_PID 2>/dev/null
say ""
say "---"
say "**RESULT: $PASS passed, $FAIL failed**"
exit $([ "$FAIL" = "0" ] && echo 0 || echo 1)
