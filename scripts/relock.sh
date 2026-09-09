#!/bin/sh
# Resolve pnpm-lock.yaml without ever editing a line of it.
#
#   ./scripts/relock.sh [target]
#
# Called by hand after a conflict, or by the `relock` merge driver (`.gitattributes`), in which
# case [target] is the path git wants the result written to.
#
# The recipe is the one used by hand on PR #152 and the reason this is a script: take the version
# from the merge base's side of history — `main` — and let pnpm re-resolve it against the
# package.json files that are already merged. A lockfile is a *resolution*, so the only correct way
# to combine two of them is to resolve again. A three-way text merge of a lockfile produces a file
# that parses, installs, and does not describe any dependency graph anyone chose.
set -eu
cd "$(dirname "$0")/.."

TARGET="${1:-pnpm-lock.yaml}"

BASE="$(git merge-base HEAD MERGE_HEAD 2>/dev/null || git rev-parse main)"
echo "relock: taking pnpm-lock.yaml from ${BASE} and re-resolving"
git show "${BASE}:pnpm-lock.yaml" > pnpm-lock.yaml

# --lockfile-only: we want the resolution, not a node_modules tree. Nothing here needs the install.
pnpm install --lockfile-only

if [ "${TARGET}" != "pnpm-lock.yaml" ]; then
  cp pnpm-lock.yaml "${TARGET}"
fi

echo "relock: pnpm-lock.yaml re-resolved. Review 'git diff' before committing."
