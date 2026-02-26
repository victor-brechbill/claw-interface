import { useEffect, useState, useRef } from "react";
import { apiGet, apiPost } from "../utils/api";
import { formatTimeAgo } from "../utils/format";
import { useNotification } from "./Notification";

interface LogEntry {
  time: string;
  level: string;
  subsystem: string;
  message: string;
  raw: string;
}

interface LogsResponse {
  entries: LogEntry[];
  cursor: string;
  count: number;
}

interface AgentConsoleProps {
  status: "online" | "idle" | "sleeping" | "offline";
  lastActive: string | null;
  completionMessage: string | null;
}

const AgentConsole: React.FC<AgentConsoleProps> = ({
  status,
  lastActive,
  completionMessage,
}) => {
  const [waking, setWaking] = useState(false);
  const { notify } = useNotification();

  // Log viewer state
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logCursorRef = useRef<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [autoFollow, setAutoFollow] = useState(true);
  const logOutputRef = useRef<HTMLDivElement>(null);

  // Log polling effect
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const params = logCursorRef.current
          ? `lines=50&cursor=${encodeURIComponent(logCursorRef.current)}`
          : "lines=200";
        const data = await apiGet<LogsResponse>(`/api/system/logs?${params}`);
        if (data.entries && data.entries.length > 0) {
          setLogEntries((prev) => {
            const combined = [...prev, ...data.entries];
            return combined.slice(-500); // 500-line buffer
          });
          logCursorRef.current = data.cursor;
        }
      } catch (err) {
        console.error("Failed to fetch logs:", err);
      }
    };

    fetchLogs(); // Initial fetch
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll for log
  useEffect(() => {
    if (autoFollow && logOutputRef.current) {
      logOutputRef.current.scrollTop = logOutputRef.current.scrollHeight;
    }
  }, [logEntries, autoFollow]);

  const getStatusText = () => {
    if (completionMessage) return completionMessage;
    switch (status) {
      case "online":
        return "Working";
      case "idle":
        return "Active";
      case "sleeping":
        return "Idle";
      case "offline":
        return "Offline";
      default:
        return "Active";
    }
  };

  const getStatusColor = () => {
    if (completionMessage) return "#22c55e";
    switch (status) {
      case "online":
        return "#c9a0dc";
      case "idle":
        return "#22c55e";
      case "sleeping":
        return "#fbbf24";
      case "offline":
        return "#ef4444";
      default:
        return "#22c55e";
    }
  };

  const handleWakeAgent = async () => {
    if (waking) return;

    setWaking(true);
    try {
      await apiPost("/api/agent/wake", {});
      notify("success", "Agent woken up!");
    } catch (error) {
      console.error("Failed to wake agent:", error);
      notify("error", "Failed to wake agent. Please try again.");
    } finally {
      setWaking(false);
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case "info":
        return "#22c55e";
      case "warn":
        return "#fbbf24";
      case "error":
      case "fatal":
      case "alert":
      case "emerg":
        return "#ef4444";
      case "notice":
        return "#22c55e";
      case "debug":
        return "#808080";
      default:
        return "#aaa";
    }
  };

  const filteredEntries = logEntries.filter((entry) => {
    if (
      searchQuery &&
      !entry.message.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !entry.subsystem.toLowerCase().includes(searchQuery.toLowerCase())
    )
      return false;
    return true;
  });

  const handleExport = () => {
    const text = filteredEntries
      .map(
        (e) =>
          `${e.time} ${e.level.toUpperCase().padEnd(5)} ${e.subsystem.padEnd(12)} ${e.message}`,
      )
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gateway-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  return (
    <div className="agent-console">
      {/* Header Bar */}
      <div className="console-header">
        <div className="console-title">
          <span className="title-icon">&gt;</span>
          <span className="title-text">agent.log</span>
        </div>
        <div className="console-status">
          {lastActive && (
            <span className="last-active">
              Last active: {formatTimeAgo(lastActive)}
            </span>
          )}
          <span
            className="status-dot"
            style={{ background: getStatusColor() }}
          ></span>
          <span className="status-text">{getStatusText()}</span>
          {/* Wake/heartbeat button - always visible */}
          <button
            className={`wake-button-mini ${waking ? "waking" : ""}`}
            onClick={handleWakeAgent}
            disabled={waking}
            title="Wake Agent"
          >
            <div className="defibrillator-icon">
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {/* Heart shape */}
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                {/* Lightning bolt through heart */}
                <path d="m13 2-2 8h4l-3 8" strokeWidth="1.5" />
              </svg>
              {/* Plus sign in corner */}
              <div className="plus-sign">+</div>
            </div>
          </button>
        </div>
      </div>

      {/* Log controls toolbar */}
      <div className="log-controls">
        <input
          className="log-search"
          type="text"
          placeholder="search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className={`follow-btn ${autoFollow ? "active" : ""}`}
          onClick={() => setAutoFollow((p) => !p)}
          title="Auto-follow"
        >
          ▼
        </button>
        <button
          className="export-btn"
          onClick={handleExport}
          title="Export logs"
        >
          ↓
        </button>
      </div>

      {/* Live log output */}
      <div className="console-output log-output" ref={logOutputRef}>
        {filteredEntries.length === 0 ? (
          <div className="output-line">
            <span className="log-text idle">Waiting for logs...</span>
          </div>
        ) : (
          filteredEntries.map((entry, i) => {
            const showLevel =
              entry.level !== "info" && entry.level !== "notice" && entry.level !== "debug";
            return (
              <div
                key={`${entry.time}-${entry.subsystem}-${i}`}
                className="output-line log-entry"
              >
                <span className="log-meta">
                  <span className="log-time">{entry.time}</span>
                  {showLevel && (
                    <span
                      className="log-level"
                      style={{ color: getLevelColor(entry.level) }}
                    >
                      {entry.level.toUpperCase()}
                    </span>
                  )}
                  <span className="log-subsystem">{entry.subsystem}</span>
                </span>
                <span className="log-message">
                  {entry.message && entry.message.length > 200
                    ? entry.message.slice(0, 200) + "…"
                    : entry.message}
                </span>
              </div>
            );
          })
        )}
      </div>

      <style>{`
        .agent-console {
          width: 100%;
          background: #0d0d0d;
          border: 1px solid #333;
          border-radius: 8px;
          overflow: hidden;
          font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace;
          margin-top: 1.5rem;
        }

        /* Header Bar */
        .console-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem 0.75rem;
          background: #1a1a1a;
          border-bottom: 1px solid #333;
        }

        .console-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .title-icon {
          font-size: 0.8rem;
        }

        .title-text {
          font-size: 0.75rem;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        /* Mini Wake Button (icon-only, in header, far right) */
        .wake-button-mini {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          padding: 0;
          margin-left: 0.25rem;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 4px;
          color: #888;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .wake-button-mini:hover {
          background: #2a2a2a;
          border-color: #c9a0dc40;
          color: #c9a0dc;
        }

        .wake-button-mini:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .wake-button-mini.waking {
          background: #c9a0dc20;
          border-color: #c9a0dc40;
          color: #c9a0dc;
        }

        .wake-button-mini .defibrillator-icon {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .wake-button-mini .plus-sign {
          position: absolute;
          top: -4px;
          right: -4px;
          width: 10px;
          height: 10px;
          background: #c9a0dc;
          color: #0d0d0d;
          border-radius: 50%;
          font-size: 8px;
          font-weight: bold;
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 1;
        }

        .wake-button-mini.waking .defibrillator-icon svg {
          animation: defibrillator-pulse 1s ease-in-out infinite;
        }

        .console-status {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .last-active {
          font-size: 0.7rem;
          color: #666;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
        }

        .status-text {
          font-size: 0.7rem;
          color: #888;
        }

        /* Log controls toolbar */
        .log-controls {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          padding: 0.35rem 0.75rem;
          border-bottom: 1px solid #222;
          background: #111;
        }

        .log-search {
          padding: 0.15rem 0.4rem;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 3px;
          color: #aaa;
          font-family: inherit;
          font-size: 0.7rem;
          width: 100px;
          outline: none;
        }

        .log-search:focus {
          border-color: #555;
        }

        .follow-btn, .export-btn {
          padding: 0.15rem 0.4rem;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 3px;
          color: #666;
          font-family: inherit;
          font-size: 0.75rem;
          cursor: pointer;
        }

        .follow-btn.active {
          color: #22c55e;
        }

        /* Log entries */
        .log-entry {
          gap: 0.5rem;
          font-size: 0.75rem;
        }

        .log-meta {
          flex-shrink: 0;
          width: 6rem;
          display: flex;
          flex-direction: column;
          gap: 0;
          font-size: 0.65rem;
          line-height: 1.3;
        }

        .log-time {
          color: #555;
        }

        .log-level {
          font-weight: bold;
          font-size: 0.65rem;
        }

        .log-subsystem {
          color: #666;
          font-size: 0.6rem;
        }

        .log-message {
          flex: 1;
          word-break: break-word;
          color: #e0e0e0;
        }

        @media (min-width: 768px) {
          .log-meta {
            flex-direction: row;
            gap: 0.5rem;
            width: 16rem;
            align-items: baseline;
          }

          .log-time {
            min-width: 4.5rem;
            font-size: 0.7rem;
          }

          .log-level {
            min-width: 2.5rem;
            font-size: 0.7rem;
          }

          .log-subsystem {
            min-width: 5rem;
            font-size: 0.7rem;
          }
        }

        /* Console Output */
        .console-output {
          padding: 0.75rem;
          min-height: 120px;
          max-height: 300px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          font-size: 0.8rem;
          line-height: 1.5;
        }

        .output-line {
          display: flex;
          gap: 0.75rem;
          color: #aaa;
        }

        .output-line .timestamp {
          color: #555;
          flex-shrink: 0;
          font-size: 0.75rem;
        }

        .output-line .log-text {
          flex: 1;
          word-break: break-word;
        }

        .output-line .log-text.connecting,
        .output-line .log-text.idle {
          color: #555;
          font-style: italic;
        }

        .output-line.error .log-text {
          color: #ef4444;
        }

        .cursor-line {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          height: 1.4em;
          margin-top: 0.25rem;
        }

        /* Pulsing Pixel Star */
        .pixel-star {
          position: relative;
          width: 14px;
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .star-center {
          position: absolute;
          width: 3px;
          height: 3px;
          background: #666;
          border-radius: 50%;
          animation: star-pulse-center 1.5s ease-in-out infinite;
        }

        .star-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          animation: star-pulse-ring 1.5s ease-in-out infinite;
        }

        .star-dot {
          position: absolute;
          width: 2px;
          height: 2px;
          background: #666;
          border-radius: 50%;
          top: 50%;
          left: 50%;
        }

        /* Position 8 dots in a ring */
        .star-dot:nth-child(1) { transform: translate(-50%, -50%) translate(0, -6px); }      /* top */
        .star-dot:nth-child(2) { transform: translate(-50%, -50%) translate(4px, -4px); }   /* top-right */
        .star-dot:nth-child(3) { transform: translate(-50%, -50%) translate(6px, 0); }      /* right */
        .star-dot:nth-child(4) { transform: translate(-50%, -50%) translate(4px, 4px); }    /* bottom-right */
        .star-dot:nth-child(5) { transform: translate(-50%, -50%) translate(0, 6px); }      /* bottom */
        .star-dot:nth-child(6) { transform: translate(-50%, -50%) translate(-4px, 4px); }   /* bottom-left */
        .star-dot:nth-child(7) { transform: translate(-50%, -50%) translate(-6px, 0); }     /* left */
        .star-dot:nth-child(8) { transform: translate(-50%, -50%) translate(-4px, -4px); }  /* top-left */

        @keyframes star-pulse-center {
          0%, 100% { 
            opacity: 1;
            transform: scale(1);
          }
          50% { 
            opacity: 0.3;
            transform: scale(0.5);
          }
        }

        @keyframes star-pulse-ring {
          0%, 100% { 
            opacity: 0;
            transform: scale(0);
          }
          50% { 
            opacity: 1;
            transform: scale(1);
          }
        }

        /* Active state - purple glow when working */
        .pixel-star.active .star-center {
          background: #c9a0dc;
          box-shadow: 0 0 6px rgba(201, 160, 220, 0.8);
        }

        .pixel-star.active .star-dot {
          background: #c9a0dc;
        }

        @keyframes star-pulse-center-active {
          0%, 100% { 
            opacity: 1;
            transform: scale(1);
            box-shadow: 0 0 6px rgba(201, 160, 220, 0.8);
          }
          50% { 
            opacity: 0.6;
            transform: scale(0.7);
            box-shadow: 0 0 10px rgba(201, 160, 220, 1);
          }
        }

        @keyframes star-pulse-ring-active {
          0%, 100% { 
            opacity: 0.3;
            transform: scale(0.5);
          }
          50% { 
            opacity: 1;
            transform: scale(1);
          }
        }

        .pixel-star.active .star-center {
          animation: star-pulse-center-active 1.2s ease-in-out infinite;
        }

        .pixel-star.active .star-ring {
          animation: star-pulse-ring-active 1.2s ease-in-out infinite;
        }

        .cursor-line .spinner-text {
          font-size: 0.8rem;
          color: #c9a0dc;
          font-style: italic;
        }

        /* Scrollbar */
        .console-output::-webkit-scrollbar {
          width: 6px;
        }

        .console-output::-webkit-scrollbar-track {
          background: #1a1a1a;
        }

        .console-output::-webkit-scrollbar-thumb {
          background: #333;
          border-radius: 3px;
        }

        .console-output::-webkit-scrollbar-thumb:hover {
          background: #444;
        }

        @keyframes defibrillator-pulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }

        /* Responsive */
        @media (max-width: 640px) {
          .console-header {
            flex-direction: column;
            gap: 0.5rem;
            align-items: flex-start;
          }

          .console-output {
            padding: 0.5rem;
            min-height: 80px;
            font-size: 0.75rem;
          }

          .output-line .timestamp {
            display: none;
          }
        }
      `}</style>
    </div>
  );
};

export default AgentConsole;
