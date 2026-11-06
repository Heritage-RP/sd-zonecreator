#!/bin/sh
# Lua specs (tests/lua/*_spec.lua) in Lua 5.4 under docker — found by `just test` in PRODUCTION-SERVER.
set -eu
cd "$(dirname "$0")/.."
# docker: the machine's; on Windows, when it does not answer (no Docker Desktop), the Docker engine of a WSL
# distribution (HRP_WSL_DOCKER, default Ubuntu). Git Bash: a Windows path for the mount, and MSYS_NO_PATHCONV so
# that `-w /w` is not rewritten into W:/
here=$PWD
docker=docker
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*)
	export MSYS_NO_PATHCONV=1
	here=$(pwd -W)
	if ! timeout 10 docker info >/dev/null 2>&1; then
		distro=${HRP_WSL_DOCKER:-Ubuntu}
		docker="wsl.exe -d $distro -- docker"
		here=$(wsl.exe -d "$distro" -- wslpath -a "$here" | tr -d '\r')
	fi ;;
esac
status=0
for spec in tests/lua/*_spec.lua; do
	echo "== $spec"
	$docker run --rm -v "$here":/w:ro -w /w nickblah/lua:5.4 lua "$spec" || status=1
done
exit $status
