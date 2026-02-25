import { useEffect, useState, useCallback } from "react";
import NovaAvatar from "./NovaAvatar";
import NovaConsole from "./NovaConsole";
import SessionsWidget from "./SessionsWidget";
import type { Expression } from "./NovaAvatar";
import { apiGet } from "../utils/api";
import { formatTimeAgo } from "../utils/format";

interface AgentSession {
  sessionKey: string;
  agentId: string;
  channel: string;
  status: "active" | "idle" | "inactive";
  currentTask?: string;
  expression?: string;
  lastActive: string;
}

interface AgentsResponse {
  agents: AgentSession[];
  timestamp: string;
}

type NovaStatus = "online" | "idle" | "sleeping" | "offline";

// Completion messages when transitioning to idle
const COMPLETION_MESSAGES = [
  "Beamed down",
  "Achieved Orbit",
  "Emerged from hyperspace",
  "Systems Nominal",
  "Mission Complete",
];

const StatusDashboard: React.FC = () => {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [novaExpression, setNovaExpression] = useState<Expression>("neutral");
  const [novaStatus, setNovaStatus] = useState<NovaStatus>("offline");
  const [novaLastActive, setNovaLastActive] = useState<string | null>(null);
  const [completionMessage, setCompletionMessage] = useState<string | null>(
    null,
  );
  const [prevStatus, setPrevStatus] = useState<NovaStatus>("offline");

  const fetchAgents = useCallback(async () => {
    try {
      const data = await apiGet<AgentsResponse>("/api/system/agents");
      setLastUpdate(new Date());

      const novaSession = data.agents?.find(
        (a) => a.agentId === "main" || a.sessionKey.includes("main:main"),
      );

      if (novaSession) {
        setNovaLastActive(novaSession.lastActive);

        if (novaSession.status === "active") {
          setNovaStatus("online");
        } else if (novaSession.status === "idle") {
          setNovaStatus("idle");
        } else {
          setNovaStatus("sleeping");
        }

        if (novaSession.expression) {
          setNovaExpression(novaSession.expression as Expression);
        } else {
          if (novaSession.status === "active") {
            setNovaExpression("neutral");
          } else if (novaSession.status === "idle") {
            setNovaExpression("neutral");
          } else {
            setNovaExpression("sleepy");
          }
        }
      } else {
        setNovaStatus("sleeping");
        setNovaExpression("sleepy");
      }
    } catch (err) {
      console.error("Failed to fetch agents:", err);
      setNovaStatus("offline");
      setNovaExpression("curious");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // Show completion message when Nova transitions from online → idle/sleeping
  useEffect(() => {
    if (
      prevStatus === "online" &&
      (novaStatus === "idle" || novaStatus === "sleeping")
    ) {
      const msg =
        COMPLETION_MESSAGES[
          Math.floor(Math.random() * COMPLETION_MESSAGES.length)
        ];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCompletionMessage(msg);
      const timeout = setTimeout(() => setCompletionMessage(null), 5000);
      return () => clearTimeout(timeout);
    }
    setPrevStatus(novaStatus);
  }, [novaStatus, prevStatus]);

  return (
    <div className="status-dashboard">
      <div className="status-header">
        <h1>Status Dashboard</h1>
        <p className="status-subtitle">
          Real-time agent monitoring
          {lastUpdate && (
            <span className="last-update">
              {" "}
              · Updated {formatTimeAgo(lastUpdate.toISOString())}
            </span>
          )}
        </p>
      </div>

      <div className="nova-avatar-container">
        <NovaAvatar width={400} height={400} expression={novaExpression} />

        <NovaConsole
          status={novaStatus}
          lastActive={novaLastActive}
          completionMessage={completionMessage}
        />

        <SessionsWidget />
      </div>

      <style>{`
        .status-dashboard {
          display: flex;
          flex-direction: column;
          align-items: center;
          max-width: 1000px;
          margin: 0 auto;
          padding: 2rem 1rem;
          min-height: 80vh;
        }

        .status-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .status-header h1 {
          font-size: 2.5rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
          background: linear-gradient(135deg, var(--text-primary), var(--accent));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .status-subtitle {
          font-size: 1rem;
          color: var(--text-secondary);
          margin: 0;
        }

        .last-update {
          opacity: 0.7;
        }

        .nova-avatar-container {
          margin: 1rem auto;
          padding: 1.5rem;
          background: radial-gradient(circle at center, rgba(64, 224, 208, 0.03) 0%, transparent 70%);
          border-radius: 20px;
          border: 1px solid rgba(64, 224, 208, 0.08);
          width: 100%;
          max-width: 800px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .nova-avatar-container canvas {
          width: 100% !important;
          height: auto !important;
          max-width: 100%;
        }

        .agents-console-section {
          width: 100%;
          max-width: 1000px;
          margin-top: 2rem;
        }

        @media (max-width: 768px) {
          .status-dashboard {
            padding: 1rem 0.5rem;
          }

          .status-header h1 {
            font-size: 1.8rem;
          }

          .nova-avatar-container {
            padding: 1rem;
            margin: 0.5rem 0 1.5rem;
          }
        }

        @media (max-width: 640px) {
          .nova-avatar-container canvas {
            width: 280px !important;
            height: 280px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default StatusDashboard;
