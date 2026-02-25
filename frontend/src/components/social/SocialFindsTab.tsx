import { useState, useEffect, useMemo } from "react";
import { apiGet } from "../../utils/api";

interface TommyFind {
  id: string;
  postId: string;
  postUrl: string;
  postText: string;
  authorHandle: string;
  authorName: string;
  authorVerified: boolean;
  hasMedia: boolean;
  mediaType: string;
  matchedInterests: string[];
  matchedTickers: string[];
  relevanceNote: string;
  sessionId: string;
  foundAt: string;
  foundIn: string;
  liked: boolean;
  followed: boolean;
  score: number;
  sessionType: string;
  quotedRt: boolean;
}

interface FindsResponse {
  finds: TommyFind[];
  total: number;
}

interface SessionInfo {
  sessionId: string;
  startedAt: string;
  postsViewed: number;
  likes: number;
  follows: number;
  findsCount: number;
}

interface SessionsResponse {
  sessions: SessionInfo[];
  total: number;
}

function formatTimeAgo(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function scoreClass(score: number): string {
  if (score >= 8) return "high";
  if (score >= 5) return "mid";
  return "low";
}

export default function SocialFindsTab() {
  const [finds, setFinds] = useState<TommyFind[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [sessionTypeFilter, setSessionTypeFilter] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [groupBySession, setGroupBySession] = useState(false);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(
    new Set(),
  );

  const loadData = async () => {
    setLoading(true);
    try {
      let url = `/api/tommy/finds?limit=100&days=${days}`;
      if (sessionTypeFilter) url += `&sessionType=${sessionTypeFilter}`;
      if (minScore > 0) url += `&minScore=${minScore}`;
      const data = await apiGet<FindsResponse>(url);
      setFinds(data.finds || []);

      const sessData = await apiGet<SessionsResponse>(
        "/api/tommy/sessions?limit=50",
      );
      setSessions(sessData.sessions || []);
    } catch (error) {
      console.error("Failed to load finds:", error);
      setFinds([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [days, sessionTypeFilter, minScore]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredFinds = useMemo(() => {
    let result = finds;
    if (minScore > 0) {
      result = result.filter((f) => f.score >= minScore);
    }
    // Filter by days
    const cutoff = Date.now() - days * 86400000;
    result = result.filter((f) => new Date(f.foundAt).getTime() >= cutoff);
    return result;
  }, [finds, minScore, days]);

  const groupedFinds = useMemo(() => {
    if (!groupBySession) return null;
    const groups: Record<string, TommyFind[]> = {};
    for (const find of filteredFinds) {
      const sid = find.sessionId || "unknown";
      if (!groups[sid]) groups[sid] = [];
      groups[sid].push(find);
    }
    return groups;
  }, [filteredFinds, groupBySession]);

  const sessionMap = useMemo(() => {
    const map: Record<string, SessionInfo> = {};
    for (const s of sessions) map[s.sessionId] = s;
    return map;
  }, [sessions]);

  const toggleSession = (sid: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  if (loading) {
    return <div className="social-loading">Loading social finds...</div>;
  }

  const renderFindCard = (find: TommyFind) => (
    <a
      key={find.id}
      href={find.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="social-card"
      style={{ display: "block", textDecoration: "none", color: "inherit" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          marginBottom: "0.75rem",
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            background: "#000",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.25rem",
            color: "#fff",
          }}
        >
          𝕏
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{ color: "#1d9bf0", fontWeight: 600, fontSize: "0.95rem" }}
          >
            @{find.authorHandle}
          </div>
          <div style={{ color: "#666", fontSize: "0.8rem" }}>
            {formatTimeAgo(find.foundAt)}
          </div>
        </div>
        <div className="engagement-badges">
          {find.liked && <span title="Liked">❤️</span>}
          {find.quotedRt && <span title="Quote RT'd">🔁</span>}
          {find.followed && <span title="Followed">👤</span>}
        </div>
        {find.score > 0 && (
          <span className={`score-badge ${scoreClass(find.score)}`}>
            {find.score}
          </span>
        )}
      </div>
      <div
        style={{
          color: "#e0e0e0",
          fontSize: "0.95rem",
          lineHeight: 1.5,
          marginBottom: "0.75rem",
          whiteSpace: "pre-wrap",
        }}
      >
        {find.postText}
      </div>
      {find.relevanceNote && (
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid #222",
            color: "#888",
            fontSize: "0.85rem",
            fontStyle: "italic",
          }}
        >
          <span>💡</span> {find.relevanceNote}
        </div>
      )}
      {(find.matchedTickers?.length > 0 ||
        find.matchedInterests?.length > 0) && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.5rem",
            marginTop: "0.75rem",
          }}
        >
          {find.matchedTickers?.map((t) => (
            <span
              key={t}
              style={{
                fontSize: "0.75rem",
                padding: "0.25rem 0.5rem",
                borderRadius: 4,
                background: "#1a1a1a",
                color: "#22c55e",
                border: "1px solid #22c55e40",
              }}
            >
              ${t}
            </span>
          ))}
          {find.matchedInterests?.map((i) => (
            <span
              key={i}
              style={{
                fontSize: "0.75rem",
                padding: "0.25rem 0.5rem",
                borderRadius: 4,
                background: "#1a1a1a",
                color: "#c9a0dc",
                border: "1px solid #c9a0dc40",
              }}
            >
              {i}
            </span>
          ))}
        </div>
      )}
    </a>
  );

  return (
    <div>
      <div className="social-filters">
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Today</option>
          <option value={3}>Last 3 days</option>
          <option value={7}>Last week</option>
          <option value={30}>Last 30 days</option>
          <option value={365}>All time</option>
        </select>
        <select
          value={sessionTypeFilter}
          onChange={(e) => setSessionTypeFilter(e.target.value)}
        >
          <option value="">All Types</option>
          <option value="explore">Explore</option>
          <option value="market">Market</option>
        </select>
        <label>
          Min Score: {minScore}
          <input
            type="range"
            min={0}
            max={10}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
          />
        </label>
        <button
          className={`toggle-btn ${groupBySession ? "active" : ""}`}
          onClick={() => setGroupBySession(!groupBySession)}
        >
          Group by Session
        </button>
      </div>

      {filteredFinds.length === 0 ? (
        <div className="social-empty">No finds match your filters.</div>
      ) : groupedFinds ? (
        Object.entries(groupedFinds).map(([sid, sFinds]) => {
          const session = sessionMap[sid];
          const expanded = expandedSessions.has(sid);
          return (
            <div key={sid} className="session-group">
              <div
                className="session-group-header"
                onClick={() => toggleSession(sid)}
              >
                <span>
                  {session
                    ? new Date(session.startedAt).toLocaleString()
                    : sid.slice(0, 12)}
                  {" · "}
                  {sFinds.length} finds
                  {session &&
                    ` · ${session.postsViewed} viewed · ${session.likes} liked`}
                </span>
                <span>{expanded ? "▾" : "▸"}</span>
              </div>
              {expanded && sFinds.map(renderFindCard)}
            </div>
          );
        })
      ) : (
        filteredFinds.map(renderFindCard)
      )}
    </div>
  );
}
