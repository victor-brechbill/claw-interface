import React, { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost } from "../utils/api";
import { formatTimeAgo } from "../utils/format";
import OAuthRefreshModal from "./OAuthRefreshModal";

function formatDuration(ms: number): string {
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatRunTime(ms: number): string {
  const now = Date.now();
  const diff = Math.floor((now - ms) / 1000);
  if (diff < 60) return "just now";
  if (diff < 120) return "1 min ago";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 7200) return "1 hour ago";
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

/**
 * Convert a cron expression + timezone into a human-readable schedule string in ET.
 * Handles common patterns; falls back to raw expression for unusual ones.
 */
function formatCronSchedule(expr: string, tz?: string): string {
  if (!expr) return "—";
  const parts = expr.split(/\s+/);
  if (parts.length < 5) return expr;

  const [min, hour, dom, , dow] = parts;

  // Format time in ET
  const formatTime = (h: number, m: number): string => {
    const isET = !tz || /detroit|eastern|new.york/i.test(tz);
    let displayH = h;
    if (!isET && tz === "UTC") {
      displayH = (h - 5 + 24) % 24;
    }
    const ampm = displayH >= 12 ? "p" : "a";
    const h12 = displayH === 0 ? 12 : displayH > 12 ? displayH - 12 : displayH;
    const mStr = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
    return `${h12}${mStr}${ampm}`;
  };

  const dayNames: Record<string, string> = {
    "0": "Sun",
    "1": "Mon",
    "2": "Tue",
    "3": "Wed",
    "4": "Thu",
    "5": "Fri",
    "6": "Sat",
    "7": "Sun",
  };

  const isWild = (s: string) => s === "*";
  const isNum = (s: string) => /^\d+$/.test(s);

  // "Every N hours" pattern: */N or 0 */N * * *
  if (isNum(min) && hour.startsWith("*/")) {
    const interval = parseInt(hour.split("/")[1]);
    return `Every ${interval}h`;
  }

  // Fixed time patterns
  if (isNum(min) && isNum(hour)) {
    const h = parseInt(hour);
    const m = parseInt(min);
    const time = formatTime(h, m);

    // Specific days of week
    if (isWild(dom) && !isWild(dow)) {
      if (dow === "1-5") return `M-F ${time}`;
      if (dow === "0,6" || dow === "6,0") return `S/S ${time}`;
      if (dow === "0") return `Sun ${time}`;
      if (dow === "6") return `Sat ${time}`;
      const days = dow
        .split(",")
        .map((d) => dayNames[d] || d)
        .join("/");
      return `${days} ${time}`;
    }

    // Specific day of month
    if (isNum(dom) && isWild(dow)) {
      const d = parseInt(dom);
      return `${d}th ${time}`;
    }

    // Daily
    if (isWild(dom) && isWild(dow)) {
      return `Daily ${time}`;
    }
  }

  // Fallback
  return expr + (tz ? ` (${tz})` : "");
}

interface KernelInfo {
  currentVersion: string;
  backupExists: boolean;
  backupVersion: string;
  installPath: string;
  backupPath: string;
}

interface ConfigInfo {
  openClawConfig: string;
  authConfig: string;
  backupExists: boolean;
  latestBackup: string;
  latestBackupAge: string;
}

interface RollForwardInfo {
  available: boolean;
  latestSnapshot: string;
  snapshotAge: string;
}

interface TokenStatus {
  status: "healthy" | "warning" | "expired" | "unknown";
  expiresAt?: string;
  message?: string;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface SystemStats {
  uptime?: string;
  diskUsage?: string;
  memUsage?: string;
  ipAddress?: string;
}

interface PeakMetrics {
  peakCpu: number;
  peakRam: string;
  oomEvents: number;
  currentCpu: number;
  currentRam: string;
  loadAvg: number[]; // 1min, 5min, 15min
  timestamp: string;
}

interface CronJobStatus {
  id: string;
  name: string;
  schedule: string;
  timezone?: string;
  lastRunAt: string;
  status: string; // "healthy", "failed", "never"
  nextRunAt: string;
  enabled: boolean;
  agentId?: string;
}

interface CronHistory {
  jobs: CronJobStatus[];
  timestamp: string;
}

interface CronRunEntry {
  ts: number;
  jobId: string;
  action: string;
  status: string;
  summary?: string;
  runAtMs: number;
  durationMs: number;
  nextRunAtMs?: number;
  error?: string;
}

interface ActivityWindow {
  windowStart: string;
  windowEnd: string;
  activityCount: number;
}

interface ActivityGrid {
  agentId: string;
  windows: ActivityWindow[];
  timestamp: string;
}

interface DoctorStatus {
  status: "standby" | "working";
  lastRunAt: string;
  lastResult: "healthy" | "repaired" | "broken" | "unknown";
  isRunning: boolean;
  gatewayProcessCount?: number;
  clawdbotProcessCount?: number;
  lastRestart?: string;
  gatewayUptime?: string;
}

interface DoctorReport {
  report: string;
  result: string;
  runAt: string;
  duration: number;
}

interface DomainSSLInfo {
  domain: string;
  sslExpiry: string;
  sslDaysRemaining: number;
  cloudflareStatus: string;
  dnsStatus: string;
  tunnelStatus: string;
  tunnelConnections: number;
  timestamp: string;
}

// ActivityGrid component for GitHub contribution style display
function ActivityGridComponent({
  agentId,
  repoUrl,
  data,
  days,
}: {
  agentId: string;
  repoUrl?: string;
  data: ActivityWindow[];
  days: number;
}) {
  const getCellLevel = (count: number) => {
    if (count === 0) return "";
    if (count <= 2) return "level-1";
    if (count <= 5) return "level-2";
    if (count <= 10) return "level-3";
    if (count <= 20) return "level-4";
    return "level-5";
  };

  // Create grid: days columns x 6 rows (4-hour windows)
  // For mobile (15 days), show the LAST 15 days (most recent), not the first 15
  const totalDays = Math.floor(data.length / 6); // Total days in data
  const dayOffset = Math.max(0, totalDays - days); // Skip older days on mobile

  const cells = [];
  for (let hour = 0; hour < 6; hour++) {
    for (let day = 0; day < days; day++) {
      const index = (day + dayOffset) * 6 + hour;
      const window = data[index];
      const level = window ? getCellLevel(window.activityCount) : "";

      cells.push(
        <div
          key={`${day}-${hour}`}
          className={`activity-cell ${level}`}
          title={
            window
              ? `${window.activityCount} activities at ${new Date(
                  window.windowStart,
                ).toLocaleString()}`
              : "No data"
          }
        />,
      );
    }
  }

  // Y-axis labels for 4-hour windows (0-4, 4-8, 8-12, 12-16, 16-20, 20-24)
  const yLabels = ["00:00", "", "08:00", "", "16:00", ""];

  return (
    <div className="agent-activity">
      {repoUrl ? (
        <a
          href={repoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="agent-label"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          {agentId}
        </a>
      ) : (
        <div className="agent-label">{agentId}</div>
      )}
      <div className="activity-grid-wrapper">
        <div className="activity-y-axis">
          {yLabels.map((label, i) => (
            <div key={i} className="y-label">
              {label}
            </div>
          ))}
        </div>
        <div
          className="activity-grid"
          style={{ gridTemplateColumns: `repeat(${days}, 10px)` }}
        >
          {cells}
        </div>
      </div>
    </div>
  );
}

export default function System() {
  const [stats, setStats] = useState<SystemStats>({});
  const [peakMetrics, setPeakMetrics] = useState<PeakMetrics | null>(null);
  const [cronHistory, setCronHistory] = useState<CronHistory | null>(null);
  const [activityGrids, setActivityGrids] = useState<{
    dashboard?: ActivityGrid;
    ns?: ActivityGrid;
    dsp?: ActivityGrid;
    kernel?: ActivityGrid;
  }>({});
  const [doctorStatus, setDoctorStatus] = useState<DoctorStatus | null>(null);
  const [kernelInfo, setKernelInfo] = useState<KernelInfo | null>(null);
  const [configInfo, setConfigInfo] = useState<ConfigInfo | null>(null);
  const [rollForwardInfo, setRollForwardInfo] =
    useState<RollForwardInfo | null>(null);
  const [domainSSL, setDomainSSL] = useState<DomainSSLInfo | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportContent, setReportContent] = useState<DoctorReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showOAuthRefreshModal, setShowOAuthRefreshModal] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [activityDays, setActivityDays] = useState(
    typeof window !== "undefined" && window.innerWidth < 768 ? 15 : 30,
  );
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [cronRuns, setCronRuns] = useState<CronRunEntry[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const expandedJobIdRef = useRef<string | null>(null);

  // Responsive activity grid days
  useEffect(() => {
    const handleResize = () => {
      setActivityDays(window.innerWidth < 768 ? 15 : 30);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await apiGet<SystemStats>("/api/system/stats");
      setStats(data);
    } catch {
      // Silently fail
    }
  }, []);

  const loadPeakMetrics = useCallback(async () => {
    try {
      const data = await apiGet<PeakMetrics>("/api/system/metrics/peaks");
      setPeakMetrics(data);
    } catch {
      // Silently fail
    }
  }, []);

  const loadCronHistory = useCallback(async () => {
    try {
      const data = await apiGet<CronHistory>("/api/system/cron-history");
      setCronHistory(data);
    } catch {
      // Silently fail
    }
  }, []);

  const loadCronRuns = useCallback(async (jobId: string) => {
    setLoadingRuns(true);
    try {
      const data = await apiGet<{ entries: CronRunEntry[] }>(
        `/api/system/cron-runs?jobId=${encodeURIComponent(jobId)}&limit=20`,
      );
      setCronRuns(data.entries || []);
    } catch {
      setCronRuns([]);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  // Keep ref in sync for interval callback
  useEffect(() => {
    expandedJobIdRef.current = expandedJobId;
  }, [expandedJobId]);

  const loadActivityGrids = useCallback(async () => {
    try {
      const repos = [
        { key: "dashboard", path: "victor-brechbill/nova" },
        { key: "ns", path: "victor-brechbill/neighborhood-share" },
        { key: "dsp", path: "victor-brechbill/dailystockpick" },
        { key: "kernel", path: "victor-brechbill/nova-kernel" },
      ];
      const grids: Record<string, ActivityGrid> = {};

      for (const repo of repos) {
        try {
          const data = await apiGet<ActivityGrid>(
            `/api/system/activity-grid?agent=${encodeURIComponent(repo.path)}`,
          );
          grids[repo.key] = data;
        } catch {
          // Silently fail for individual repos
        }
      }

      setActivityGrids(grids);
    } catch {
      // Silently fail
    }
  }, []);

  const loadDoctorStatus = useCallback(async () => {
    try {
      const data = await apiGet<DoctorStatus>("/api/system/doctor/status");
      setDoctorStatus(data);
    } catch {
      // Silently fail
    }
  }, []);

  const loadDomainSSL = useCallback(async () => {
    try {
      const data = await apiGet<DomainSSLInfo>("/api/system/domain-ssl");
      setDomainSSL(data);
    } catch {
      // Silently fail - this endpoint may not be implemented yet
    }
  }, []);

  const loadKernelInfo = useCallback(async () => {
    try {
      const data = await apiGet<KernelInfo>("/api/system/kernel-info");
      setKernelInfo(data);
    } catch {
      // Silently fail
    }
  }, []);

  const handleKernelRollback = async () => {
    if (
      !window.confirm(
        "Are you sure? This will stop the gateway, restore the previous kernel version, and restart.",
      )
    ) {
      return;
    }
    setIsLoading(true);
    try {
      await apiPost("/api/system/kernel-rollback", {});
      alert("Kernel rollback initiated. Gateway will restart.");
      setTimeout(loadKernelInfo, 5000);
    } catch {
      alert(
        "Gateway restarting with restored kernel. Please refresh in 30 seconds.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadConfigInfo = useCallback(async () => {
    try {
      const data = await apiGet<ConfigInfo>("/api/system/config-info");
      setConfigInfo(data);
    } catch {
      // Silently fail
    }
  }, []);

  const loadRollForwardInfo = useCallback(async () => {
    try {
      const data = await apiGet<RollForwardInfo>(
        "/api/system/config-rollforward-available",
      );
      setRollForwardInfo(data);
    } catch {
      // Silently fail
    }
  }, []);

  const loadTokenStatus = useCallback(async () => {
    try {
      const data = await apiGet<TokenStatus>("/api/system/token-status");
      setTokenStatus(data);
    } catch (error) {
      console.error("Failed to load token status:", error);
    }
  }, []);

  const handleConfigRollback = async () => {
    if (
      !window.confirm(
        "Are you sure? This will stop the gateway, restore the most recent config backup, and restart. Current config will be saved as a pre-rollback snapshot.",
      )
    ) {
      return;
    }
    setIsLoading(true);
    try {
      await apiPost("/api/system/config-rollback", {});
      alert("Config rollback initiated. Gateway will restart.");
      setTimeout(loadConfigInfo, 5000);
    } catch {
      alert(
        "Gateway restarting with restored config. Please refresh in 30 seconds.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleRollForward = async () => {
    if (
      !window.confirm(
        "Are you sure? This will restore the config that existed BEFORE the last rollback and restart the gateway.",
      )
    ) {
      return;
    }
    setIsLoading(true);
    try {
      await apiPost("/api/system/config-rollforward", {});
      alert("Config roll forward initiated. Gateway will restart.");
      setTimeout(loadRollForwardInfo, 5000);
      setTimeout(loadConfigInfo, 5000);
    } catch {
      alert(
        "Gateway restarting with restored config. Please refresh in 30 seconds.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetServer = async () => {
    if (
      !window.confirm(
        "This will restart the entire server. You'll lose connection temporarily. Continue?",
      )
    ) {
      return;
    }
    setIsLoading(true);
    try {
      await apiPost("/api/system/reset-server", {});
      alert("Server restart initiated. Connection will be lost momentarily.");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      alert("Failed to restart server: " + message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetGateway = async () => {
    if (!window.confirm("This will restart the Clawdbot gateway. Continue?")) {
      return;
    }
    setIsLoading(true);
    try {
      await apiPost("/api/system/reset-gateway", {});
      alert("Gateway restart completed successfully.");
      setTimeout(loadDoctorStatus, 2000);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      alert("Failed to restart gateway: " + message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunDoctor = async () => {
    if (
      !window.confirm(
        "This will run the system doctor (may take up to 60 seconds). Continue?",
      )
    ) {
      return;
    }
    setIsLoading(true);
    try {
      interface DoctorResult {
        result: string;
        output: string;
        duration: number;
        timestamp: string;
      }
      const result = await apiPost<DoctorResult>("/api/system/doctor", {});
      const resultText =
        result.result === "healthy"
          ? "Healthy"
          : result.result === "repaired"
            ? "Repaired"
            : "Broken";
      alert(`Doctor completed: ${resultText}`);
      loadDoctorStatus();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      alert("Failed to run doctor: " + message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewReport = async () => {
    try {
      const report = await apiGet<DoctorReport>("/api/system/doctor/report");
      setReportContent(report);
      setShowReportModal(true);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "No reports found";
      alert("Failed to load report: " + message);
    }
  };

  const handleInstallPWA = async () => {
    if (deferredPrompt) {
      await deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      if (result.outcome === "accepted") {
        setDeferredPrompt(null);
      }
    } else {
      alert("PWA installation is not available on this browser/device.");
    }
  };

  const handleCheckUpdates = () => {
    alert(
      "Checking for system updates...\n\n(Note: This feature is not yet implemented)",
    );
  };

  const handleForceRefresh = async () => {
    if (
      !window.confirm(
        "This will clear all caches and force refresh the application. Continue?",
      )
    ) {
      return;
    }

    try {
      // Unregister all service workers
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const registration of registrations) {
          await registration.unregister();
        }
      }

      // Clear all caches
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        for (const cacheName of cacheNames) {
          await caches.delete(cacheName);
        }
      }

      // Hard reload (bypass cache)
      window.location.reload();
    } catch (error) {
      console.error("Force refresh failed:", error);
      // Fallback to regular reload
      window.location.reload();
    }
  };

  const formatTimestamp = (timestamp: string) => {
    if (!timestamp || timestamp === "0001-01-01T00:00:00Z") return "Never";
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  useEffect(() => {
    // Initial load and set up interval
    loadStats();
    loadPeakMetrics();
    loadCronHistory();
    loadActivityGrids();
    loadDoctorStatus();
    loadDomainSSL();
    loadKernelInfo();
    loadConfigInfo();
    loadRollForwardInfo();
    loadTokenStatus();

    // PWA install prompt handler
    const handleBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstallPrompt as EventListener,
    );

    const interval = setInterval(() => {
      loadStats();
      loadPeakMetrics();
      loadCronHistory();
      loadDoctorStatus();
      loadDomainSSL(); // Check SSL status regularly
      loadKernelInfo();
      loadConfigInfo();
      loadRollForwardInfo();
      loadTokenStatus();
      // Refresh expanded cron run history
      if (expandedJobIdRef.current) {
        loadCronRuns(expandedJobIdRef.current);
      }
      // Activity grids update less frequently (every 5 minutes)
      if (Date.now() % (5 * 60 * 1000) < 10000) {
        loadActivityGrids();
      }
    }, 10000); // Refresh every 10 seconds

    return () => {
      clearInterval(interval);
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt as EventListener,
      );
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="bios-container">
      <header className="bios-header">
        <h1 className="bios-title">System Utility</h1>
      </header>

      <div className="bios-sections-grid">
        <div className="bios-section">
          <h3 className="bios-section-header">SERVER STATUS</h3>
          <div className="bios-section-content">
            <table className="bios-table">
              <tbody>
                <tr>
                  <td>Uptime</td>
                  <td>{stats.uptime || "Unknown"}</td>
                </tr>
                <tr>
                  <td>IP Address</td>
                  <td>{stats.ipAddress || "Unknown"}</td>
                </tr>
                <tr>
                  <td>CPU Usage</td>
                  <td>
                    {peakMetrics
                      ? `${peakMetrics.currentCpu.toFixed(1)}%`
                      : "-"}
                  </td>
                </tr>
                <tr>
                  <td>Memory Usage</td>
                  <td>
                    {peakMetrics
                      ? peakMetrics.currentRam
                      : stats.memUsage || "-"}
                  </td>
                </tr>
                <tr>
                  <td>Disk Usage</td>
                  <td>{stats.diskUsage || "Unknown"}</td>
                </tr>
                <tr>
                  <td>Load Average</td>
                  <td className="bios-status-ok">
                    {peakMetrics?.loadAvg
                      ? peakMetrics.loadAvg.map((l) => l.toFixed(2)).join(" / ")
                      : "-"}
                  </td>
                </tr>
                <tr>
                  <td>OOM Events (24h)</td>
                  <td
                    className={
                      peakMetrics?.oomEvents
                        ? "bios-status-warning"
                        : "bios-status-ok"
                    }
                  >
                    {peakMetrics?.oomEvents ?? "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="bios-section">
          <h3 className="bios-section-header">CRON JOBS</h3>
          <div className="bios-section-content">
            {cronHistory ? (
              <table className="cron-jobs-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Agent</th>
                    <th>Schedule</th>
                    <th>Last Run</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cronHistory.jobs.map((job, index) => {
                    const lastRun =
                      job.lastRunAt && !job.lastRunAt.startsWith("0001")
                        ? formatTimeAgo(job.lastRunAt)
                        : "Never";
                    const isExpanded = expandedJobId === job.id;
                    return (
                      <React.Fragment key={index}>
                        <tr
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            if (isExpanded) {
                              setExpandedJobId(null);
                              setCronRuns([]);
                            } else {
                              setExpandedJobId(job.id);
                              loadCronRuns(job.id);
                            }
                          }}
                        >
                          <td className="cron-name" title={job.name}>
                            {isExpanded ? "▾ " : "▸ "}
                            {job.name}
                          </td>
                          <td className="cron-agent">
                            {job.agentId || "main"}
                          </td>
                          <td
                            className="cron-schedule"
                            title={
                              job.schedule +
                              (job.timezone ? ` (${job.timezone})` : "")
                            }
                          >
                            {formatCronSchedule(job.schedule, job.timezone)}
                          </td>
                          <td className="cron-lastrun">{lastRun}</td>
                          <td>
                            <span
                              className={
                                !job.enabled
                                  ? "cron-status-off"
                                  : job.status === "healthy"
                                    ? "cron-status-ok"
                                    : job.status === "never"
                                      ? "cron-status-never"
                                      : "cron-status-failed"
                              }
                              title={!job.enabled ? "disabled" : job.status}
                            />
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td
                              colSpan={5}
                              style={{
                                padding: 0,
                                background: "#0a0a0a",
                                borderLeft: "2px solid #333",
                              }}
                            >
                              <div
                                style={{
                                  padding: "0.5rem 0.75rem 0.5rem 1.5rem",
                                }}
                              >
                                {loadingRuns ? (
                                  <div style={{ color: "#888" }}>
                                    Loading...
                                  </div>
                                ) : cronRuns.length === 0 ? (
                                  <div style={{ color: "#666" }}>
                                    No runs found
                                  </div>
                                ) : (
                                  <table
                                    style={{
                                      width: "100%",
                                      borderCollapse: "collapse",
                                      fontFamily: "'Courier New', monospace",
                                      fontSize: "12px",
                                    }}
                                  >
                                    <thead>
                                      <tr
                                        style={{
                                          color: "#888",
                                          borderBottom: "1px solid #222",
                                        }}
                                      >
                                        <th
                                          style={{
                                            textAlign: "left",
                                            padding: "2px 8px 4px 0",
                                          }}
                                        >
                                          Time
                                        </th>
                                        <th
                                          style={{
                                            textAlign: "left",
                                            padding: "2px 8px 4px 0",
                                          }}
                                        >
                                          Duration
                                        </th>
                                        <th
                                          style={{
                                            textAlign: "left",
                                            padding: "2px 8px 4px 0",
                                          }}
                                        >
                                          Status
                                        </th>
                                        <th
                                          style={{
                                            textAlign: "left",
                                            padding: "2px 8px 4px 0",
                                          }}
                                        >
                                          Summary
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {cronRuns.map((run, i) => (
                                        <tr
                                          key={i}
                                          style={{
                                            borderBottom: "1px solid #111",
                                          }}
                                        >
                                          <td
                                            style={{
                                              padding: "3px 8px 3px 0",
                                              color: "#aaa",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            {formatRunTime(run.runAtMs)}
                                          </td>
                                          <td
                                            style={{
                                              padding: "3px 8px 3px 0",
                                              color: "#aaa",
                                              whiteSpace: "nowrap",
                                            }}
                                          >
                                            {formatDuration(run.durationMs)}
                                          </td>
                                          <td
                                            style={{
                                              padding: "3px 8px 3px 0",
                                              whiteSpace: "nowrap",
                                              color:
                                                run.status === "ok"
                                                  ? "#00ff00"
                                                  : run.status === "error"
                                                    ? "#ff4444"
                                                    : "#888",
                                            }}
                                          >
                                            {run.status}
                                          </td>
                                          <td
                                            style={{
                                              padding: "3px 0",
                                              color: "#ccc",
                                            }}
                                          >
                                            {run.summary && (
                                              <span title={run.summary}>
                                                {run.summary.length > 100
                                                  ? run.summary.slice(0, 100) +
                                                    "…"
                                                  : run.summary}
                                              </span>
                                            )}
                                            {run.error && (
                                              <div
                                                style={{
                                                  color: "#ff4444",
                                                  fontSize: "11px",
                                                  marginTop: "2px",
                                                }}
                                              >
                                                {run.error}
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div>Loading cron job history...</div>
            )}
          </div>
        </div>

        <div className="bios-section">
          <h3 className="bios-section-header">REPO ACTIVITY</h3>
          <div className="bios-section-content">
            <div className="activity-grid-container">
              {activityGrids.dashboard && (
                <ActivityGridComponent
                  agentId="Dashboard"
                  repoUrl="https://github.com/victor-brechbill/nova"
                  data={activityGrids.dashboard.windows}
                  days={activityDays}
                />
              )}
              {activityGrids.ns && (
                <ActivityGridComponent
                  agentId="NeighborhoodShare"
                  repoUrl="https://github.com/victor-brechbill/neighborhood-share"
                  data={activityGrids.ns.windows}
                  days={activityDays}
                />
              )}
              {activityGrids.dsp && (
                <ActivityGridComponent
                  agentId="DailyStockPick"
                  repoUrl="https://github.com/victor-brechbill/dailystockpick"
                  data={activityGrids.dsp.windows}
                  days={activityDays}
                />
              )}
              {activityGrids.kernel && (
                <ActivityGridComponent
                  agentId="Nova Kernel"
                  repoUrl="https://github.com/victor-brechbill/nova-kernel"
                  data={activityGrids.kernel.windows}
                  days={activityDays}
                />
              )}
            </div>
          </div>
        </div>

        <div className="bios-section">
          <h3 className="bios-section-header">SYSTEM DOCTOR</h3>
          <div className="bios-section-content">
            <table className="bios-table">
              <tbody>
                <tr>
                  <td>Status</td>
                  <td>{doctorStatus?.isRunning ? "Working..." : "Standby"}</td>
                </tr>
                <tr>
                  <td>Last Run</td>
                  <td>{formatTimestamp(doctorStatus?.lastRunAt || "")}</td>
                </tr>
                <tr>
                  <td>Result</td>
                  <td
                    className={
                      doctorStatus?.lastResult === "healthy"
                        ? "bios-status-ok"
                        : doctorStatus?.lastResult === "repaired"
                          ? "bios-status-warning"
                          : doctorStatus?.lastResult === "broken"
                            ? "bios-status-error"
                            : ""
                    }
                  >
                    {doctorStatus?.lastResult === "healthy" && "Healthy"}
                    {doctorStatus?.lastResult === "repaired" && "Repaired"}
                    {doctorStatus?.lastResult === "broken" && "Broken"}
                    {doctorStatus?.lastResult === "unknown" && "Unknown"}
                  </td>
                </tr>
                <tr>
                  <td>Gateway Processes</td>
                  <td>{doctorStatus?.gatewayProcessCount ?? "Unknown"}</td>
                </tr>
                <tr>
                  <td>Clawdbot Processes</td>
                  <td>{doctorStatus?.clawdbotProcessCount ?? "Unknown"}</td>
                </tr>
                <tr>
                  <td>Gateway Uptime</td>
                  <td>{doctorStatus?.gatewayUptime || "Unknown"}</td>
                </tr>
              </tbody>
            </table>

            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={handleRunDoctor}
                disabled={isLoading || doctorStatus?.isRunning}
                style={{
                  background: "#444",
                  color: "#fff",
                  border: "1px solid #666",
                  padding: "0.5rem 1rem",
                  fontFamily: "Courier New, monospace",
                  cursor:
                    isLoading || doctorStatus?.isRunning
                      ? "not-allowed"
                      : "pointer",
                  opacity: isLoading || doctorStatus?.isRunning ? 0.6 : 1,
                }}
              >
                Run Doctor
              </button>
              <button
                onClick={handleViewReport}
                disabled={isLoading}
                style={{
                  background: "#444",
                  color: "#fff",
                  border: "1px solid #666",
                  padding: "0.5rem 1rem",
                  fontFamily: "Courier New, monospace",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                View Report
              </button>
            </div>
          </div>
        </div>

        <div className="bios-section">
          <h3 className="bios-section-header">KERNEL</h3>
          <div className="bios-section-content">
            <table className="bios-table">
              <tbody>
                <tr>
                  <td>Current Version</td>
                  <td>{kernelInfo?.currentVersion || "Unknown"}</td>
                </tr>
                <tr>
                  <td>Backup Version</td>
                  <td>
                    {kernelInfo?.backupExists
                      ? kernelInfo.backupVersion || "Unknown"
                      : "No backup"}
                  </td>
                </tr>
                <tr>
                  <td>Config Backup</td>
                  <td>
                    {configInfo?.backupExists
                      ? `${configInfo.latestBackup} (${configInfo.latestBackupAge})`
                      : "No backup"}
                  </td>
                </tr>
                <tr>
                  <td>OAuth Token Expiration</td>
                  <td
                    className={
                      tokenStatus?.status === "healthy"
                        ? "bios-status-ok"
                        : tokenStatus?.status === "warning"
                          ? "bios-status-warning"
                          : tokenStatus?.status === "expired"
                            ? "bios-status-error"
                            : ""
                    }
                  >
                    {tokenStatus?.expiresAt
                      ? (() => {
                          const exp = new Date(tokenStatus.expiresAt);
                          const now = new Date();
                          const diffMs = exp.getTime() - now.getTime();
                          if (diffMs <= 0) return "EXPIRED";
                          const hours = Math.floor(diffMs / 3600000);
                          const mins = Math.floor((diffMs % 3600000) / 60000);
                          const remaining =
                            hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                          return `${exp.toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })} (${remaining})`;
                        })()
                      : tokenStatus?.message || "Loading..."}
                  </td>
                </tr>
              </tbody>
            </table>

            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              {kernelInfo?.backupExists && (
                <button
                  onClick={handleKernelRollback}
                  disabled={isLoading}
                  style={{
                    background: "#444",
                    color: "#fff",
                    border: "1px solid #666",
                    padding: "0.5rem 1rem",
                    fontFamily: "Courier New, monospace",
                    cursor: isLoading ? "not-allowed" : "pointer",
                    opacity: isLoading ? 0.6 : 1,
                  }}
                >
                  {isLoading ? "Rolling back..." : "Rollback Kernel"}
                </button>
              )}
              {configInfo?.backupExists && (
                <button
                  onClick={handleConfigRollback}
                  disabled={isLoading}
                  style={{
                    background: "#444",
                    color: "#fff",
                    border: "1px solid #666",
                    padding: "0.5rem 1rem",
                    fontFamily: "Courier New, monospace",
                    cursor: isLoading ? "not-allowed" : "pointer",
                    opacity: isLoading ? 0.6 : 1,
                  }}
                >
                  {isLoading ? "Rolling back..." : "Rollback Config"}
                </button>
              )}
              {rollForwardInfo?.available && (
                <button
                  onClick={handleRollForward}
                  disabled={isLoading}
                  style={{
                    background: "#444",
                    color: "#fff",
                    border: "1px solid #666",
                    padding: "0.5rem 1rem",
                    fontFamily: "Courier New, monospace",
                    cursor: isLoading ? "not-allowed" : "pointer",
                    opacity: isLoading ? 0.6 : 1,
                  }}
                  title="Restore pre-rollback snapshot (undo last rollback)"
                >
                  {isLoading ? "Rolling forward..." : "Roll Forward Config"}
                </button>
              )}
              <button
                onClick={() => setShowOAuthRefreshModal(true)}
                style={{
                  background: "#444",
                  color: "#fff",
                  border: "1px solid #666",
                  padding: "0.5rem 1rem",
                  fontFamily: "Courier New, monospace",
                  cursor: "pointer",
                }}
                title="Refresh Claude OAuth tokens via interactive login"
              >
                Refresh OAuth Token
              </button>
            </div>
          </div>
        </div>

        <OAuthRefreshModal
          isOpen={showOAuthRefreshModal}
          onClose={() => setShowOAuthRefreshModal(false)}
        />

        <div className="bios-section">
          <h3 className="bios-section-header">DASHBOARD APP</h3>
          <div className="bios-section-content">
            <table className="bios-table">
              <tbody>
                <tr>
                  <td>Version</td>
                  <td>v{__APP_VERSION__}</td>
                </tr>
                <tr>
                  <td>GitHub Repo</td>
                  <td>
                    <a
                      href="https://github.com/victorbrechbill/nova"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#c9a0dc", textDecoration: "underline" }}
                    >
                      victorbrechbill/nova
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>

            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                gap: "0.5rem",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={handleCheckUpdates}
                disabled={isLoading}
                style={{
                  background: "#444",
                  color: "#fff",
                  border: "1px solid #666",
                  padding: "0.5rem 1rem",
                  fontFamily: "Courier New, monospace",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                Check Updates
              </button>
              <button
                onClick={handleForceRefresh}
                disabled={isLoading}
                style={{
                  background: "#444",
                  color: "#fff",
                  border: "1px solid #666",
                  padding: "0.5rem 1rem",
                  fontFamily: "Courier New, monospace",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                Force Refresh
              </button>
              <button
                onClick={handleInstallPWA}
                disabled={isLoading || !deferredPrompt}
                style={{
                  background: "#444",
                  color: "#fff",
                  border: "1px solid #666",
                  padding: "0.5rem 1rem",
                  fontFamily: "Courier New, monospace",
                  cursor:
                    isLoading || !deferredPrompt ? "not-allowed" : "pointer",
                  opacity: isLoading || !deferredPrompt ? 0.6 : 1,
                }}
              >
                Install PWA
              </button>
            </div>
          </div>
        </div>

        <div className="bios-section">
          <h3 className="bios-section-header">DOMAIN & SSL STATUS</h3>
          <div className="bios-section-content">
            {domainSSL ? (
              <table className="bios-table">
                <tbody>
                  <tr>
                    <td>Domain</td>
                    <td>{domainSSL.domain}</td>
                  </tr>
                  <tr>
                    <td>SSL Certificate</td>
                    <td
                      className={
                        domainSSL.sslDaysRemaining > 30
                          ? "bios-status-ok"
                          : domainSSL.sslDaysRemaining > 7
                            ? "bios-status-warning"
                            : "bios-status-error"
                      }
                    >
                      {domainSSL.sslDaysRemaining > 0
                        ? `Expires in ${domainSSL.sslDaysRemaining} days`
                        : "EXPIRED"}
                    </td>
                  </tr>
                  <tr>
                    <td>SSL Expiry Date</td>
                    <td>
                      {new Date(domainSSL.sslExpiry).toLocaleDateString()}
                    </td>
                  </tr>
                  <tr>
                    <td>Cloudflare Status</td>
                    <td
                      className={
                        domainSSL.cloudflareStatus === "active"
                          ? "bios-status-ok"
                          : "bios-status-warning"
                      }
                    >
                      {domainSSL.cloudflareStatus || "Unknown"}
                    </td>
                  </tr>
                  <tr>
                    <td>DNS Status</td>
                    <td
                      className={
                        domainSSL.dnsStatus === "ok"
                          ? "bios-status-ok"
                          : "bios-status-warning"
                      }
                    >
                      {domainSSL.dnsStatus || "Unknown"}
                    </td>
                  </tr>
                  <tr>
                    <td>Tunnel Status</td>
                    <td
                      className={
                        domainSSL.tunnelStatus?.startsWith("✓")
                          ? "bios-status-ok"
                          : "bios-status-error"
                      }
                    >
                      {domainSSL.tunnelStatus || "Unknown"}
                    </td>
                  </tr>
                  <tr>
                    <td>Tunnel Connections</td>
                    <td
                      className={
                        domainSSL.tunnelConnections > 0
                          ? "bios-status-ok"
                          : "bios-status-error"
                      }
                    >
                      {domainSSL.tunnelConnections ?? 0}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div>Loading domain/SSL information...</div>
            )}
          </div>
        </div>

        <div className="bios-section">
          <h3 className="bios-section-header">SYSTEM CONTROLS</h3>
          <div className="bios-section-content">
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              <button
                onClick={handleResetGateway}
                disabled={isLoading}
                style={{
                  background: "#ffff00",
                  color: "#000",
                  border: "1px solid #808080",
                  padding: "0.5rem 1rem",
                  fontFamily: "Courier New, monospace",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                Reset Gateway
              </button>
              <button
                onClick={handleResetServer}
                disabled={isLoading}
                style={{
                  background: "#ff0000",
                  color: "#ffffff",
                  border: "1px solid #808080",
                  padding: "0.5rem 1rem",
                  fontFamily: "Courier New, monospace",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                Reset Server
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Doctor Report Modal */}
      {showReportModal && reportContent && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
          onClick={() => setShowReportModal(false)}
        >
          <div
            style={{
              backgroundColor: "#000",
              color: "#c0c0c0",
              border: "2px solid #c0c0c0",
              padding: "1rem",
              width: "90%",
              maxWidth: "800px",
              maxHeight: "90%",
              overflow: "auto",
              fontFamily: "Courier New, monospace",
              fontSize: "14px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1rem",
                borderBottom: "1px solid #c0c0c0",
                paddingBottom: "0.5rem",
              }}
            >
              <h3 style={{ margin: 0, color: "#ffffff" }}>DOCTOR REPORT</h3>
              <button
                onClick={() => setShowReportModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#c0c0c0",
                  fontSize: "18px",
                  cursor: "pointer",
                  padding: "0",
                }}
              >
                X
              </button>
            </div>

            <div style={{ marginBottom: "1rem", fontSize: "12px" }}>
              <div>
                Run Time: {new Date(reportContent.runAt).toLocaleString()}
              </div>
              <div>Duration: {(reportContent.duration / 1000).toFixed(2)}s</div>
              <div
                style={{
                  color:
                    reportContent.result === "healthy"
                      ? "#00ff00"
                      : reportContent.result === "repaired"
                        ? "#ffff00"
                        : "#ff0000",
                }}
              >
                Result: {reportContent.result.toUpperCase()}
              </div>
            </div>

            <pre
              style={{
                backgroundColor: "#000",
                color: "#c0c0c0",
                padding: "1rem",
                border: "1px solid #808080",
                overflow: "auto",
                maxHeight: "400px",
                fontSize: "12px",
                fontFamily: "Courier New, monospace",
                whiteSpace: "pre-wrap",
                margin: 0,
              }}
            >
              {reportContent.report}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
