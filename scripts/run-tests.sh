#!/bin/bash

# Runs the suite end to end: preflight, then the tests.
#
# Usage: scripts/run-tests.sh [jest path or pattern ...]
#

set -euo pipefail

HOME_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd .. && pwd)
cd "$HOME_DIR"

export TEST_ENV_FILE="${TEST_ENV_FILE:-.env}"
export RUN_ID="${RUN_ID:-$(date +%Y%m%d-%H%M%S)}"

if [[ ! "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo >&2 "RUN_ID='$RUN_ID' is used as a directory name; use only letters, digits, . _ or -."
  exit 1
fi

RUN_DIR="$HOME_DIR/.runs/$RUN_ID"
export BUDGET_LEDGER="$RUN_DIR/spend.jsonl"
SUMMARY="$RUN_DIR/summary.tsv"

mkdir -p "$RUN_DIR"
[[ -f "$SUMMARY" ]] || printf 'suite\tverdict\tseconds\n' >"$SUMMARY"

echo "── run '$RUN_ID', env file '$TEST_ENV_FILE'"
echo "   artefacts: $RUN_DIR"

_record() {
  printf '%s\t%s\t%s\n' "$1" "$2" "$3" >>"$SUMMARY"
}

report_done=false
_report() {
  [[ "$report_done" == "true" ]] && return
  report_done=true

  if [[ -f "$BUDGET_LEDGER" ]]; then
    echo "── spend recorded this run:"
    sed 's/^/   /' "$BUDGET_LEDGER"
  else
    echo "── no spend was recorded. That is not the same as nothing being spent: util/budget.ts"
    echo "   is not yet wired into the suites, so the ceiling and the swap floor did not fire."
  fi

  echo "── summary ($SUMMARY)"
  column -t -s $'\t' "$SUMMARY" | sed 's/^/   /'
}

# ── Preflight ─────────────────────────────────────────────────────────────────────────────────
if [[ ! -f "$HOME_DIR/$TEST_ENV_FILE" ]]; then
  echo >&2 "No env file at $HOME_DIR/$TEST_ENV_FILE."
  echo >&2 "Generate one with 'yarn prepare-env'."
  exit 1
fi

if [[ "${SKIP_PREFLIGHT:-false}" != "true" ]]; then
  echo "── preflight"
  bash "$HOME_DIR/scripts/preflight.sh"
  _record "preflight" "PASS" "-"
fi

trap _report EXIT INT TERM

# ── The suites ────────────────────────────────────────────────────────────────────────────────
echo "── suites (single invocation)"
started=$SECONDS

if npx jest --runInBand "$@"; then
  _record "suites" "PASS" "$((SECONDS - started))"
else
  _record "suites" "FAIL" "$((SECONDS - started))"
  exit 1
fi
