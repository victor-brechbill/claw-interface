# Requirements Index

> **Auto-generated** — Run `./scripts/generate-requirements-index.sh` to rebuild.
> Source of truth: individual PRD files. This is a scannable index only.

## How to Use This Index

1. **Before implementing changes**, scan this index for requirements in the affected domain
2. **If your change conflicts with a requirement**, STOP and flag it — do not silently violate or remove requirements
3. **To read full context**, follow the file reference to the source PRD
4. **After modifying requirements**, re-run this script to update the index

## Format

```
LABEL | LEVEL | Description | Source
```

---

## All Requirements

| Label         | Level    | Description                                                                                             | Source                                                       |
| ------------- | -------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `PRD-001-R01` | MUST     | The system MUST support creating, editing, and deleting task cards with markdown…                       | [001-kanban-board.md#L88](001-kanban-board.md#L88)           |
| `PRD-001-R02` | MUST     | The system MUST support card types: bugfix, refactor, feature, task, infrastructure,…                   | [001-kanban-board.md#L89](001-kanban-board.md#L89)           |
| `PRD-001-R03` | MUST     | The system MUST support priority levels: low, medium, high,…                                            | [001-kanban-board.md#L90](001-kanban-board.md#L90)           |
| `PRD-001-R04` | MUST     | The system MUST auto-assign sequential card numbers via auto-incrementing…                              | [001-kanban-board.md#L91](001-kanban-board.md#L91)           |
| `PRD-001-R05` | MUST     | The system MUST support only PUT (full replace) for card updates — no PATCH…                            | [001-kanban-board.md#L92](001-kanban-board.md#L92)           |
| `PRD-001-R06` | MUST     | The system MUST support four columns: Backlog, In Progress, Review,…                                    | [001-kanban-board.md#L95](001-kanban-board.md#L95)           |
| `PRD-001-R07` | MUST     | The system MUST support drag-and-drop between columns with batch reorder…                               | [001-kanban-board.md#L96](001-kanban-board.md#L96)           |
| `PRD-001-R08` | MUST     | The system MUST support filtering by column, type, and…                                                 | [001-kanban-board.md#L97](001-kanban-board.md#L97)           |
| `PRD-001-R09` | MUST     | The system MUST support card approval and flagging with audit…                                          | [001-kanban-board.md#L100](001-kanban-board.md#L100)         |
| `PRD-001-R10` | MUST     | The system MUST auto-clear approval when description changes (via MD5 hash…                             | [001-kanban-board.md#L101](001-kanban-board.md#L101)         |
| `PRD-001-R11` | MUST     | The system MUST support timestamped comment threads on each…                                            | [001-kanban-board.md#L104](001-kanban-board.md#L104)         |
| `PRD-001-R12` | MUST     | The system MUST support file attachments with upload, download, and delete per…                         | [001-kanban-board.md#L105](001-kanban-board.md#L105)         |
| `PRD-001-R13` | MUST NOT | The system MUST NOT expose public ports — all traffic MUST route via Cloudflare Tunnel with Zero Trust… | [001-kanban-board.md#L108](001-kanban-board.md#L108)         |
| `PRD-002-R01` | MUST     | The system MUST provide a session list with status (active/idle/stale), agent, model, and token…        | [002-system-monitoring.md#L68](002-system-monitoring.md#L68) |
| `PRD-002-R02` | MUST     | The system MUST provide aggregated session statistics with per-model…                                   | [002-system-monitoring.md#L69](002-system-monitoring.md#L69) |
| `PRD-002-R03` | MUST     | The system MUST support deleting individual…                                                            | [002-system-monitoring.md#L70](002-system-monitoring.md#L70) |
| `PRD-002-R04` | MUST     | The system MUST provide cron job run history and historical…                                            | [002-system-monitoring.md#L73](002-system-monitoring.md#L73) |
| `PRD-002-R05` | MUST     | The system MUST provide repo activity grids configurable via `VITE_REPOS` env…                          | [002-system-monitoring.md#L74](002-system-monitoring.md#L74) |
| `PRD-002-R06` | MUST     | The system MUST provide domain and SSL certificate status…                                              | [002-system-monitoring.md#L75](002-system-monitoring.md#L75) |
| `PRD-002-R07` | MUST     | The system MUST provide system diagnostics (doctor) with async execution and status/report…             | [002-system-monitoring.md#L76](002-system-monitoring.md#L76) |
| `PRD-002-R08` | MUST     | The system MUST monitor gateway WebSocket connection…                                                   | [002-system-monitoring.md#L77](002-system-monitoring.md#L77) |
| `PRD-002-R09` | MUST     | The system MUST read session data from OpenClaw gateway's local session files on…                       | [002-system-monitoring.md#L80](002-system-monitoring.md#L80) |
| `PRD-002-R10` | MUST NOT | The system MUST NOT provide CSV export or usage cost tracking — sessions API provides token counts…     | [002-system-monitoring.md#L81](002-system-monitoring.md#L81) |

---

_Total requirements: 23_
