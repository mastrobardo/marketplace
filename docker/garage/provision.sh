#!/bin/sh
# The `objects-init` service: the S3 key and the bucket the application uses. Runs to completion
# and exits, once the object store is healthy.
#
# The credentials live in this file rather than in `docker-compose.yml`'s environment because
# Garage's formats leave no choice: an access key id is `GK` + 24 hex characters and a secret is 64
# hex characters, neither of which can be the lowercase `marketplace_local` placeholder that AC6
# requires of every credential in the compose file. Writing them there would have meant weakening
# that check to accommodate them. They are local-only, obviously patterned, and the same values
# `.env.example` documents for whichever slice first uploads a file.
set -eu

ACCESS_KEY_ID='GK0123456789abcdef01234567'
SECRET_ACCESS_KEY='0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
KEY_NAME='marketplace-local'
BUCKET='marketplace-uploads'

# This is a second container, so admin commands need the node's address explicitly. The id is the
# node's public key, read straight from the metadata volume mounted read-only here — no file for the
# server to publish and this container to poll, and nothing to parse out of the admin API.
NODE_ID="$(garage node id -q)"
HOST="$NODE_ID@objects:3901"

# `key import` and `bucket create` both exit 1 when the thing already exists, and this service runs
# again on every `stack:up`. Asking first is why it is safe to run twice.
if garage -h "$HOST" key info "$ACCESS_KEY_ID" >/dev/null 2>&1; then
  echo "objects-init: key $KEY_NAME already imported"
else
  garage -h "$HOST" key import "$ACCESS_KEY_ID" "$SECRET_ACCESS_KEY" -n "$KEY_NAME" --yes >/dev/null
  echo "objects-init: imported key $KEY_NAME"
fi

if garage -h "$HOST" bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "objects-init: bucket $BUCKET already exists"
else
  garage -h "$HOST" bucket create "$BUCKET" >/dev/null
  echo "objects-init: created bucket $BUCKET"
fi

# Read and write for this one key, and nothing else. There is no `mc anonymous set none` equivalent
# to run: Garage has no anonymous access at all, so the private-by-default that ADR-006 requires is
# structural here rather than a policy this script has to remember to set (gotcha MEM-2026-09-07-08).
garage -h "$HOST" bucket allow "$BUCKET" --key "$KEY_NAME" --read --write >/dev/null
echo "objects-init: $BUCKET ready"
