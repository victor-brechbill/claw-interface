# PRD-001: Nova Dashboard with Kanban Board

## Overview

A secure web dashboard enabling two-way communication and task management between Victor (product owner) and Nova (AI engineering manager). The first major feature is a Kanban board where Victor can drop tasks into a backlog and Nova can pick them up, work on them, and track progress.

The dashboard is hosted on Nova's EC2 instance, accessed securely via Cloudflare Tunnel with Zero Trust authentication at `victorbrechbill.com/nova`.

## User Stories

- As Victor, I want to access a secure dashboard from any browser so I can see what Nova is working on
- As Victor, I want to create task cards and drop them into a backlog so Nova can pick them up
- As Victor, I want to see task status at a glance (backlog, in progress, review, done)
- As Nova, I want to move cards between columns as I work on tasks
- As Nova, I want to add comments and status updates to cards so Victor stays informed
- As Victor, I want to assign priority and task type (bugfix, refactor, feature) to cards
- As Victor/Nova, I want to add comments to cards for async communication about specific tasks

## Requirements

### Functional Requirements

1. **Authentication:** Dashboard is only accessible after Cloudflare Zero Trust email verification (Victor's email)
2. **Kanban Board:** Four columns — Backlog, In Progress, Review, Done
3. **Cards:** Each card has:
   - Title (required)
   - Description (markdown supported)
   - Type: Bugfix | Refactor | Feature
   - Priority: Low | Medium | High | Critical
   - Created date, updated date
   - Comments (list of timestamped text entries)
   - Assignee (Victor or Nova)
4. **Drag and Drop:** Cards can be dragged between columns
5. **Card Detail View:** Click a card to see full details, edit, add comments
6. **Persistence:** All data stored in MongoDB
7. **API:** RESTful JSON API for all operations (Nova can interact via API too)

### Non-Functional Requirements

- **Security:** No public ports. All traffic via Cloudflare Tunnel. Backend listens on localhost only.
- **Performance:** Dashboard should load in < 2 seconds on a typical connection
- **Logging:** All API requests logged via Zap (structured JSON logging)
- **Error Handling:** Graceful error handling with meaningful error messages
- **Responsive:** Works on desktop and mobile browsers

## Design Specifications

### API Endpoints

```
GET    /api/health              # Health check
GET    /api/cards               # List all cards (optional ?column= filter)
POST   /api/cards               # Create a card
GET    /api/cards/:id           # Get card details
PUT    /api/cards/:id           # Update a card (title, desc, type, priority, column)
DELETE /api/cards/:id           # Delete a card
POST   /api/cards/:id/comments  # Add a comment to a card
PUT    /api/cards/reorder       # Batch update card positions/columns (for drag-drop)
```

### Data Model

```
Card {
  _id:          ObjectID
  title:        string (required)
  description:  string (markdown)
  type:         enum ["bugfix", "refactor", "feature"]
  priority:     enum ["low", "medium", "high", "critical"]
  column:       enum ["backlog", "in_progress", "review", "done"]
  position:     int (ordering within column)
  assignee:     string ("victor" | "nova")
  comments:     [{
    author:     string
    text:       string
    created_at: datetime
  }]
  created_at:   datetime
  updated_at:   datetime
}
```

### Frontend Pages

1. **Board View** (`/`) — The main Kanban board with four columns
2. **Card Detail Modal** — Opens when clicking a card, shows full details + comment thread

### UI Approach

- Clean, minimal design
- Dark mode default (Nova's aesthetic ✨)
- Color-coded priority badges
- Type icons (bug 🐛, refactor 🔧, feature ⭐)
- Responsive columns that stack on mobile

## Prerequisites & Dependencies

- Go 1.25+ ✅ (installed)
- MongoDB 8.0 ✅ (installed, running)
- Node.js 22+ ✅ (installed)
- Docker ✅ (installed, for MongoDB container)
- cloudflared ✅ (installed, needs tunnel configuration)
- Cloudflare account with Zero Trust ⚠️ (Victor needs to set this up)
- Domain DNS: victorbrechbill.com ⚠️ (needs `nova` subdomain or path routing)

## Cloudflare Setup Required (Victor)

Before the dashboard can be accessed externally, Victor needs to:

1. **Create a Cloudflare Tunnel:**
   - Log into Cloudflare Zero Trust dashboard
   - Create a tunnel named "nova-dashboard"
   - Install the tunnel connector on EC2 (cloudflared is installed)
   - Configure the tunnel to route `victorbrechbill.com/nova` → `localhost:3080`

2. **Configure Zero Trust Access Policy:**
   - Create an Access Application for `victorbrechbill.com/nova`
   - Set policy: Allow only Victor's email address
   - Choose authentication method (email OTP is simplest)

3. **Share the tunnel token with Nova:**
   - Nova will run `cloudflared tunnel run` with the token as a systemd service

Alternative: Victor can run `cloudflared tunnel login` on the EC2 instance to authenticate directly.

## Out of Scope (for this PRD)

- Real-time WebSocket updates (future enhancement)
- File attachments on cards (Phase 2)
- Multiple boards/projects (start with one board)
- User avatars or profiles
- Email/Telegram notifications from the dashboard
- Integration with GitHub issues (future, when GitHub is set up)

## Acceptance Criteria

- [ ] Go backend serves API on localhost:3080
- [ ] React frontend builds and is served by Go as static assets
- [ ] MongoDB stores and retrieves cards correctly
- [ ] Kanban board displays four columns with cards
- [ ] Cards can be created, edited, deleted via the UI
- [ ] Cards can be dragged between columns
- [ ] Comments can be added to cards
- [ ] Zap logger logs all API requests in structured JSON
- [ ] No ports are exposed publicly (Cloudflare Tunnel only)
- [ ] Dashboard loads successfully at victorbrechbill.com/nova after Cloudflare setup
- [ ] Zero Trust auth prevents unauthorized access

## Technical Approach

Go backend using `net/http` (or chi/gorilla mux) with MongoDB driver. React frontend with a drag-and-drop library (react-beautiful-dnd or dnd-kit). Frontend is built to static files and embedded/served by the Go binary. Single binary deployment.

## User Stories Breakdown (Implementation Order)

### Story 1: Project Scaffold + Hello World
Set up Go module, basic HTTP server with Zap logging, React app with build pipeline, Go serves React static files. Health check endpoint. Verify it runs on localhost:3080.

### Story 2: MongoDB Integration + Card API
Connect to MongoDB, implement Card data model, build CRUD API endpoints for cards. Write basic API tests.

### Story 3: Kanban Board UI
Build the React Kanban board with four columns. Fetch cards from API, display them. Card creation form. Card detail modal with edit + comments.

### Story 4: Drag and Drop
Implement drag-and-drop between columns. Persist column/position changes via API.

### Story 5: Polish + Production Readiness
Error handling, loading states, responsive design, dark mode styling, structured logging review. Build optimization.

### Story 6: Cloudflare Tunnel Integration
Configure cloudflared service, systemd unit file, tunnel routing. Verify end-to-end access via victorbrechbill.com/nova.

### Story 7: Claude Token Refresh via Dashboard
Add a self-service UI for refreshing the Anthropic Claude API token without SSH access.

**Background:** The Claude Code OAuth token expires periodically (~24h). Currently requires running `claude setup-token` via SSH. This story enables token refresh from any device via the dashboard (phone, laptop, etc. through Cloudflare Tunnel).

**Flow:**
1. Dashboard shows token status (valid/expiring/expired) with time remaining
2. "Refresh Token" button triggers backend to spawn `claude setup-token` in a PTY
3. Backend captures the OAuth URL from the CLI output
4. Dashboard displays the OAuth URL as a clickable link (opens claude.ai in new tab)
5. User authenticates on claude.ai, receives an auth code
6. User pastes the auth code into a dashboard input field
7. Backend writes the code to the PTY's stdin, completing the flow
8. Dashboard confirms success/failure

**Technical Details:**
- Backend endpoint: `POST /api/system/token-refresh/start` → returns `{ oauthUrl, sessionId }`
- Backend endpoint: `POST /api/system/token-refresh/submit` → accepts `{ code, sessionId }` → returns `{ success, message }`
- Backend spawns `claude setup-token` via `os/exec` with PTY (use `creack/pty` Go library)
- Parse CLI output to extract the OAuth URL (regex: `https://claude.ai/oauth/authorize\?.*`)
- Write submitted code to PTY stdin when user provides it
- Monitor PTY for success/failure output
- Token status check: `GET /api/system/token-status` → reads token expiry from Claude config
- Frontend: new "System" section in dashboard nav with token management card

**Acceptance Criteria:**
- [ ] Token status displayed on dashboard (healthy/warning/expired)
- [ ] One-click OAuth flow works from mobile browser
- [ ] Auth code submission completes token refresh
- [ ] Error handling for timeout, invalid code, CLI failure
- [ ] No SSH access required for routine token maintenance

---

*Status: DRAFT — Awaiting Victor's approval before implementation begins.*
