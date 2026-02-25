# Nova Dashboard — Architecture & Operations

_Last updated: 2026-02-12 by Nova_

---

## Overview

The Nova Dashboard is Victor's command center for managing AI agents, monitoring systems, and tracking projects. It runs on an EC2 instance and serves as the hub for multiple interconnected services.

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Nova EC2 Instance                     │
│                  (Ubuntu, us-east-2)                     │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Nova Dashboard│  │   OpenClaw   │  │  NS Alpha     │  │
│  │  (Go + React) │  │   Gateway    │  │  (Go + React) │  │
│  │  :3080        │  │   (Node.js)  │  │  :5174/:8081  │  │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘  │
│         │                  │                  │           │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴────────┐  │
│  │  MongoDB     │  │  Telegram    │  │  Kratos       │  │
│  │  (Docker)    │  │  Bot API     │  │  (Auth, Docker)│ │
│  │  :27017      │  │              │  │  :4445/:4446  │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  Cloudflare Tunnel                                   ││
│  │  nova.victorbrechbill.com → :3080                    ││
│  │  alpha.neighborhoodshare.org → :5174/:8081           ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│              DSP Production Server                       │
│           (EC2, us-east-2, 18.119.213.209)              │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │  DSP API     │  │  DSP Scheduler│                    │
│  │  (Node.js)   │  │  (Node.js)   │                     │
│  │  systemd svc │  │  systemd svc │                     │
│  └──────┬───────┘  └──────┬───────┘                     │
│         │                  │                              │
│  ┌──────┴──────────────────┴───────┐                     │
│  │  MongoDB (Docker, :27020)       │                     │
│  │  Container: mongodb-dailystockpick                    │
│  └─────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

## Agents

| Agent              | ID               | Role                                  | Model             | Skill         |
| ------------------ | ---------------- | ------------------------------------- | ----------------- | ------------- |
| **Nova**           | `main`           | Orchestrator, Victor's assistant      | Claude Opus 4     | `coding`      |
| **Developer**      | `developer`      | Implements code via Claude Code       | Claude Opus 4     | `vibecoding`  |
| **Code Reviewer**  | `code-reviewer`  | Reviews PRs for quality               | Claude Opus 4     | `code-review` |
| **Tommy**          | `tommy`          | Social media agent (@TommyPickles999) | Claude Opus 4     | Custom        |
| **Content Editor** | `content-editor` | Editorial review for Tommy's posts    | Claude Sonnet 4.5 | Custom        |
| **NS Tester**      | `ns-tester`      | NeighborhoodShare QA testing          | Claude Opus 4     | `ns-testing`  |

### Agent Workflow

```
Victor (Telegram) ↔ Nova (orchestrator)
                        ├── Developer agent (spawned per task)
                        ├── Code Reviewer agent (spawned per PR)
                        ├── Tommy (scheduled social sessions)
                        │     └── Content Editor (review pipeline)
                        └── NS Tester agents (scheduled QA)
```

### Concurrency Rules

- Max 1 Developer agent per project at a time
- Max 1 Reviewer agent per project at a time
- Developer + Reviewer can run concurrently on different branches
- Agents on different projects can always run concurrently

## Projects

### Nova Dashboard

- **Repo:** `victor-brechbill/nova` (GitHub)
- **Stack:** Go backend + React/TypeScript frontend + MongoDB
- **Local path:** `~/clawd/vault/dev/repos/dashboard/`
- **Deploy:** `cd ~/clawd/vault/dev/repos/dashboard && ./deploy.sh`
- **URL:** nova.victorbrechbill.com (Cloudflare Access protected)
- **Database:** MongoDB container `nova-mongo-prod` on port 27017

### NeighborhoodShare

- **Repo:** `victor-brechbill/neighborhood-share` (GitHub)
- **Stack:** Go backend + React frontend + MongoDB + Ory Kratos (auth)
- **Local path:** `~/clawd/vault/dev/repos/neighborhood-share/`
- **Alpha URL:** alpha.neighborhoodshare.org (Cloudflare Access protected)
- **Deploy:** `./scripts/start-alpha.sh --build`
- **Docker Compose:** `docker-compose.alpha.yml`

### DailyStockPick

- **Repo:** `victor-brechbill/dailystockpick` (GitHub, private)
- **Stack:** Node.js API + scheduler + MongoDB
- **Production server:** 18.119.213.209 (separate EC2)
- **SSH:** `ssh -i ~/.ssh/nova-dsp-prod ubuntu@18.119.213.209`
- **Domain:** dailystockpick.ai

