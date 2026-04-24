#!/usr/bin/env bash
# Terraform file-integrity preflight. Run before every apply to catch:
#   - silent truncation (half a file missing after a partial write)
#   - accidental non-ASCII in AWS-facing string fields (em-dash in SG descriptions etc.)
#   - terraform fmt drift
#   - validate failures
#
# Prints a per-file manifest (path, lines, sha256) that can be diffed
# against git history to spot unexplained shrinkage.
#
# Usage:  ./preflight.sh          # default run
#         ./preflight.sh --strict # also fail on any non-ASCII byte

set -euo pipefail

cd "$(dirname "$0")"

STRICT=0
[[ "${1:-}" == "--strict" ]] && STRICT=1

echo "==> terraform fmt -check"
terraform fmt -check -recursive

echo "==> terraform validate (needs init first, but skips on no-state)"
terraform validate || {
  echo "!! terraform validate failed — is backend initialized?"
  exit 1
}

echo "==> per-file manifest (lines, sha256)"
printf "%-40s %6s  %s\n" "FILE" "LINES" "SHA256"
for f in *.tf; do
  lines=$(wc -l < "$f")
  sha=$(sha256sum "$f" | awk '{print $1}')
  printf "%-40s %6d  %s\n" "$f" "$lines" "$sha"

  # Sanity: any file under 10 lines is suspicious — almost certainly a truncation.
  if (( lines < 10 )); then
    echo "!! $f has only $lines lines — possible truncation" >&2
    exit 2
  fi
done

if (( STRICT )); then
  echo "==> ASCII check (strict)"
  if grep -rlP '[^\x00-\x7F]' . --include='*.tf' --include='*.tfvars' --include='*.hcl' 2>/dev/null; then
    echo "!! non-ASCII bytes found in files listed above — AWS rejects em-dashes in SG descriptions etc." >&2
    exit 3
  fi
fi

echo "==> OK"
