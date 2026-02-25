import { useState, useEffect } from "react";
import { apiGet, apiPut, apiPost } from "../../utils/api";

interface CronSchedule {
  kind: string;
  expr: string;
  tz: string;
}

interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  lastRun?: {
    startedAt?: string;
    status?: string;
    durationMs?: number;
  };
  nextRunAt?: string;
}

function cronToHuman(expr: string, tz: string): string {
  if (!expr) return "Unknown";
  const parts = expr.split(" ");
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  const tzShort =
    tz?.includes("Detroit") || tz?.includes("New_York") ? "ET" : tz || "UTC";

  const h = parseInt(hour);
  const m = parseInt(min);
  const timeStr = `${h > 12 ? h - 12 : h || 12}:${m.toString().padStart(2, "0")} ${h >= 12 ? "PM" : "AM"} ${tzShort}`;

  if (dom === "*" && mon === "*") {
    if (dow === "*") return `Every day at ${timeStr}`;
    if (dow === "1-5") return `Weekdays at ${timeStr}`;
  }
  return `${expr} (${tzShort})`;
}

function formatTimeAgo(dateStr?: string): string {
  if (!dateStr) return "Never";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function SocialCronTab() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [editJob, setEditJob] = useState<CronJob | null>(null);
  const [editExpr, setEditExpr] = useState("");
  const [editTz, setEditTz] = useState("America/Detroit");
  const [editEnabled, setEditEnabled] = useState(true);
  const [runConfirm, setRunConfirm] = useState<string | null>(null);

  const loadJobs = () => {
    apiGet<CronJob[]>("/api/tommy/cron")
      .then(setJobs)
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadJobs();
  }, []);

  const openEdit = (job: CronJob) => {
    setEditJob(job);
    setEditExpr(job.schedule.expr);
    setEditTz(job.schedule.tz || "America/Detroit");
    setEditEnabled(job.enabled);
  };

  const saveEdit = async () => {
    if (!editJob) return;
    try {
      await apiPut(`/api/tommy/cron/${editJob.id}`, {
        schedule: { kind: "cron", expr: editExpr, tz: editTz },
        enabled: editEnabled,
      });
      setEditJob(null);
      loadJobs();
    } catch (err) {
      alert("Failed to save: " + err);
    }
  };

  const triggerRun = async (jobId: string) => {
    try {
      await apiPost(`/api/tommy/cron/${jobId}/run`, {});
      setRunConfirm(null);
      alert("Job triggered!");
    } catch (err) {
      alert("Failed to run: " + err);
    }
  };

  if (loading)
    return <div className="social-loading">Loading cron jobs...</div>;

  if (jobs.length === 0) {
    return <div className="social-empty">No Tommy cron jobs found.</div>;
  }

  return (
    <div>
      {jobs.map((job) => (
        <div key={job.id} className="cron-card">
          <div className="cron-card-header">
            <span className="cron-card-title">{job.name}</span>
            <span className={`cron-status ${job.enabled ? "on" : "off"}`}>
              {job.enabled ? "✅ ON" : "❌ OFF"}
            </span>
          </div>
          <div className="cron-detail">
            📅 Schedule: {cronToHuman(job.schedule?.expr, job.schedule?.tz)}
          </div>
          <div className="cron-detail">
            <span
              className={`status-dot ${job.lastRun?.status === "completed" || job.lastRun?.status === "ok" ? "green" : job.lastRun?.status ? "red" : "gray"}`}
            />
            Last Run: {formatTimeAgo(job.lastRun?.startedAt)}
            {job.lastRun?.status && ` — ${job.lastRun.status}`}
            {job.lastRun?.durationMs != null &&
              ` (${(job.lastRun.durationMs / 1000).toFixed(0)}s)`}
          </div>
          {job.nextRunAt && (
            <div className="cron-detail">
              ⏭ Next: {new Date(job.nextRunAt).toLocaleString()}
            </div>
          )}
          <div className="cron-actions">
            <button className="cron-btn" onClick={() => openEdit(job)}>
              Edit Schedule
            </button>
            <button
              className="cron-btn danger"
              onClick={() => setRunConfirm(job.id)}
            >
              Run Now
            </button>
          </div>
        </div>
      ))}

      {/* Edit Modal */}
      {editJob && (
        <div className="modal-overlay" onClick={() => setEditJob(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Edit: {editJob.name}</h3>
            <div className="modal-field">
              <label>Cron Expression</label>
              <input
                value={editExpr}
                onChange={(e) => setEditExpr(e.target.value)}
                placeholder="0 11 * * *"
              />
            </div>
            <div className="modal-field">
              <label>Timezone</label>
              <select
                value={editTz}
                onChange={(e) => setEditTz(e.target.value)}
              >
                <option value="America/Detroit">America/Detroit (ET)</option>
                <option value="America/Chicago">America/Chicago (CT)</option>
                <option value="America/Denver">America/Denver (MT)</option>
                <option value="America/Los_Angeles">
                  America/Los_Angeles (PT)
                </option>
                <option value="UTC">UTC</option>
              </select>
            </div>
            <div className="modal-field">
              <label
                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
              >
                Enabled
                <button
                  className={`config-toggle ${editEnabled ? "on" : ""}`}
                  onClick={() => setEditEnabled(!editEnabled)}
                />
              </label>
            </div>
            <div className="modal-actions">
              <button className="cron-btn" onClick={() => setEditJob(null)}>
                Cancel
              </button>
              <button className="config-save-btn" onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Run Confirmation */}
      {runConfirm && (
        <div className="modal-overlay" onClick={() => setRunConfirm(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Run Job Now?</h3>
            <p style={{ color: "#ccc" }}>
              This will trigger an immediate execution of the cron job.
            </p>
            <div className="modal-actions">
              <button className="cron-btn" onClick={() => setRunConfirm(null)}>
                Cancel
              </button>
              <button
                className="cron-btn danger"
                onClick={() => triggerRun(runConfirm)}
              >
                Run Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
