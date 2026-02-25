# Nova Dashboard

**Version: 1.1.1**

A secure web dashboard for two-way communication between Victor and Nova. Hosted on Nova's EC2 instance, accessed securely via Cloudflare Tunnel with Zero Trust authentication.

**URL:** `victorbrechbill.com/nova`

## Purpose

- **Kanban Board** — Victor drops tasks in the backlog, Nova picks them up and works on them
- **Two-way communication** — Chat, status updates, task tracking
- **File sharing** — Secure file exchange between Victor and Nova
- **Project visibility** — Victor can see what Nova is working on from any browser

## Tech Stack

| Component    | Technology                          |
| ------------ | ----------------------------------- |
| **Backend**  | Go                                  |
| **Frontend** | React                               |
| **Database** | MongoDB (NoSQL)                     |
| **Logging**  | Zap (`go.uber.org/zap`)             |
| **Tunnel**   | Cloudflare Tunnel (`cloudflared`)   |
| **Auth**     | Cloudflare Zero Trust (email-based) |

## Architecture

```
Victor's Browser
    ↓ HTTPS (victorbrechbill.com/nova)
Cloudflare Zero Trust (email auth: victor's email)
    ↓ Cloudflare Tunnel
cloudflared (on EC2, no public ports)
    ↓ localhost
Go Backend (API + static file serving)
    ↓
MongoDB (local or Atlas)
    ↓
React Frontend (built static assets served by Go)
```

## Security Model

- **NO public ports exposed** on the EC2 instance
- All traffic routed through Cloudflare Tunnel
- Zero Trust authentication requires Victor's email login
- No direct SSH or HTTP access from the internet needed for the dashboard
- Backend only listens on localhost

## Project Structure (Planned)

```
dashboard/
├── README.md
├── docs/
│   └── prds/              # Product Requirements Documents
├── backend/
│   ├── main.go
│   ├── go.mod
│   ├── go.sum
│   ├── handlers/          # HTTP handlers
│   ├── models/            # MongoDB models
│   ├── middleware/         # Auth, logging, CORS
│   ├── config/            # App configuration
│   └── logger/            # Zap logger setup
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── pages/         # Page views
│   │   ├── hooks/         # Custom hooks
│   │   ├── api/           # API client
│   │   └── App.tsx
│   └── public/
├── scripts/               # Dev scripts, deployment
└── .cloudflared/           # Tunnel config (gitignored)
```

## Features (Planned)

### Phase 1: Kanban Board

- Backlog, Approved, In Progress, Review, Done columns
- Approval workflow: Victor approves backlog items before Nova works on them
- Drag and drop cards between columns
- Card details: title, description, type (bugfix/refactor/feature), priority
- Assignment (Victor → Nova or Nova self-assigns)
- Comments on cards
- Activity log

### Phase 2: Communication

- Real-time chat/messaging
- Notification system
- File upload/download
- Markdown support

### Phase 3: Project Dashboard

- System health monitoring (EC2 stats)
- Active project overview
- Git activity feed
- Tommy (X agent) status/digest viewer

## Prerequisites

- Go 1.21+
- Node.js 22+ (already installed)
- MongoDB
- cloudflared (Cloudflare Tunnel client)
- Cloudflare account with Zero Trust configured
- Domain: victorbrechbill.com (DNS managed by Cloudflare)

## Development

Use the convenient dev script for local development:

```bash
# All-in-one development setup
./dev.sh              # Run backend, optionally frontend
./dev.sh full          # Same as above
./dev.sh backend       # Backend only (port 3081)
./dev.sh frontend      # Frontend only (port 5173)
```

### Manual Development

```bash
# Backend (manual)
cd backend
export NOVA_ENV=development
export DASHBOARD_PORT=3081
export MONGO_URI=mongodb://localhost:27017
export MONGO_DATABASE=nova_dashboard_dev
go run main.go

# Frontend (manual)
cd frontend
npm install
npm run dev
```

## Production Deployment

### Quick Deploy

```bash
# One-command deployment
./deploy.sh
```

### Manual Deployment Steps

1. **Initial setup** (one-time):

   ```bash
   # Create production directory
   mkdir -p ~/nova-dashboard/{config,logs}

   # Install systemd services
   systemctl --user daemon-reload
   systemctl --user enable nova-mongo.service
   systemctl --user enable nova-dashboard.service
   ```

2. **Deploy new version**:
   ```bash
   # Build and deploy
   ./deploy.sh
   ```

### Production Architecture

```
Production Directory: ~/nova-dashboard/
├── nova-dashboard          # Compiled Go binary
├── frontend/               # Built React assets
├── config/
│   └── prod.env           # Production environment
└── logs/                  # Application logs

Docker:
├── nova-mongo-prod        # MongoDB container (port 27018)
└── nova-mongo-prod-data   # Persistent data volume

Systemd Services:
├── nova-mongo.service     # MongoDB container management
├── nova-dashboard.service # Go backend service
└── cloudflared.service    # Cloudflare tunnel (existing)
```

## Environment Variables

### Development

```bash
NOVA_ENV=development
DASHBOARD_PORT=3081
MONGO_URI=mongodb://localhost:27017
MONGO_DATABASE=nova_dashboard_dev
FRONTEND_DIR=./frontend/dist
LOG_DIR=./logs
```

### Production

```bash
NOVA_ENV=production
DASHBOARD_PORT=3080
MONGO_URI=mongodb://localhost:27018
MONGO_DATABASE=nova_dashboard_prod
FRONTEND_DIR=/home/ubuntu/nova-dashboard/frontend
LOG_DIR=/home/ubuntu/nova-dashboard/logs
```

## Service Management

```bash
# Check service status
systemctl --user status nova-dashboard.service
systemctl --user status nova-mongo.service

# View logs
journalctl --user -u nova-dashboard.service -f
journalctl --user -u nova-mongo.service -f

# Restart services
systemctl --user restart nova-dashboard.service
systemctl --user restart nova-mongo.service

# Stop/start all Nova services
systemctl --user stop nova-dashboard.service nova-mongo.service
systemctl --user start nova-mongo.service nova-dashboard.service
```

## Health Check

```bash
# Check if services are running
curl http://localhost:3080/api/health

# Check via Cloudflare tunnel
curl https://nova.victorbrechbill.com/api/health
```

## Versioning

We use [Semantic Versioning](https://semver.org/) (SemVer).

### Version Format: MAJOR.MINOR.PATCH

| Change Type | Bump  | When to Use                                |
| ----------- | ----- | ------------------------------------------ |
| **PATCH**   | x.x.X | Bug fixes, small tweaks, CSS changes       |
| **MINOR**   | x.X.0 | New features, new pages, new API endpoints |
| **MAJOR**   | X.0.0 | Breaking changes, major rewrites           |

### How to Bump Version

After completing a task, bump the version:

```bash
cd frontend

# For bug fixes / small changes
npm version patch

# For new features
npm version minor

# For breaking changes (rare)
npm version major
```

This automatically:

1. Updates `package.json`
2. Creates a git commit
3. Creates a git tag (e.g., `v1.1.0`)

Then complete the release:

```bash
# 1. Update "Version: x.x.x" at top of README.md
# 2. Deploy and push
cd .. && ./deploy.sh
git push && git push --tags
```

### Where Version is Displayed

- **System page** in the dashboard (injected at build time from `package.json`)
- **Git tags** for release history

### Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a history of changes by version.

---

_This project follows the Vibecoding workflow. See `/home/ubuntu/clawd/skills/vibecoding/SKILL.md` for development process._
