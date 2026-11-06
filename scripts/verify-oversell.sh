#!/usr/bin/env bash
set -euo pipefail
# Offline verifier: dá»«ng traffic, dÃ¹ng event má»›i, cháº¡y trÆ°á»›c khi hold háº¿t TTL.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/verify-oversell.mjs" "$@"
