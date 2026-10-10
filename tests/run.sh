#!/bin/sh
# Lua specs (tests/lua/*_spec.lua) in Lua 5.4 under docker — found by `just test` in PRODUCTION-SERVER.
set -eu
cd "$(dirname "$0")/.."
status=0
for spec in tests/lua/*_spec.lua; do
	echo "== $spec"
	docker run --rm -v "$PWD":/w:ro -w /w nickblah/lua:5.4 lua "$spec" || status=1
done
exit $status
