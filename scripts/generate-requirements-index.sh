#!/bin/bash
# Generate REQUIREMENTS-INDEX.md from labeled requirements in PRDs
# Run from repo root: ./scripts/generate-requirements-index.sh

set -euo pipefail

PRD_DIR="docs/product-requirements"
INDEX_FILE="$PRD_DIR/REQUIREMENTS-INDEX.md"

cat > "$INDEX_FILE" << 'HEADER'
# Requirements Index

> **Auto-generated** — Run `./scripts/generate-requirements-index.sh` to rebuild.
> Source of truth: individual PRD files. This is a scannable index only.

## How to Use This Index

1. **Before implementing changes**, scan this index for requirements in the affected domain
2. **If your change conflicts with a requirement**, STOP and flag it — do not silently violate or remove requirements
3. **To read full context**, follow the file reference to the source PRD
4. **After modifying requirements**, re-run this script to update the index

## Format

```
LABEL | LEVEL | Description | Source
```

---

HEADER

echo "## All Requirements" >> "$INDEX_FILE"
echo "" >> "$INDEX_FILE"
echo "| Label | Level | Description | Source |" >> "$INDEX_FILE"
echo "|-------|-------|-------------|--------|" >> "$INDEX_FILE"

for prd in "$PRD_DIR"/[0-9]*.md; do
    filename=$(basename "$prd")
    # Extract lines matching **[PRD-XXX-RNN]** pattern
    { grep -n '\*\*\[PRD-[0-9]*-R[0-9]*\]\*\*' "$prd" 2>/dev/null || true; } | while IFS= read -r match; do
        lineno=$(echo "$match" | cut -d: -f1)
        line=$(echo "$match" | cut -d: -f2-)
        
        # Extract label
        label=$(echo "$line" | grep -o 'PRD-[0-9]*-R[0-9]*')
        
        # Extract level (MUST/SHOULD/MAY)
        level="—"
        if echo "$line" | grep -q 'MUST NOT'; then
            level="MUST NOT"
        elif echo "$line" | grep -q 'MUST'; then
            level="MUST"
        elif echo "$line" | grep -q 'SHOULD NOT'; then
            level="SHOULD NOT"
        elif echo "$line" | grep -q 'SHOULD'; then
            level="SHOULD"
        elif echo "$line" | grep -q 'MAY'; then
            level="MAY"
        fi
        
        # Extract description (everything after the label, cleaned up, truncated at word boundary)
        desc=$(echo "$line" | sed 's/.*\*\*\[PRD-[0-9]*-R[0-9]*\]\*\*[[:space:]]*//' | sed 's/\*//g' | cut -c1-200 | sed 's/ [^ ]*$/…/')
        
        echo "| \`$label\` | $level | $desc | [$filename#L$lineno]($filename#L$lineno) |" >> "$INDEX_FILE"
    done
done

echo "" >> "$INDEX_FILE"
echo "---" >> "$INDEX_FILE"
echo "*Total requirements: $(grep -c 'PRD-[0-9]*-R[0-9]*' "$INDEX_FILE" 2>/dev/null || echo 0)*" >> "$INDEX_FILE"

total=$(grep -c '| `PRD-' "$INDEX_FILE" 2>/dev/null || echo 0)
echo "Generated $INDEX_FILE with $total requirements"
