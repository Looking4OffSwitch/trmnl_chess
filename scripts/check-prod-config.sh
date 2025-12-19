#!/usr/bin/env bash
set -euo pipefail

# Fails if production config files contain local/dev hosts.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILES=(
  "${ROOT_DIR}/trmnl_chess/src/settings.yml"
  "${ROOT_DIR}/trmnl_chess/.trmnlp.yml"
)

BAD_PATTERNS='localhost|127\.0\.0\.1|192\.168\.|http:\/\/'

failed=0
for f in "${FILES[@]}"; do
  if grep -E "${BAD_PATTERNS}" "$f" >/dev/null 2>&1; then
    echo "❌ Found dev/local URL in ${f}" >&2
    failed=1
  fi
done

if [ $failed -ne 0 ]; then
  echo "Fix the above files (use scripts/restore-prod-config.sh) before deploying." >&2
  exit 1
fi

echo "✅ Production config files are clean."
