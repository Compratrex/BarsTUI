#!/bin/sh
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -x "$app_dir/runtime/node" ]; then
  node_bin="$app_dir/runtime/node"
else
  node_bin=node
fi
exec "$node_bin" "$app_dir/scripts/install-command.mjs" "$@"
