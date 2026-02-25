import { useEffect, useState, useRef } from "react";
import { apiGet } from "../utils/api";
import { formatTimestamp } from "../utils/format";

interface StatusReport {
  id: string;
  message: string;
  timestamp: string;
}

const NovaTerminal: React.FC = () => {
  const [statuses, setStatuses] = useState<StatusReport[]>([]);
  const [loading, setLoading] = useState(true);
  const terminalBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchStatuses = async () => {
      try {
        const data = await apiGet<StatusReport[]>(
          "/api/nova/status/recent?limit=50&agentId=nova",
        );
        if (data && data.length > 0) {
          setStatuses(data);
        } else {
          setStatuses([]);
        }
      } catch (err) {
        console.error("Failed to fetch nova status:", err);
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch
    fetchStatuses();

    // Poll every 5 seconds
    const interval = setInterval(fetchStatuses, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to top when new messages arrive (newest first)
  useEffect(() => {
    if (terminalBodyRef.current && statuses.length > 0) {
      terminalBodyRef.current.scrollTop = 0;
    }
  }, [statuses]);

  const getTimeSince = (timestamp: string) => {
    const seconds = Math.floor(
      (Date.now() - new Date(timestamp).getTime()) / 1000,
    );
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <div className="nova-terminal">
      <div className="terminal-header">
        <span className="terminal-title">
          <span className="terminal-icon">▸</span> nova.log
        </span>
        {statuses.length > 0 && (
          <span className="terminal-timestamp">
            {getTimeSince(statuses[0].timestamp)}
          </span>
        )}
      </div>
      <div className="terminal-body" ref={terminalBodyRef}>
        {loading ? (
          <span className="terminal-loading">Connecting...</span>
        ) : statuses.length > 0 ? (
          statuses.map((status) => (
            <div key={status.id} className="terminal-line">
              <span className="terminal-time">
                [{formatTimestamp(status.timestamp)}]
              </span>
              <span className="terminal-prompt"> $ </span>
              <span className="terminal-message">{status.message}</span>
            </div>
          ))
        ) : (
          <span className="terminal-idle">No recent activity</span>
        )}
      </div>
      <style>{`
        .nova-terminal {
          margin-top: 1rem;
          background: #0d0d0d;
          border: 1px solid #333;
          border-radius: 8px;
          font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
          font-size: 0.8rem;
          overflow: hidden;
          max-width: 600px;
          width: 100%;
        }

        .terminal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.4rem 0.75rem;
          background: #1a1a1a;
          border-bottom: 1px solid #333;
        }

        .terminal-title {
          color: #888;
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .terminal-icon {
          color: #22c55e;
          margin-right: 0.25rem;
        }

        .terminal-timestamp {
          color: #666;
          font-size: 0.7rem;
        }

        .terminal-body {
          padding: 0.75rem;
          min-height: 60px;
          max-height: 100px;
          overflow-y: auto;
          line-height: 1.4;
          color: #22c55e;
          /* Prevent page scroll when scrolling inside terminal on mobile */
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-y;
        }

        .terminal-line {
          margin-bottom: 0.25rem;
          display: flex;
          align-items: flex-start;
        }

        .terminal-line:last-child {
          margin-bottom: 0;
        }

        .terminal-time {
          color: #666;
          font-size: 0.75rem;
          white-space: nowrap;
          margin-right: 0.25rem;
          user-select: none;
        }

        .terminal-prompt {
          color: #c9a0dc;
          user-select: none;
          white-space: nowrap;
        }

        .terminal-message {
          color: #aaa;
          word-wrap: break-word;
          flex: 1;
        }

        .terminal-loading {
          color: #666;
          font-style: italic;
        }

        .terminal-idle {
          color: #444;
          font-style: italic;
        }

        /* Subtle scanline effect */
        .terminal-body::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: repeating-linear-gradient(
            0deg,
            rgba(0, 0, 0, 0.1),
            rgba(0, 0, 0, 0.1) 1px,
            transparent 1px,
            transparent 2px
          );
          pointer-events: none;
          opacity: 0.3;
        }

        .nova-terminal {
          position: relative;
        }

        /* Retro scrollbar styling */
        .terminal-body::-webkit-scrollbar {
          width: 8px;
        }
        .terminal-body::-webkit-scrollbar-track {
          background: #1a1a1a;
        }
        .terminal-body::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 4px;
        }
        .terminal-body::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
        /* Firefox */
        .terminal-body {
          scrollbar-width: thin;
          scrollbar-color: #444 #1a1a1a;
        }
      `}</style>
    </div>
  );
};

export default NovaTerminal;
