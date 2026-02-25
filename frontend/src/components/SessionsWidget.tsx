import { useState, useEffect, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

interface SessionEntry {
  key: string;
  agent: string;
  kind: string;
  label?: string;
  model?: string;
  status: "active" | "idle" | "stale";
  updatedAt: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  spawnedBy?: string;
}

interface SessionsApiResponse {
  sessions: SessionEntry[];
  count: number;
  totalTokens: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function tokenClass(n: number): string {
  if (n >= 800_000) return "token-danger";
  if (n >= 500_000) return "token-warning";
  return "token-normal";
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortKey(key: string): string {
  const parts = key.split(":");
  if (parts.length <= 2) return key;
  return parts.slice(-2).join(":");
}

// ── Component ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 10_000; // 10 s
const LIMIT = 50; // Hardcoded limit

export default function SessionsWidget() {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [activeWithin, setActiveWithin] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sessions?activeWithin=${activeWithin}&limit=${LIMIT}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SessionsApiResponse = await res.json();
      setSessions(data.sessions ?? []);
      setTotalTokens(data.totalTokens ?? 0);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load sessions");
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, [activeWithin]);

  useEffect(() => {
    setLoading(true);
    fetchSessions();
    const id = setInterval(fetchSessions, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [fetchSessions]);

  async function handleDelete(key: string) {
    const confirm = window.confirm(
      `Delete session?\n\n${key}\n\nThis cannot be undone.`,
    );
    if (!confirm) return;

    setDeleting(key);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(key)}`, {
        method: "DELETE",
      });
      if (res.status === 204 || res.ok) {
        setSessions((prev) => prev.filter((s) => s.key !== key));
      } else {
        const body = await res.json().catch(() => ({}));
        alert(`Failed to delete: ${body.error ?? res.status}`);
      }
    } catch (e: unknown) {
      alert(`Error: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="sessions-widget">
      {/* Controls bar */}
      <div className="sessions-controls">
        <div className="sessions-control-group">
          <label htmlFor="activeWithin">Active within</label>
          <input
            id="activeWithin"
            type="number"
            min={1}
            value={activeWithin}
            onChange={(e) => setActiveWithin(Number(e.target.value) || 60)}
          />
          <label>min</label>
        </div>

        <div className="sessions-refresh-indicator">
          {lastRefresh
            ? `↻ refreshes every 10s · last: ${lastRefresh.toLocaleTimeString()}`
            : "Loading…"}
        </div>
      </div>

      {/* Table */}
      {loading && !sessions.length ? (
        <div className="sessions-state">Loading sessions…</div>
      ) : error ? (
        <div className="sessions-state error">⚠ {error}</div>
      ) : sessions.length === 0 ? (
        <div className="sessions-state">
          No sessions found in the last {activeWithin} minutes.
        </div>
      ) : (
        <>
          <div className="sessions-table-wrapper">
            <table className="sessions-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Agent</th>
                  <th>Kind</th>
                  <th>Last Active</th>
                  <th>Tokens</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.key}>
                    <td>
                      <div className="session-key-cell">
                        <span
                          className={`session-status-dot ${s.status}`}
                          title={s.status}
                        />
                        <span className="session-key-text" title={s.key}>
                          {s.label ? (
                            <>
                              <strong style={{ color: "#c0c0c0" }}>
                                {s.label}
                              </strong>
                              <br />
                              <span style={{ fontSize: "11px", color: "#666" }}>
                                {shortKey(s.key)}
                              </span>
                            </>
                          ) : (
                            shortKey(s.key)
                          )}
                        </span>
                      </div>
                    </td>
                    <td>{s.agent}</td>
                    <td>
                      <span className={`session-kind-badge ${s.kind}`}>
                        {s.kind}
                      </span>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {timeAgo(s.updatedAt)}
                    </td>
                    <td>
                      <span
                        className={tokenClass(s.totalTokens)}
                        title={`in: ${s.inputTokens.toLocaleString()} · out: ${s.outputTokens.toLocaleString()} · total: ${s.totalTokens.toLocaleString()}`}
                      >
                        {formatTokens(s.totalTokens)}
                      </span>
                    </td>
                    <td>
                      <button
                        className="session-delete-btn"
                        onClick={() => handleDelete(s.key)}
                        disabled={deleting === s.key}
                        title="Delete session"
                      >
                        {deleting === s.key ? "…" : "🗑"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="sessions-summary">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            {" · "}
            <span className={tokenClass(totalTokens)}>
              {formatTokens(totalTokens)} total tokens
            </span>
          </div>
        </>
      )}

      <style>{`
        .sessions-widget {
          width: 100%;
          background: #0d0d0d;
          border: 1px solid #333;
          border-radius: 8px;
          overflow: hidden;
          font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace;
          margin-top: 1.5rem;
        }

        .sessions-controls {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.5rem 0.75rem;
          background: #111;
          border-bottom: 1px solid #222;
          flex-wrap: wrap;
        }

        .sessions-control-group {
          display: flex;
          align-items: center;
          gap: 0.35rem;
        }

        .sessions-control-group label {
          font-size: 0.7rem;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .sessions-control-group input {
          width: 60px;
          padding: 0.2rem 0.4rem;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 3px;
          color: #aaa;
          font-family: inherit;
          font-size: 0.75rem;
          outline: none;
        }

        .sessions-control-group input:focus {
          border-color: #555;
        }

        .sessions-refresh-indicator {
          margin-left: auto;
          font-size: 0.65rem;
          color: #666;
        }

        .sessions-state {
          padding: 1.5rem;
          text-align: center;
          color: #666;
          font-size: 0.85rem;
        }

        .sessions-state.error {
          color: #ef4444;
        }

        .sessions-table-wrapper {
          overflow-x: auto;
        }

        .sessions-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.75rem;
        }

        .sessions-table thead {
          background: #1a1a1a;
          border-bottom: 1px solid #333;
        }

        .sessions-table th {
          padding: 0.5rem 0.75rem;
          text-align: left;
          font-size: 0.7rem;
          color: #888;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .sessions-table td {
          padding: 0.5rem 0.75rem;
          border-bottom: 1px solid #1a1a1a;
          color: #aaa;
        }

        .sessions-table tbody tr:hover {
          background: #1a1a1a;
        }

        .session-key-cell {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .session-status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .session-status-dot.active {
          background: #22c55e;
        }

        .session-status-dot.idle {
          background: #fbbf24;
        }

        .session-status-dot.stale {
          background: #666;
        }

        .session-key-text {
          font-family: 'SF Mono', monospace;
          font-size: 0.7rem;
          color: #aaa;
        }

        .session-kind-badge {
          display: inline-block;
          padding: 0.15rem 0.4rem;
          border-radius: 3px;
          font-size: 0.65rem;
          text-transform: uppercase;
          font-weight: 600;
        }

        .session-kind-badge.main {
          background: #c9a0dc40;
          color: #c9a0dc;
        }

        .session-kind-badge.isolated {
          background: #3b82f640;
          color: #60a5fa;
        }

        .token-normal {
          color: #aaa;
        }

        .token-warning {
          color: #fbbf24;
        }

        .token-danger {
          color: #ef4444;
        }

        .session-delete-btn {
          padding: 0.2rem 0.4rem;
          background: transparent;
          border: 1px solid #333;
          border-radius: 3px;
          color: #666;
          cursor: pointer;
          font-size: 0.75rem;
          transition: all 0.2s;
        }

        .session-delete-btn:hover {
          background: #1a1a1a;
          border-color: #ef444440;
          color: #ef4444;
        }

        .session-delete-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .sessions-summary {
          padding: 0.5rem 0.75rem;
          background: #111;
          border-top: 1px solid #222;
          font-size: 0.7rem;
          color: #888;
        }

        @media (max-width: 768px) {
          .sessions-table {
            font-size: 0.7rem;
          }

          .sessions-table th,
          .sessions-table td {
            padding: 0.4rem 0.5rem;
          }

          .sessions-control-group input {
            width: 50px;
          }
        }
      `}</style>
    </div>
  );
}
