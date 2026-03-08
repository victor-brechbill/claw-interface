# Product Requirements Documentation

This folder contains product requirement documents (PRDs) that guide development decisions.

## Purpose

PRDs are **enforceable specifications**, not just documentation. Any code change that violates, modifies, or removes functionality defined in a PRD must be flagged before implementation.

## Requirement Labels

Every PRD contains **labeled requirements** using the format:

```
**[PRD-XXX-R01]** The system MUST [do something specific and testable].
```

Format: `PRD-{number}-R{seq}` where:

- `{number}` = PRD number (e.g., `001`, `005`)
- `{seq}` = requirement sequence within that PRD (e.g., `01`, `02`)

Keywords follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119):

- **MUST / MUST NOT** — Absolute requirement or prohibition
- **SHOULD / SHOULD NOT** — Strong recommendation, exceptions need justification
- **MAY** — Optional, implementation discretion

## Requirement Index

`REQUIREMENTS-INDEX.md` contains a machine-scannable flat index of ALL requirements. Rebuild with:

```bash
./scripts/generate-requirements-index.sh
```

## Modifying Requirements

1. **Identify** the affected requirement label(s)
2. **Flag** the conflict — agents must not silently violate requirements
3. **Get approval** for significant changes
4. **Update** PRD + index in the same PR
5. **Reference** in commit: `Updates PRD-XXX-R01: [reason]`

## Current PRDs

- `001-kanban-board.md` — PRD-001: Kanban Board
- `002-system-monitoring.md` — PRD-002: System Monitoring

## PRD Template

Use `_template.md` as a starting point for new PRDs.
