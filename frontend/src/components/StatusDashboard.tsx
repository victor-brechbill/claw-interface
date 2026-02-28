import { useEffect, useState, useCallback } from "react";
import AgentConsole from "./AgentConsole";
import SessionsWidget from "./SessionsWidget";
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

type AgentStatus = "online" | "idle" | "sleeping" | "offline";

// Completion messages when transitioning to idle
const COMPLETION_MESSAGES = [
  "Task Complete",
  "All Clear",
  "Standing By",
  "Systems Nominal",
  "Mission Complete",
];

const StatusDashboard: React.FC = () => {
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("offline");
  const [agentLastActive, setAgentLastActive] = useState<string | null>(null);
  const [completionMessage, setCompletionMessage] = useState<string | null>(
    null,
  );
  const [prevStatus, setPrevStatus] = useState<AgentStatus>("offline");

  const fetchAgents = useCallback(async () => {
    try {
      const data = await apiGet<AgentsResponse>("/api/system/agents");
      setLastUpdate(new Date());

      const agentSession = data.agents?.find(
        (a) => a.agentId === "main" || a.sessionKey.includes("main:main"),
      );

      if (agentSession) {
        setAgentLastActive(agentSession.lastActive);

        if (agentSession.status === "active") {
          setAgentStatus("online");
        } else if (agentSession.status === "idle") {
          setAgentStatus("idle");
        } else {
          setAgentStatus("sleeping");
        }
      } else {
        setAgentStatus("sleeping");
      }
    } catch (err) {
      console.error("Failed to fetch agents:", err);
      setAgentStatus("offline");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // Show completion message when Agent transitions from online → idle/sleeping
  useEffect(() => {
    if (
      prevStatus === "online" &&
      (agentStatus === "idle" || agentStatus === "sleeping")
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
    setPrevStatus(agentStatus);
  }, [agentStatus, prevStatus]);

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

      <div className="agent-avatar-container">
        <AgentConsole
          status={agentStatus}
          lastActive={agentLastActive}
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

        .agent-avatar-container {
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

          .agent-avatar-container {
            padding: 1rem;
            margin: 0.5rem 0 1.5rem;
          }
        }

      `}</style>
    </div>
  );
};

export default StatusDashboard;
