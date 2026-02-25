# Changelog

All notable changes to Nova Dashboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.5] - 2026-01-31

### Added

- **Cron Jobs:** Disabled jobs now appear in the list with `[OFF]` status instead of being hidden
  - Backend now uses `--all` flag when fetching cron jobs
  - Frontend displays disabled jobs with gray `[OFF]` indicator

## [1.1.4] - 2026-01-31

### Fixed

- **#58:** OOM detection now uses specific kernel patterns (`oom-killer|killed process`) instead of matching any "oom" mention
- **#56:** Doctor report modal now responsive on mobile (removed 600px minWidth, uses 90% width with 800px max)
- **#57:** Add stock now properly refreshes list by awaiting the async operation before closing modal

## [1.1.3] - 2026-01-31

### Fixed

- **Bug Fixes:** Sub-agent Status Console (Round 2)
  - Fixed runtime timer resetting — now uses first status update timestamp as createdAt instead of updatedAt
  - Restored agent type badge (Developer/Code Review) that was accidentally removed in v1.1.2

## [1.1.2] - 2026-01-31

### Fixed

- **Bug Fixes:** Sub-agent Status Console Improvements
  - Backend now computes `uniqueId` field (e.g., `dev-a88241f0`, `rev-b1234567`) instead of frontend
  - Fixed redundant label display — removed duplicate agent type badge from header
  - Status log fetching now uses correct uniqueId for MongoDB queries
  - Fixed completion detection by using proper uniqueId for status lookups
  - Header now shows clean format: `🤖 dev-XXXXXXXX` without redundant type badge

## [1.1.1] - 2026-01-31

### Fixed

- **NOVA-054:** Agent Session Status Timing Improvements
  - Reduced main agent idle timeout from 10 minutes to 5 minutes
  - Improved sub-agent completion detection with 30-minute activity threshold
  - Added status file checking for completion indicators (✅ completed, task completed, finished, etc.)
  - Sub-agents now correctly show "completed" status instead of "running" forever
  - Better detection of truly completed vs. just inactive sub-agents

## [1.1.0] - 2026-01-31

### Added

- **NOVA-053:** Unique Agent IDs for Status Filtering
  - AgentsConsole now displays unique agent IDs extracted from session keys
  - Status updates now filtered by unique agent ID for each spawned agent
  - Pattern: `dev-{shortId}` for developer agents, `rev-{shortId}` for review agents
  - Enables monitoring multiple concurrent agents with distinct status streams

### Changed

- Updated coding skill to generate unique IDs when spawning developer and review agents
- AgentsConsole component enhanced to show real-time status updates instead of mock logs
- Unique agent IDs displayed in console headers for easy identification

## [1.0.5] - 2026-01-30

### Changed

- **BREAKING:** `agentId` is now required for status updates (no more silent default to "nova")
- API returns error if agentId is missing, guiding users to include it

### Fixed

- Tommy and sub-agent status updates now properly tracked with their own agentId
- Updated all cron job templates to include correct agentId

## [1.0.4] - 2026-01-30

### Fixed

- Renamed all icon files to `-v2` suffix to bust persistent PWA cache
- Fixes issue where old icons were served even after uninstall/reinstall

## [1.0.3] - 2026-01-30

### Fixed

- PWA icon caching: excluded icon files from CacheFirst strategy so precache revision updates work correctly
- Fixes issue where old icons were served from image-cache even after update

## [1.0.2] - 2026-01-30

### Fixed

- Flag now auto-clears when Victor approves a card
- Flag now auto-clears when Victor adds a comment
- Prevents confusion about whether a card is ready for implementation

## [1.0.1] - 2026-01-30

### Fixed

- Sub-agent status display now filters out completed agents older than 30 minutes
- Prevents stale agent entries from cluttering the System page

## [1.0.0] - 2026-01-30

Initial versioning system established. This version represents all work completed up to this point.

### Features

- **Kanban Board** — Full task management with backlog, in_progress, review, done columns
- **Card System** — Comments, attachments, flags, approval workflow
- **Nova Console** — Real-time status updates from Nova
- **System Page** — Activity grid, cron job monitoring, sub-agent status, doctor diagnostics
- **Stocks Page** — Portfolio tracking with sparkline charts and reference lines
- **Briefs Page** — Morning brief archive with full detail view
- **Social Page** — Tommy's social media finds integration
- **PWA Support** — Installable app with offline capability, custom Nova avatar icon

### Technical

- Go backend with MongoDB
- React frontend with Vite
- Cloudflare Tunnel + Zero Trust authentication
- Systemd service management
- Build-time version injection from package.json

---

## Version History Notes

**How to add entries:**

When completing a task, add an entry under `[Unreleased]`:

```markdown
### Added

- New feature description

### Changed

- Modified behavior description

### Fixed

- Bug fix description

### Removed

- Removed feature description
```

When bumping the version, move `[Unreleased]` items to a new version header:

```markdown
## [1.1.0] - 2026-01-31

### Added

- Whatever was in Unreleased
```
