#!/bin/sh
# One-time local git setup for this clone. Safe to re-run.
#
#   ./scripts/setup-git.sh
#
# Two things, both of which were previously undocumented steps a contributor had to notice:
#
#  1. the identity guard hook (`.githooks/pre-commit`), which keeps a work account off this repo;
#  2. the merge drivers for the generated files listed in `.gitattributes` (W0-T23), which resolve
#     a conflict by recomputing the file instead of stitching two sides together.
set -eu
cd "$(dirname "$0")/.."

git config core.hooksPath .githooks

# A merge driver is invoked as: <driver> %O %A %B %L %P
#   %A is "ours", and is also the file git will keep. Both sides are discarded and the file is
#   recomputed from the records, which is only sound because the inputs cannot conflict.
git config merge.regen-memory.name 'regenerate memory/LONG_TERM.md from the records'
git config merge.regen-memory.driver \
  'node --experimental-strip-types scripts/render-memory.ts >/dev/null && cp memory/LONG_TERM.md %A'

# The lockfile is a function of the package.json files. A hand-merged lockfile is not a lockfile —
# it is a file that resembles one — and neither is a line-merged one.
git config merge.relock.name 'resolve pnpm-lock.yaml by re-resolving it'
git config merge.relock.driver './scripts/relock.sh %A'

echo "git configured for this clone:"
echo "  core.hooksPath      .githooks              (identity guard)"
echo "  merge.regen-memory  memory/LONG_TERM.md    (regenerated, never merged)"
echo "  merge.relock        pnpm-lock.yaml         (re-resolved, never merged)"
