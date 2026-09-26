#!/bin/sh
# The `objects` service: a Garage server, and the cluster layout it cannot serve without.
#
# Why the layout is assigned *here* and not in `objects-init`: a fresh Garage node answers RPC
# immediately but refuses reads and writes until a layout gives it a role — `GET /health` is 503 and
# `garage health` exits 1 until then. `objects-init` waits for `service_healthy` (AC4), so doing it
# there would deadlock: the provisioner would wait for a node that is waiting to be provisioned.
# Assigning a role is a property of the node anyway, not of this application's buckets.
set -eu

garage server &
server=$!

# `docker stop` signals PID 1, which is this shell. Without this, Garage would only ever be killed.
trap 'kill -TERM "$server" 2>/dev/null || true' INT TERM

# RPC answers before the layout exists — that is the window this loop is waiting for.
until garage status >/dev/null 2>&1; do
  if ! kill -0 "$server" 2>/dev/null; then
    echo "objects: garage server exited before its RPC port answered" >&2
    exit 1
  fi
  sleep 1
done

if garage status | grep -q 'NO ROLE ASSIGNED'; then
  # 1G of capacity on a single node with `replication_factor = 1`: a number Garage needs for its
  # partition maths, not a quota on the volume.
  garage layout assign "$(garage node id -q)" --zone local --capacity 1G

  # `layout apply` refuses any version that is not exactly one past the current one, and prints the
  # number it wants. Reading it back beats assuming 1 — a volume that has been through this before
  # is at a higher version, and assuming would break exactly the case `stack:reset` does not cover.
  version="$(garage layout show | sed -n 's/.*layout apply --version \([0-9][0-9]*\).*/\1/p' | tail -1)"
  if [ -z "$version" ]; then
    echo "objects: garage staged no layout change to apply" >&2
    exit 1
  fi
  garage layout apply --version "$version"
fi

wait "$server"
