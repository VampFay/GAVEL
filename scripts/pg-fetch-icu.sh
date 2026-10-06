#!/usr/bin/env bash
# GAVEL — fetch ICU 60 runtime libs for the embedded PostgreSQL binaries.
#
# The @embedded-postgres/linux-x64 PG 16 binaries link the ICU 60 sonames
# (libicuuc.so.60 etc.). Debian 13 / Ubuntu 24.04 ship ICU 72-76, so on
# those systems the pinned copies live in .pg-embedded/libs/ (prepended to
# LD_LIBRARY_PATH by scripts/pg-embedded.ts).
#
# Idempotent: skips when the sonames already resolve for this user, or when
# the pinned copies already exist.
set -euo pipefail
cd "$(dirname "$0")/.."

LIBS=.pg-embedded/libs
mkdir -p "$LIBS"

if [ -e "$LIBS/libicuuc.so.60" ]; then
  echo "icu60: pinned copies already present"
  exit 0
fi

# Already resolvable system-wide? Then nothing to fetch.
if ldconfig -p 2>/dev/null | grep -q 'libicuuc.so.60'; then
  echo "icu60: system soname present — nothing to do"
  exit 0
fi

echo "icu60: fetching libicu60 (Ubuntu bionic archive — pinned, reproducible)"
curl -fsSL -o /tmp/gavel-libicu60.deb \
  "http://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu60_60.2-3ubuntu3_amd64.deb"
dpkg-deb -x /tmp/gavel-libicu60.deb /tmp/gavel-libicu60
cp /tmp/gavel-libicu60/usr/lib/x86_64-linux-gnu/libicuuc.so.60* \
   /tmp/gavel-libicu60/usr/lib/x86_64-linux-gnu/libicudata.so.60* \
   /tmp/gavel-libicu60/usr/lib/x86_64-linux-gnu/libicui18n.so.60* \
   "$LIBS/"
rm -rf /tmp/gavel-libicu60 /tmp/gavel-libicu60.deb
echo "icu60: pinned to $LIBS"
