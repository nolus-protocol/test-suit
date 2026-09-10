#!/bin/bash

# Bridges SPL tokens from a Solana funder to a Nolus address, one `solray-admin send-source` per
# row. A hand-run helper: it reads nothing from this repo and nothing from an env file, so every
# value it needs comes in on the command line.
#
# Usage:
#   yarn fund-main-account \
#     --recipient nolus1... \
#     --keypair ~/solana/test-funded.json \
#     --program-id Fqwdsds.... \
#     --cluster https://api.... \
#     --channel-ordinal 0 \
#     --solray-admin ~/path/to/solray-admin \
#     [--send LABEL:MINT:AMOUNT ...] [--confirm] [--dry-run]
#

set -euo pipefail

if [[ -n "${JEST_WORKER_ID:-}" ]]; then
  echo >&2 "Refusing to run from inside a test."
  exit 1
fi

##########################################################################################
# WHAT TO SEND: one "LABEL MINT AMOUNT" row per currency, amounts in base units.
# Comment out a row to skip that currency.

SEND=(
  # 6 decimals → 1 USDC. The LPN: lender deposits and repayments.
  "USDC   EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000000"

  # 9 decimals → 0.001 SOL. A `group: lease` currency, so it can be a downpayment.
  "SOL    So11111111111111111111111111111111111111112  1000000"

  # 8 decimals → 0.0005 CB_BTC. Also `group: lease`.
  "CB_BTC cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij   50000"
)

##########################################################################################

RECIPIENT=""
KEYPAIR=""
PROGRAM_ID=""
CLUSTER=""
ORDINAL=""
SOLRAY_ADMIN_BIN="${SOLRAY_ADMIN_BIN:-}"
ASSUME_YES=true
DRY_RUN=false
CLI_SEND=()

_needValue() {
  if [[ $2 -lt 2 ]]; then
    echo >&2 "'$1' needs a value."
    exit 1
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --recipient)
      _needValue "$1" $#
      RECIPIENT="$2"
      shift 2
      ;;
    --keypair)
      _needValue "$1" $#
      KEYPAIR="$2"
      shift 2
      ;;
    --program-id)
      _needValue "$1" $#
      PROGRAM_ID="$2"
      shift 2
      ;;
    --cluster)
      _needValue "$1" $#
      CLUSTER="$2"
      shift 2
      ;;
    --channel-ordinal)
      _needValue "$1" $#
      ORDINAL="$2"
      shift 2
      ;;
    --solray-admin)
      _needValue "$1" $#
      SOLRAY_ADMIN_BIN="$2"
      shift 2
      ;;
    --send)
      _needValue "$1" $#
      CLI_SEND+=("${2//:/ }")
      shift 2
      ;;
    --yes)
      ASSUME_YES=true
      shift
      ;;
    --confirm)
      ASSUME_YES=false
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo >&2 "Unknown argument '$1'. See the usage note at the top of $0."
      exit 1
      ;;
  esac
done

missing=()
[[ -n "$RECIPIENT" ]] || missing+=("--recipient")
[[ -n "$KEYPAIR" ]] || missing+=("--keypair")
[[ -n "$PROGRAM_ID" ]] || missing+=("--program-id")
[[ -n "$CLUSTER" ]] || missing+=("--cluster")
[[ -n "$ORDINAL" ]] || missing+=("--channel-ordinal")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo >&2 "Missing required argument(s): ${missing[*]}"
  echo >&2 "See the usage note at the top of $0."
  exit 1
fi

KEYPAIR="${KEYPAIR/#\~/$HOME}"
if [[ ! -f "$KEYPAIR" ]]; then
  echo >&2 "--keypair does not point at a file: $KEYPAIR"
  exit 1
fi

SOLRAY_ADMIN_BIN="${SOLRAY_ADMIN_BIN:-solray-admin}"
SOLRAY_ADMIN_BIN="${SOLRAY_ADMIN_BIN/#\~/$HOME}"

