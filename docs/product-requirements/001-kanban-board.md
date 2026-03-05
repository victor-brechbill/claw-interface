# PRD-001: Kanban Board

**Created:** 2026-03-05
**Status:** Active
**Migrated from:** `docs/prds/PRD-001-kanban-dashboard.md`

---

## Overview

The Kanban board is the core task management interface for Claw Interface. It enables two-way communication between the Owner (product owner) and an AI Agent — the Owner drops tasks into a backlog, the Agent picks them up and tracks progress. This is the generic, open-source version suitable for any OpenClaw user.

## Core Concepts

- **Cards** — Tasks with title, description (markdown), type, priority, assignee, and comments
- **Columns** — Four stages: Backlog → In Progress → Review → Done
- **Drag-and-Drop** — Cards move between columns with position persistence
- **Comments** — Timestamped threads for async Owner ↔ Agent communication

## Features

- Create, edit, delete task cards with markdown descriptions
- Card types: Bugfix, Refactor, Feature
- Priority levels: Low, Medium, High, Critical
- Drag-and-drop between columns with batch reorder
- Card detail modal with comment thread
- Filtering by column, type, priority
- PUT (full replace) and PATCH (partial update) APIs
- Assignee tracking (Owner or Agent)

## Technical Architecture

- **Backend:** Go `net/http` ServeMux, MongoDB via `go.mongodb.org/mongo-driver/v2`, Zap logging
- **Frontend:** React + TypeScript + Vite, BIOS-themed UI
- **Security:** No public ports — all traffic via Cloudflare Tunnel with Zero Trust authentication
- **API:** RESTful JSON on `/api/cards` with full CRUD + comments + reorder

## Data Model

**Card** collection: `_id`, `title`, `description`, `type` (enum), `priority` (enum), `column` (enum), `position`, `assignee` ("owner"|"agent"), `comments` (embedded), `created_at`, `updated_at`.

## Current State

Fully implemented. The kanban board is the primary interface, identical in functionality to the Nova Dashboard version but without Victor-specific customizations.
