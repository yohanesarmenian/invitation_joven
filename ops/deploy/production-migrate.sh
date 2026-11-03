#!/bin/sh
# Run in the resource's Compose working directory; supply its exact Compose args.
set -eu
if [ "$#" -eq 0 ]; then
  echo 'Supply the resource Compose arguments (-p PROJECT --env-file FILE -f FILE).' >&2
  exit 1
fi
docker compose "$@" up -d --wait postgres
docker compose "$@" run --rm migrate
# Diagnostic/manual gate only. Production startup is also gated in Compose.
# A standalone successful run is not approval to bypass dependencies on rollout.
