#!/usr/bin/env bash
#
# Shared preconditions for the `set-*.sh` helpers. Sourced, never run.
#
# The helpers exist for somebody who should not have to know what `tsx` is, so every failure here
# ends in an instruction rather than a diagnosis. Each one is checked *before* anything is
# generated: discovering that `gh` is missing after a value exists is how a value ends up pasted
# somewhere to avoid losing it.
#
# W0-T31.

set -euo pipefail

# Colours, but only when something is there to read them. `tput` fails on a dumb terminal.
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD="$(tput bold)"; RED="$(tput setaf 1)"; GREEN="$(tput setaf 2)"
  YELLOW="$(tput setaf 3)"; RESET="$(tput sgr0)"
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

die() {
  printf '\n%sCannot continue.%s %s\n\n' "$RED$BOLD" "$RESET" "$1" >&2
  shift
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  printf '\n' >&2
  exit 1
}

# Everything runs from the repository root, so a relative script path resolves the same way no
# matter where the person happens to be standing.
require_repo_root() {
  command -v git >/dev/null 2>&1 || die "git is not installed." \
    "Install it from https://git-scm.com/downloads and run this again."

  # The caller has already cd'd to the script's own directory, so this only fails when the script
  # has been copied out of the project — which is worth saying, because "not a git repository" sends
  # somebody looking in the wrong place entirely.
  local root
  root="$(git rev-parse --show-toplevel 2>/dev/null)" || die \
    "this script is not inside the marketplace project." \
    "It needs the rest of the project to work, so it cannot be copied somewhere else" \
    "and run on its own." \
    "" \
    "Run it from where it lives, inside the project folder:" \
    "" \
    "  ./scripts/secrets/set-preview-seed-password.sh"

  cd "$root"
}

require_gh() {
  command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is not installed." \
    "macOS:   brew install gh" \
    "Windows: winget install GitHub.cli" \
    "Linux:   https://github.com/cli/cli#installation" \
    "" \
    "Then run: gh auth login"

  gh auth status >/dev/null 2>&1 || die "you are not signed in to GitHub." \
    "Run this first, and follow the prompts:" \
    "" \
    "  gh auth login" \
    "" \
    "You need permission to edit this repository's environment secrets."
}

# Refuse a captured session here, as well as in the generator.
#
# `generate.ts` is the authority on this and would refuse anyway — but only after the preflight and
# the confirmation prompt, which is a confusing place to be told. It also makes the prompt itself
# meaningless: a piped `yes` answers it. Failing first, for the same reason, in plain language.
require_terminal() {
  [ -t 1 ] || die "this needs to run in a terminal window." \
    "It produces a password, so anything that records the output — a pipe, a file," \
    "a CI job, an AI coding assistant — would record that too." \
    "" \
    "Open a terminal, go to the project folder, and run the command directly." \
    "Nothing was created."
}

require_node() {
  command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed." \
    "Install Node.js 22+ from https://nodejs.org, then run:" \
    "" \
    "  npm install -g pnpm" \
    "  pnpm install"

  [ -d node_modules ] || die "this project's dependencies are not installed." \
    "Run this once, then try again:" \
    "" \
    "  pnpm install"
}

# `gh secret set` overwrites an existing secret without asking. For somebody who is not sure what
# this does, one confirmation is worth more than any amount of prose above it.
confirm() {
  local prompt="$1"
  printf '\n%s%s%s\n' "$BOLD" "$prompt" "$RESET"
  printf 'Type %syes%s to continue: ' "$BOLD" "$RESET"

  local answer=""
  read -r answer || true
  if [ "$answer" != "yes" ]; then
    printf '\n%sNothing was changed.%s\n\n' "$YELLOW" "$RESET"
    exit 0
  fi
}

# Hand off to the generator.
#
# ⚠ `exec`, and deliberately **not** `$(...)` or a pipe. Command substitution would capture the
# child's stdout — which is the secret — into a shell variable, and would also make stdout a pipe,
# so `generate.ts` would refuse to run at all. Both of those are the guarantee this whole tool is
# built on (`W0-T31` §2). Keep it an exec.
run_generator() {
  local secret_name="$1"
  exec pnpm exec tsx scripts/secrets/generate.ts "$secret_name" --write
}
