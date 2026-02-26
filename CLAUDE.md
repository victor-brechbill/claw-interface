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
