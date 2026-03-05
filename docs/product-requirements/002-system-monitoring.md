# PRD-002: System Monitoring

**Created:** 2026-03-05
**Status:** Active

---

## Overview

System monitoring provides OpenClaw users with visibility into AI agent sessions, token usage, cron job execution, and system health. It's the generic version of the Nova Dashboard's monitoring — any OpenClaw user can track their agent's activity.

## Core Concepts

- **Sessions** — Active/idle/stale AI agent sessions with token counts and model details
- **Session Stats** — Aggregated totals (session count, total tokens, per-model breakdown)
- **Cron Runs** — Background job execution history
- **System Health** — Gateway connection, agent status, domain/SSL checks, diagnostics

## API Endpoints

### Sessions

| Method   | Path                  | Description                                                         |
| -------- | --------------------- | ------------------------------------------------------------------- |
| `GET`    | `/api/sessions`       | List all sessions with token counts, status, agent/model info       |
| `GET`    | `/api/sessions/stats` | Aggregated stats: total sessions, total tokens, per-model breakdown |
| `DELETE` | `/api/sessions/{key}` | Delete a specific session                                           |

### System

| Method | Path                        | Description                                         |
| ------ | --------------------------- | --------------------------------------------------- |
| `GET`  | `/api/system/stats`         | System-level statistics                             |
| `GET`  | `/api/system/agents`        | List known agents                                   |
| `GET`  | `/api/system/cron-runs`     | Cron job run history                                |
| `GET`  | `/api/system/cron-history`  | Historical cron data                                |
| `GET`  | `/api/system/activity-grid` | Repo activity grids (configurable via `VITE_REPOS`) |
| `GET`  | `/api/system/metrics/peaks` | Peak usage metrics                                  |
| `GET`  | `/api/system/domain-ssl`    | Domain and SSL certificate status                   |
| `GET`  | `/api/system/token-status`  | Token/auth status                                   |
| `GET`  | `/api/system/kernel-info`   | Kernel version info                                 |
| `GET`  | `/api/system/config-info`   | Configuration info                                  |
| `POST` | `/api/system/doctor`        | Run system diagnostics                              |
| `GET`  | `/api/system/doctor/status` | Check diagnostics run status                        |
| `GET`  | `/api/system/doctor/report` | Get diagnostics report                              |

## Features

- Session list with status (active/idle/stale), agent, model, and token counts
- Aggregated session statistics with per-model breakdown
- Cron job run history and historical data
- Repo activity grids configurable via `VITE_REPOS` env var
- Gateway WebSocket connection monitoring
- System diagnostics (doctor) with async execution
- Domain/SSL monitoring
- Kernel and config info with rollback capabilities

## Technical Architecture

- **Backend:** Go handlers reading session data from gateway JSON files on disk; system endpoints query MongoDB and local state
- **Frontend:** React pages in BIOS-themed navigation
- **Configuration:** `GATEWAY_WS_URL`, `VITE_REPOS` for customization
- **Data:** Session data read from OpenClaw gateway's local session files; system data from MongoDB and OS queries

## Current State

Fully implemented. Session tracking, system monitoring, cron history, and diagnostics are functional. Designed to work out-of-the-box for any OpenClaw deployment.

> **Note:** There is no CSV export endpoint. Usage cost tracking is not currently implemented — the sessions API provides token counts only.
