#!/bin/sh
set -eu
case "${APP:-}" in
  api)
    cd /workspace/apps/api
    exec node dist/main.js
    ;;
  admin-web)
    cd /workspace/apps/admin-web
    exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3001
    ;;
  invitation-web)
    cd /workspace/apps/invitation-web
    exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3000
    ;;
  *) echo "Unsupported APP" >&2; exit 1 ;;
esac
