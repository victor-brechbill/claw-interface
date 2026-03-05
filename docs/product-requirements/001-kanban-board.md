# PRD-001: Kanban Board

**Created:** 2026-03-05
**Status:** Active
**Migrated from:** `docs/prds/PRD-001-kanban-dashboard.md`

---

## Overview

The Kanban board is the core task management interface for Claw Interface. It enables two-way communication between the Owner (product owner) and an AI Agent — the Owner drops tasks into a backlog, the Agent picks them up and tracks progress. This is the generic, open-source version suitable for any OpenClaw user.

## Core Concepts

- **Cards** — Tasks with title, description (markdown), type, priority, assignee, comments, and attachments
- **Columns** — Four stages: Backlog → In Progress → Review → Done
- **Drag-and-Drop** — Cards move between columns with position persistence
- **Comments** — Timestamped threads for async Owner ↔ Agent communication
- **Attachments** — File uploads per card with upload/download/delete

## API Endpoints

| Method   | Path                                     | Description                |
| -------- | ---------------------------------------- | -------------------------- |
| `GET`    | `/api/cards`                             | List all cards             |
| `POST`   | `/api/cards`                             | Create a new card          |
| `GET`    | `/api/cards/{id}`                        | Get card by ID             |
| `GET`    | `/api/cards/number/{number}`             | Get card by number         |
| `PUT`    | `/api/cards/{id}`                        | Update card (full replace) |
| `DELETE` | `/api/cards/{id}`                        | Delete a card              |
| `PUT`    | `/api/cards/reorder`                     | Batch reorder cards        |
| `POST`   | `/api/cards/{id}/comments`               | Add a comment              |
| `POST`   | `/api/cards/{id}/attachments`            | Upload an attachment       |
| `GET`    | `/api/cards/{id}/attachments/{filename}` | Download an attachment     |
| `DELETE` | `/api/cards/{id}/attachments/{filename}` | Delete an attachment       |

> **Note:** Only `PUT` (full replace) is implemented for card updates — there is no `PATCH` (partial update) endpoint.

## Features

- Create, edit, delete task cards with markdown descriptions
- Card types: `bugfix`, `refactor`, `feature`, `task`, `infrastructure`, `cron`
- Priority levels: `low`, `medium`, `high`, `critical`
- Drag-and-drop between columns with batch reorder
- Card detail modal with comment thread
- File attachments (upload, download, delete per card)
- Filtering by column, type, priority
- Card approval workflow (approve/flag with audit trail)
- Auto-incrementing card numbers
- Assignee tracking (`owner` or `agent`)

## Data Model

**Card** collection fields:

| Field             | Type         | Description                                                                                  |
| ----------------- | ------------ | -------------------------------------------------------------------------------------------- |
| `_id`             | ObjectID     | MongoDB document ID                                                                          |
| `number`          | int          | Auto-incrementing card number                                                                |
| `title`           | string       | Card title (required)                                                                        |
| `description`     | string       | Markdown description                                                                         |
| `type`            | enum         | `bugfix`, `refactor`, `feature`, `task`, `infrastructure`, `cron`                            |
| `project`         | string       | Project name (default: `"none"`)                                                             |
| `priority`        | enum         | `low`, `medium`, `high`, `critical`                                                          |
| `column`          | enum         | `backlog`, `in_progress`, `review`, `done`                                                   |
| `position`        | int          | Sort order within column                                                                     |
| `assignee`        | string       | `"owner"` or `"agent"`                                                                       |
| `comments`        | []Comment    | Embedded comment thread (`author`, `text`, `created_at`)                                     |
| `attachments`     | []Attachment | Embedded attachment metadata (`filename`, `size`, `contentType`, `uploadedAt`, `uploadedBy`) |
| `approved`        | bool         | Whether card description is approved                                                         |
| `flagged`         | bool         | Whether card is flagged for attention                                                        |
| `approvedBy`      | string       | Who approved the card                                                                        |
| `approvedAt`      | time         | When the card was approved                                                                   |
| `descriptionHash` | string       | MD5 hash of description (internal; approval auto-clears on description change)               |
| `created_at`      | time         | Creation timestamp                                                                           |
| `updated_at`      | time         | Last update timestamp                                                                        |

## Technical Architecture

- **Backend:** Go `net/http` ServeMux, MongoDB via `go.mongodb.org/mongo-driver/v2`, Zap logging
- **Frontend:** React + TypeScript + Vite, BIOS-themed UI
- **Security:** No public ports — all traffic via Cloudflare Tunnel with Zero Trust authentication
- **API:** RESTful JSON on `/api/cards` with full CRUD + comments + attachments + reorder

## Current State

Fully implemented. The kanban board is the primary interface, identical in functionality to the Nova Dashboard version but without Victor-specific customizations.
