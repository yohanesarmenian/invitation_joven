#!/bin/sh
# Run in the resource's Compose working directory; supply its exact Compose args.
set -eu
if [ "$#" -eq 0 ]; then
  echo 'Supply the resource Compose arguments (-p PROJECT --env-file FILE -f FILE).' >&2
  exit 1
fi
docker compose "$@" up -d --wait postgres
docker compose "$@" --profile migration run --rm migrate
