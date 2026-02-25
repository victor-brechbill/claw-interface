import { useState, useEffect, useCallback } from "react";
import "./Sessions.css";

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

/** Show only the last 2 colon-separated segments of the key to keep the table readable. */
function shortKey(key: string): string {
  const parts = key.split(":");
  if (parts.length <= 2) return key;
  return parts.slice(-2).join(":");
}

// ── Component ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL = 10_000; // 10 s

export default function Sessions() {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [totalTokens, setTotalTokens] = useState(0);
  const [activeWithin, setActiveWithin] = useState(60);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/sessions?activeWithin=${activeWithin}&limit=${limit}`,
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
  }, [activeWithin, limit]);

  // Initial fetch + auto-refresh
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="sessions-page">
      {/* Header */}
      <div className="sessions-header">
        <div className="sessions-title">⬡ Sessions</div>
        <div className="sessions-subtitle">
          Gateway session overview — all agents
        </div>
      </div>

      {/* Controls */}
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

        <div className="sessions-control-group">
          <label htmlFor="limit">Limit</label>
          <input
            id="limit"
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value) || 50)}
          />
        </div>

        <div
          className={`sessions-refresh-indicator ${lastRefresh ? "active" : ""}`}
        >
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
                    {/* Key + status dot */}
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

                    {/* Agent */}
                    <td>{s.agent}</td>

                    {/* Kind badge */}
                    <td>
                      <span className={`session-kind-badge ${s.kind}`}>
                        {s.kind}
                      </span>
                    </td>

                    {/* Last active */}
                    <td style={{ whiteSpace: "nowrap" }}>
                      {timeAgo(s.updatedAt)}
                    </td>

                    {/* Tokens */}
                    <td>
                      <span
                        className={tokenClass(s.totalTokens)}
                        title={`in: ${s.inputTokens.toLocaleString()} · out: ${s.outputTokens.toLocaleString()} · total: ${s.totalTokens.toLocaleString()}`}
                      >
                        {formatTokens(s.totalTokens)}
                      </span>
                    </td>

                    {/* Delete */}
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

          {/* Summary row */}
          <div className="sessions-summary">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
            {" · "}
            <span className={tokenClass(totalTokens)}>
              {formatTokens(totalTokens)} total tokens
            </span>
          </div>
        </>
      )}
    </div>
  );
}
