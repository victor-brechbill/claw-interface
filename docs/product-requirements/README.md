# Product Requirements

This folder contains Product Requirement Documents (PRDs) for the Claw Interface.

PRDs describe **what** the system does and **why** — they're permanent reference docs covering architecture, features, and design decisions. For development workflow and conventions, see `CLAUDE.md`.

## Documents

| File | Description |
|------|-------------|
| `001-kanban-board.md` | Generic kanban board for any OpenClaw user |
| `002-system-monitoring.md` | Usage, sessions, cron runs, system health |

## Naming Convention

Files follow `XXX-short-name.md` pattern (e.g., `001-kanban-board.md`).

## Relationship to Nova Dashboard

Claw Interface is a generic, open-source version of the Nova Dashboard. Victor-specific features (Tommy/social media, stocks pages) are stripped out, leaving a clean template that any OpenClaw user can deploy.
