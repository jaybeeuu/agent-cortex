#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --title <idea title> [--complex]"
  exit 1
}

title=""
complex="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)
      shift
      [[ $# -gt 0 ]] || usage
      title="$1"
      ;;
    --complex)
      complex="true"
      ;;
    *)
      usage
      ;;
  esac
  shift
done

[[ -n "$title" ]] || usage

slug="$(printf '%s' "$title" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"

if [[ -z "$slug" ]]; then
  echo "Error: title produced an empty slug after normalization." >&2
  exit 1
fi

base_dir=".working-docs/ideas"
if [[ "$complex" == "true" ]]; then
  file_path="${base_dir}/${slug}/${slug}.md"
else
  file_path="${base_dir}/${slug}.md"
fi

mkdir -p "$(dirname "$file_path")"

if [[ -e "$file_path" ]]; then
  echo "Error: file already exists: $file_path" >&2
  exit 1
fi

created_on="$(date -u +%Y-%m-%d)"

cat > "$file_path" <<EOF
# Idea: ${title}

## Status
Backlog idea (not implementation-ready)

## Created
${created_on}

## Problem
TODO

## Who benefits
TODO

## Proposed outcome
TODO

## Validity check
- Evidence we already have: TODO
- Riskiest assumption: TODO
- What would invalidate this idea: TODO

## Constraints
TODO

## Next validation step
TODO

## Notes
TODO
EOF

printf '%s\n' "$file_path"
