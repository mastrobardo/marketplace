#!/usr/bin/env bash
#
# Set PREVIEW_SEED_DEMO_PASSWORD — the password the preview demo accounts get.
#
# Takes no arguments on purpose. Whoever runs this may not be the person who wrote it, so there is
# nothing to get wrong: run it, read what it says, type yes.
#
# W0-T31. The generator it calls is scripts/secrets/generate.ts; this only checks the things that
# make that script fail confusingly, and asks before overwriting anything.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
# shellcheck source=scripts/secrets/_common.sh
source ./_common.sh

require_terminal
require_repo_root
require_gh
require_node

cat <<'EXPLANATION'

Setting PREVIEW_SEED_DEMO_PASSWORD
────────────────────────────────────────────────────────────────────────

This creates a random password and stores it in GitHub, for the "preview"
environment. It is the password for the two demo accounts that the preview
database is seeded with:

  client@marketplace.local     (a customer)
  provider@marketplace.local   (a tradesperson)

The password is NOT shown, here or anywhere. It goes straight to GitHub.
Nobody — including whoever runs this — ends up knowing what it is.

If you need a password somebody can actually use, stop and run this instead,
which prints one for you to copy:

  pnpm exec tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD

EXPLANATION

confirm "This will replace any existing PREVIEW_SEED_DEMO_PASSWORD."

run_generator "PREVIEW_SEED_DEMO_PASSWORD"