## Docker Containers (Nova EC2)

| Container           | Image       | Port      | Purpose                |
| ------------------- | ----------- | --------- | ---------------------- |
| `nova-mongo-prod`   | mongo:7.0   | 27017     | Dashboard + Tommy data |
| `ns-alpha-frontend` | custom      | 5174      | NS Alpha frontend      |
| `ns-alpha-backend`  | custom      | 8081      | NS Alpha backend       |
| `ns-alpha-kratos`   | ory/kratos  | 4445/4446 | NS Alpha auth          |
| `ns-alpha-postgres` | postgres:15 | 5432      | NS Alpha + Kratos DB   |

## Backup System

### Three-Layer Backup Strategy

```
Layer 1: Local backups (on each server)
Layer 2: Cross-server sync (DSP → Nova EC2)
Layer 3: Google Drive (off-site, cloud)
```

### Nova EC2 Backup (Daily, 4:00 AM ET)

- **Cron job:** "Daily Google Drive Backup"
- **Script:** `~/clawd/scripts/backup-to-gdrive.sh`
- **Tool:** `rclone` with Google Drive remote (`gdrive:Nova-Backup/`)
- **What's backed up:**
  - ✅ `~/clawd/` workspace (SOUL.md, MEMORY.md, skills, scripts, PRDs, daily logs)
  - ✅ `~/.openclaw/` config (agent configs, cron jobs, credentials)
  - ✅ DSP MongoDB backups (synced from prod, see below)
  - ✅ Recovery guide (`RECOVERY.md`)
- **What's NOT backed up (by design):**
  - ❌ Git repos (restored from GitHub)
  - ❌ Chrome profiles (regenerated)
  - ❌ Session transcripts (ephemeral)
  - ❌ Media/logs (ephemeral)
- **Retention:** Google Drive keeps latest sync

### DailyStockPick MongoDB Backup

**Step 1 — Prod server mongodump (3:30 AM ET daily)**

- **Server-side cron:** `crontab` on 18.119.213.209
- **Script:** `~/dailystockpick/scripts/backup-mongodb.sh`
- **Output:** `~/dailystockpick-backups/dailystockpick_backup_YYYYMMDD_HHMMSS.tar.gz`
- **Retention:** 7 days on prod server
- **Size:** ~852KB per backup

**Step 2 — Nova EC2 pulls backup (3:45 AM ET daily)**

- **Cron job:** "DSP Backup Sync" (OpenClaw cron)
- **Script:** `~/clawd/scripts/dsp-backup-sync.sh`
- **Process:** SSH into prod → trigger mongodump → SCP the file back
- **Local storage:** `~/dsp-backups/`
- **Retention:** 30 days on Nova EC2

**Step 3 — Google Drive sync (4:00 AM ET daily)**

- Part of the main Google Drive backup job
- Syncs `~/dsp-backups/` → `gdrive:Nova-Backup/dsp-backups/`

### Nova Dashboard MongoDB

- **Currently:** No separate mongodump (data is in `nova-mongo-prod` Docker volume)
- **Protected by:** Google Drive backup of config + workspace (the data that matters is kanban cards, tommy finds, briefs — all in MongoDB)
- **TODO:** Add `mongodump` for `nova_dashboard_prod` database to the backup pipeline

### Restore Procedures

**Nova EC2 (full recovery ~15-20 min):**

1. Launch new Ubuntu EC2
2. Install Node.js 22, OpenClaw, rclone, Docker
3. `rclone copy gdrive:Nova-Backup/clawd ~/clawd`
4. `rclone copy gdrive:Nova-Backup/openclaw-config ~/.openclaw`
5. Clone repos from GitHub
6. Re-enter API keys (not backed up for security)
7. `openclaw gateway start`
8. `cd ~/clawd/vault/dev/repos/dashboard && ./deploy.sh`
9. Full guide: `gdrive:Nova-Backup/RECOVERY.md`

**DailyStockPick MongoDB (restore from backup):**

```bash
# On the DSP server (or new server):
tar -xzf dailystockpick_backup_YYYYMMDD_HHMMSS.tar.gz
mongorestore --uri="mongodb://localhost:27020" --db=dailystockpick ./dailystockpick_backup_YYYYMMDD_HHMMSS/dailystockpick/
```

## Scheduled Jobs (Cron)

All times in Eastern (America/Detroit). Jobs run as OpenClaw cron tasks — either in the main session (lightweight, no isolation overhead) or as isolated sessions (full agent context).

### Core Operations

