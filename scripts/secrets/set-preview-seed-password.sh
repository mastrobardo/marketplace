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

This creates a random password, stores it in GitHub for the "preview"
environment, and then SHOWS IT TO YOU. Write it down — GitHub will not show
it again, and neither will this script.

It is the password for the two demo accounts the preview database is seeded
with, so somebody has to know it:

  client@marketplace.local     (a customer)
  provider@marketplace.local   (a tradesperson)

It is shown because you are at a terminal. This script refuses to run when
anything could be recording its output — a pipe, a log, a CI job, an AI
assistant — so the only thing that ever sees the password is a person.

EXPLANATION

confirm "This will replace any existing PREVIEW_SEED_DEMO_PASSWORD."

run_generator "PREVIEW_SEED_DEMO_PASSWORD"
