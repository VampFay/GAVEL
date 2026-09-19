#!/usr/bin/env bash
# GAVEL — revive the platform-managed dev server WITHOUT a container reboot.
#
# WHEN TO USE: the preview panel shows 502 (gateway :81 alive, app :3000 dead).
# The boot-time server (started by /start.sh via .zscripts/dev.sh) is killed by
# e.g. a stray `pkill -f "next dev"` — and nothing restarts it until reboot.
#
# HOW IT WORKS (the non-obvious part):
#   /start.sh boots the app inside the PLATFORM process tree, which survives
#   tool-call reaping. A process spawned from inside a tool call survives ONLY
#   if it escapes the reaper's descendant walk: launch through an ephemeral
#   subshell so the daemon re-parents to PID 1 before the tool call returns.
#   This is exactly the platform's own init-fullstack.sh `run_dev_script`
#   pattern. Plain `setsid ... &` does NOT escape (process stays a descendant
#   of the tool-call shell and dies at call end — verified empirically).
#
# USAGE:  bash scripts/revive-dev.sh
# EXIT:   0  app serving on :3000 (already up, or revived and verified)
#         1  app never became healthy (log tail printed for diagnosis)
set -u
cd "$(dirname "$0")/.."

# Reuse guard: if :3000 already answers, do nothing. NEVER kill what runs —
# a running server is platform-managed or already-revived; both are precious.
if code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 http://127.0.0.1:3000/api/health 2>/dev/null) && [ "$code" != "000" ]; then
  echo "[revive] port 3000 already serving (HTTP $code) — nothing to do"
  exit 0
fi

mkdir -p .zscripts
(
  # Sanctioned re-parent pattern: subshell exits immediately -> daemon gets
  # PPID 1 -> immune to the per-tool-call descendant reaper.
  nohup bash .zscripts/dev.sh >> .zscripts/dev.log 2>&1 </dev/null &
  echo $! > .zscripts/dev.pid
)
echo "[revive] launched dev.sh (pid $(cat .zscripts/dev.pid))"

# Wait for health. dev.sh runs db:push first; warm .next boots in ~5-15s,
# cold can take ~60s+. 90 polls x 2s = 180s budget.
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 http://127.0.0.1:3000/api/health 2>/dev/null)
  if [ "$code" = "200" ]; then
    echo "[revive] app healthy after ~$((i * 2))s"
    curl -s -o /dev/null -w "[revive] gateway :81 / -> %{http_code}\n" -m 8 http://127.0.0.1:81/ || true
    exit 0
  fi
  sleep 2
done

echo "[revive] ERROR: app never became healthy — diagnostics:"
tail -20 .zscripts/dev.log 2>/dev/null
exit 1
