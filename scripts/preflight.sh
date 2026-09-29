#!/bin/bash

# Exits non-zero before a pass may spend. Runs the gates as assertions in
# src/preflight/preflight.test.ts, so they reuse the suite's own clients rather than shelling out.

set -exuo pipefail

HOME_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)
cd "$HOME_DIR"

ENV_FILE="${TEST_ENV_FILE:-.env}"

echo "── Preflight for $ENV_FILE"

if ! TEST_ENV_FILE="$ENV_FILE" npx jest --runInBand \
  "--testPathIgnorePatterns=/node_modules/" \
  "--testPathPatterns=src/preflight/preflight\.test\.ts$"; then
  echo >&2 "── Preflight failed. Nothing was spent."
  exit 1
fi

echo "── Preflight passed. Note that every check above is a snapshot: prices go stale in ten"
echo "   minutes, so the run re-checks immediately before each spend."
