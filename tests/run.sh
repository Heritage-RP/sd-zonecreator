#!/bin/sh
# Lua specs (tests/lua/*_spec.lua) in Lua 5.4 under docker — found by `just test` in PRODUCTION-SERVER.
set -eu
cd "$(dirname "$0")/.."
# Git Bash on Windows: docker needs a Windows path, and MSYS would rewrite `-w /w` into W:/
here=$PWD
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) here=$(pwd -W); export MSYS_NO_PATHCONV=1 ;; esac
status=0
for spec in tests/lua/*_spec.lua; do
	echo "== $spec"
	docker run --rm -v "$here":/w:ro -w /w nickblah/lua:5.4 lua "$spec" || status=1
done
exit $status
