# PRD-002: System Monitoring

**Created:** 2026-03-05
**Status:** Active

---

## Overview

System monitoring provides OpenClaw users with visibility into AI agent usage, session costs, and cron job execution. It's the generic version of the Nova Dashboard's monitoring — any OpenClaw user can track their agent's activity and spending.

## Core Concepts

- **Usage Summary** — Aggregated cost data with daily breakdowns
- **Sessions** — Individual AI agent sessions with cost and model details
- **Cron Runs** — Background job execution history
- **Gateway Connection** — OpenClaw gateway WebSocket status

## Features

- Usage cost summary with configurable time window (`/api/usage/summary?days=7`)
- Session list with sorting and filtering (`/api/usage/sessions`)
- Session detail view (`/api/usage/session/{key}`)
- CSV export of usage data (`/api/usage/export-csv`)
- Cron job run history (`/api/system/cron-runs`)
- Configurable repo activity grids via `VITE_REPOS` env var
- Gateway WebSocket connection monitoring

## Technical Architecture

- **Backend:** Go handlers, MongoDB for usage/session data
- **Frontend:** React pages in BIOS-themed navigation
- **Configuration:** `GATEWAY_WS_URL`, `VITE_REPOS` for customization
- **Data:** Usage and session data collected from OpenClaw gateway

## Current State

Fully implemented. Usage tracking, session history, CSV export, and cron monitoring are functional. Designed to work out-of-the-box for any OpenClaw deployment.