| Schedule | Job                      | Type     | Description                                                            |
| -------- | ------------------------ | -------- | ---------------------------------------------------------------------- |
| Every 6h | **Nova Heartbeat**       | Main     | Checks kanban board, monitors running agents, picks up new work        |
| Every 6h | **Claude Token Refresh** | Main     | Refreshes Claude Code OAuth token (~8h expiry) for developer agents    |
| 3:00 AM  | **Self-Improvement**     | Isolated | Reviews all projects, explores OpenClaw docs, writes suggestions       |
| 3:45 AM  | **DSP Backup Sync**      | Isolated | Pulls MongoDB backup from DailyStockPick production server via SCP     |
| 5:00 AM  | **Daily Maintenance**    | Isolated | OS updates, storage/memory/security checks, email, Google Drive backup |
| 9:00 AM  | **Morning Brief**        | Isolated | Weather, headlines, project status, improvement suggestions for Victor |

### NeighborhoodShare

| Schedule           | Job                 | Type     | Description                                                      |
| ------------------ | ------------------- | -------- | ---------------------------------------------------------------- |
| 12:30a/8:30a/4:30p | **NS User Testing** | Isolated | Orchestrates 3 test personas (Tom/Wilma/Reggie) for automated QA |

### Tommy (@TommyPickles999)

| Schedule     | Job                | Type     | Description                                                      |
| ------------ | ------------------ | -------- | ---------------------------------------------------------------- |
| 11:00 AM     | **Tommy Explore**  | Isolated | Browse X feed, score posts, like/follow, optional quote-RT       |
| 12:30 PM M-F | **Tommy Market**   | Isolated | Market-focused session — stock posts, DSP pick images, quote-RTs |
| 7:30 PM      | **Tommy Hot Take** | Isolated | Generate original content — hot takes or shower thoughts         |

### Housekeeping

| Schedule    | Job                | Type     | Description                                                       |
| ----------- | ------------------ | -------- | ----------------------------------------------------------------- |
| 9:00 AM Sun | **Weekly Cleanup** | Isolated | Spam cleanup, git hygiene, dependabot PRs, monthly codebase cards |

### Job Types

- **Main (systemEvent):** Injects a message into Nova's active session. Near-zero cost — no new session created. Used for quick tasks like token refresh and heartbeat checks.
- **Isolated (agentTurn):** Spawns a fresh isolated session with full agent context. Used for longer tasks that need their own workspace. Results can be announced back to Telegram.

### Daily Maintenance Includes

The 5:00 AM maintenance job consolidates several tasks:

1. OS updates (`apt upgrade`) and cleanup
2. Storage, memory, and process checks
3. Security audit (login history, failed SSH attempts)
4. Stray gateway process detection
5. Local patches verification
6. Cron job health check (all jobs running on schedule?)
7. Tommy temp image cleanup
8. **Email check** — processes info@neighborhoodshare.org inbox
9. **Google Drive backup** — syncs workspace + DSP backups to Drive

### Weekly Cleanup Includes

The Sunday 9:00 AM cleanup job handles:

1. **Spam cleanup** — review/delete/unsubscribe spam from NS inbox
2. **Codebase cleanup cards** — creates monthly refactoring cards (1st week only)
3. **Git hygiene** — prune merged branches across all repos
4. **Dependabot PRs** — merge minor/patch dependency updates

## Security

- **Cloudflare Access** protects all external-facing services
- **SSH key auth only** (no password auth)
- All API keys stored in OpenClaw config or `.env` files (not in code)
- Credentials never backed up to Google Drive
- Agent sessions are isolated — sub-agents can't access vault secrets
- Daily security audit in System Maintenance job

## Key Paths (Nova EC2)

```
~/clawd/                              # Nova workspace
├── AGENTS.md, SOUL.md, etc.          # Core identity files
├── memory/                           # Daily logs
├── skills/                           # Custom agent skills
├── coding/prds/                      # PRD documents
├── coding/status/                    # Agent status files
├── scripts/                          # Utility scripts
│   ├── backup-to-gdrive.sh           # Google Drive backup
│   ├── dsp-backup-sync.sh            # DSP backup pull
│   └── gmail/                        # Email scripts
└── vault/dev/repos/                  # Code repositories
    ├── dashboard/                    # Nova Dashboard
    ├── neighborhood-share/           # NeighborhoodShare
    └── dailystockpick/               # DSP (dev copy)

~/.openclaw/                          # OpenClaw config
~/dsp-backups/                        # DSP MongoDB backups
```