if [[ "$SOLRAY_ADMIN_BIN" == */* ]]; then
  if [[ ! -x "$SOLRAY_ADMIN_BIN" ]]; then
    echo >&2 "--solray-admin is not an executable file: $SOLRAY_ADMIN_BIN"
    exit 1
  fi
elif ! command -v "$SOLRAY_ADMIN_BIN" >/dev/null 2>&1; then
  echo >&2 "'$SOLRAY_ADMIN_BIN' was not found in \$PATH."
  echo >&2 "  Pass --solray-admin <path>, or set SOLRAY_ADMIN_BIN. It is built from"
  echo >&2 "  nolus-protocol/ibc-solray at the same ref as the deployed program."
  exit 1
fi

if [[ ${#CLI_SEND[@]} -gt 0 ]]; then
  SEND=("${CLI_SEND[@]}")
fi

labels=()
mints=()
amounts=()

for row in "${SEND[@]}"; do
  # Skips the commented-out template rows.
  [[ "$row" =~ ^[[:space:]]*(#|$) ]] && continue

  read -r label mint amount _rest <<<"$row"

  if [[ -z "$label" || -z "$mint" || -z "$amount" ]]; then
    echo >&2 "Bad row '$row'. Expected: LABEL MINT AMOUNT"
    exit 1
  fi

  if [[ ! "$amount" =~ ^[1-9][0-9]*$ ]]; then
    echo >&2 "$label: amount '$amount' is not a positive integer of base units."
    exit 1
  fi

  labels+=("$label")
  mints+=("$mint")
  amounts+=("$amount")
done

if [[ ${#labels[@]} -eq 0 ]]; then
  echo >&2 "Nothing to send. Fill in the SEND table or pass --send LABEL:MINT:AMOUNT."
  exit 1
fi

# ── The plan, then a confirmation ─────────────────────────────────────────────────────────────
echo "About to bridge from Solana to Nolus:"
echo "  recipient: $RECIPIENT"
echo "  cluster:   $CLUSTER"
echo "  program:   $PROGRAM_ID"
echo "  channel:   ordinal $ORDINAL"
echo "  funder:    $KEYPAIR"
echo "  cli:       $SOLRAY_ADMIN_BIN"
echo
for i in "${!labels[@]}"; do
  printf '  %-8s %-46s %s\n' "${labels[$i]}" "${mints[$i]}" "${amounts[$i]}"
done
echo

if [[ "$DRY_RUN" == true ]]; then
  echo "--dry-run: nothing was sent."
  exit 0
fi

if [[ "$ASSUME_YES" != true ]]; then
  read -rp "Send these? Type yes to continue: " answer

  if [[ "$answer" != "yes" ]]; then
    echo "Nothing was sent."
    exit 1
  fi
fi

# ── Send ──────────────────────────────────────────────────────────────────────────────────────
for i in "${!labels[@]}"; do
  echo "── ${labels[$i]}: ${amounts[$i]}"

  out=$(SOLANA_RPC_URL="$CLUSTER" \
    IBC_SOLRAY_PROGRAM_ID="$PROGRAM_ID" \
    SOLANA_BOOTSTRAP_KEYPAIR="$KEYPAIR" \
    "$SOLRAY_ADMIN_BIN" send-source \
    --channel-ordinal "$ORDINAL" \
    --recipient "$RECIPIENT" \
    --mint "${mints[$i]}" \
    --amount "${amounts[$i]}" 2>&1) || true

  # Gated on the signature, not on the exit code: solray-admin returns 0 while reporting
  # `custom program error: 0x..` with nothing signed and nothing moved, usually because the CLI is
  # behind the deployed program. Stopping here keeps a systemic failure from burning fees per row.
  if ! signature=$(grep -xE '[1-9A-HJ-NP-Za-km-z]{60,90}' <<<"$out" | tail -n 1); then
    echo >&2 "  ✗ did not sign - nothing escrowed, nothing moved."
    echo >&2 "    $(printf '%s' "$out" | tail -n 1 | cut -c1-200)"
    echo >&2 "  Stopped after $i of ${#labels[@]} row(s)."
    exit 1
  fi

  echo "  ✓ $signature"
done

echo
echo "Sent ${#labels[@]} transfer(s). The vouchers still need the relayer - check the balances:"
echo "  nolusd q bank balances $RECIPIENT --node <nolus rpc>"
