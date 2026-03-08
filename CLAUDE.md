# Agent Dashboard

## Project Structure

- **Backend:** Go 1.22 with `net/http` ServeMux, MongoDB via `go.mongodb.org/mongo-driver/v2`, Zap logging
- **Frontend:** React + TypeScript + Vite, react-router-dom, BIOS-themed UI

## Conventions

- Handlers: `NewXxxHandler(deps...) → RegisterRoutes(mux)` pattern
- MongoDB collections: `db.XxxCollection(client) *mongo.Collection` in `backend/db/mongo.go`
- Shared helpers: `writeJSON()`, `writeError()` in `backend/handlers/cards.go`
- CSS: BIOS theme classes (`bios-section`, `bios-section-header`, etc.) in `App.css`
- Navigation: `navItems` array in `frontend/src/components/Navigation.tsx`

## API Endpoints

- `/api/usage/summary?days=7` — Usage cost summary with daily breakdown
- `/api/usage/sessions?days=7&date=&sort=cost&order=desc` — Session list
- `/api/usage/session/{key}` — Single session detail
- `/api/usage/export-csv?days=7` — CSV export
- `/api/system/cron-runs?jobId=&limit=20` — Cron job run history

## Environment Variables

- `GATEWAY_WS_URL` — WebSocket URL for OpenClaw gateway (default: `ws://localhost:18789`)
- `MONGO_URI` — MongoDB connection string
- `MONGO_DATABASE` — Database name (default: `agent-dashboard`)
- `DASHBOARD_PORT` — Server port (default: `3080`)
- `VITE_REPOS` — Comma-separated list of repos for System page activity grids. Format: `Label:owner/repo,Label2:owner2/repo2` (e.g. `Dashboard:myorg/dashboard,API:myorg/api`)

## ⚠️ Product Requirements (PRDs) — MANDATORY CHECK

**Before implementing any feature or significant change:**

1. **Read the requirements index:** `docs/product-requirements/REQUIREMENTS-INDEX.md`
2. **Identify affected requirements** — scan for requirements related to the files/domain you're changing
3. **Read relevant PRD sections** — if a requirement label appears related, read that PRD section for full context
4. **If your change conflicts with a requirement:**
   - **STOP** — do NOT silently violate, modify, or remove the requirement
   - **Flag the conflict** in your output/commit message: `⚠️ CONFLICTS WITH [PRD-XXX-RNN]: [description]`
   - **Do not proceed** until the conflict is resolved
5. **If your change adds new behavior** that should be a requirement, note it — the PRD should be updated in the same PR

**Requirements use RFC 2119 keywords:** MUST = mandatory, SHOULD = strong recommendation, MAY = optional.

**If updating a requirement:** Update BOTH the PRD file AND re-run `./scripts/generate-requirements-index.sh` to rebuild the index.
