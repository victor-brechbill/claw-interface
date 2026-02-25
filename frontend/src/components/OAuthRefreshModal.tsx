import { useState, useEffect, useCallback, useRef } from "react";
import { apiGet, apiPost } from "../utils/api";
import { useNotification } from "./Notification";

interface OAuthRefreshState {
  state: string;
  authUrl?: string;
  error?: string;
  message: string;
  startedAt?: string;
  updatedAt?: string;
  active: boolean;
}

interface OAuthRefreshModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const POLL_INTERVAL = 1000;

export default function OAuthRefreshModal({
  isOpen,
  onClose,
}: OAuthRefreshModalProps) {
  const [status, setStatus] = useState<OAuthRefreshState | null>(null);
  const [code, setCode] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<number | null>(null);
  const { notify } = useNotification();

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const data = await apiGet<OAuthRefreshState>(
        "/api/system/oauth-refresh/status",
      );
      setStatus(data);
      if (data.state === "done" || data.state === "error") {
        stopPolling();
        if (data.state === "done") {
          notify("success", "OAuth tokens refreshed successfully!");
        }
      }
    } catch (error) {
      console.error("Failed to poll OAuth refresh status:", error);
    }
  }, [stopPolling, notify]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollStatus();
    pollRef.current = window.setInterval(pollStatus, POLL_INTERVAL);
  }, [stopPolling, pollStatus]);

  useEffect(() => {
    if (isOpen) {
      pollStatus(); // Check for any existing state
    }
    return stopPolling;
  }, [isOpen, pollStatus, stopPolling]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await apiPost("/api/system/oauth-refresh/start", {});
      startPolling();
    } catch (error) {
      console.error("Failed to start OAuth refresh:", error);
      notify("error", "Failed to start OAuth refresh");
    } finally {
      setStarting(false);
    }
  };

  const handleSubmitCode = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setSubmittingCode(true);
    try {
      await apiPost("/api/system/oauth-refresh/code", { code: trimmed });
      setCode("");
    } catch (error) {
      console.error("Failed to submit OAuth code:", error);
      notify("error", "Failed to submit code");
    } finally {
      setSubmittingCode(false);
    }
  };

  const handleCopyUrl = async () => {
    if (status?.authUrl) {
      try {
        await navigator.clipboard.writeText(status.authUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // Fallback: select the link text
        notify("info", "Copy the URL manually");
      }
    }
  };

  const handleClose = () => {
    stopPolling();
    setStatus(null);
    setCode("");
    setCopied(false);
    onClose();
  };

  if (!isOpen) return null;

  const state = status?.state || "idle";
  const isWaitingStates = [
    "starting",
    "waiting_for_url",
    "code_submitted",
    "completing",
    "syncing",
  ].includes(state);

  // Determine step number for progress display
  const getStep = () => {
    if (state === "idle") return 0;
    if (["starting", "waiting_for_url"].includes(state)) return 1;
    if (["url_ready", "waiting_for_code"].includes(state)) return 2;
    if (["code_submitted", "completing", "syncing"].includes(state)) return 3;
    if (state === "done") return 4;
    return 0;
  };
  const step = getStep();

  return (
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
      onClick={handleClose}
    >
      <div
        style={{
          backgroundColor: "#000",
          color: "#c0c0c0",
          border: "2px solid #c0c0c0",
          padding: "1.5rem",
          width: "90%",
          maxWidth: "520px",
          maxHeight: "90%",
          overflow: "auto",
          fontFamily: "Courier New, monospace",
          fontSize: "14px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
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
          <h3 style={{ margin: 0, color: "#ffffff" }}>OAUTH TOKEN REFRESH</h3>
          <button
            onClick={handleClose}
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

        {/* Progress indicator */}
        {step > 0 && state !== "error" && (
          <div
            style={{
              marginBottom: "1rem",
              fontSize: "12px",
              color: "#808080",
            }}
          >
            Step {Math.min(step, 3)} of 3{step === 1 && " - Starting..."}
            {step === 2 && " - Authorize & paste code"}
            {step === 3 && " - Completing..."}
            {step === 4 && " - Done!"}
          </div>
        )}

        {/* IDLE state - show start button */}
        {state === "idle" && (
          <div>
            <p style={{ marginBottom: "1rem", lineHeight: "1.5" }}>
              This will start an interactive OAuth login flow. You will need to
              open an authorization link and paste a code back here.
            </p>
            <button
              onClick={handleStart}
              disabled={starting}
              style={{
                background: "#444",
                color: "#fff",
                border: "1px solid #666",
                padding: "0.75rem 1.5rem",
                fontFamily: "Courier New, monospace",
                fontSize: "14px",
                cursor: starting ? "wait" : "pointer",
                width: "100%",
                opacity: starting ? 0.6 : 1,
              }}
            >
              {starting ? "Starting..." : "Start OAuth Refresh"}
            </button>
          </div>
        )}

        {/* Waiting states - spinner */}
        {isWaitingStates && (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div style={{ fontSize: "24px", marginBottom: "0.5rem" }}>...</div>
            <div>{status?.message || "Working..."}</div>
          </div>
        )}

        {/* URL Ready - show link + code input */}
        {(state === "url_ready" || state === "waiting_for_code") && (
          <div>
            <div style={{ marginBottom: "1rem" }}>
              <div
                style={{
                  color: "#ffffff",
                  marginBottom: "0.5rem",
                  fontWeight: "bold",
                }}
              >
                1. Open this link to authorize:
              </div>
              <a
                href={status?.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: "#c9a0dc",
                  textDecoration: "underline",
                  wordBreak: "break-all",
                  fontSize: "13px",
                  display: "block",
                  padding: "0.75rem",
                  border: "1px solid #666",
                  marginBottom: "0.5rem",
                }}
              >
                Open Authorization Page
              </a>
              <button
                onClick={handleCopyUrl}
                style={{
                  background: "none",
                  border: "1px solid #808080",
                  color: "#c0c0c0",
                  padding: "0.4rem 0.8rem",
                  fontFamily: "Courier New, monospace",
                  fontSize: "12px",
                  cursor: "pointer",
                  marginBottom: "1rem",
                }}
              >
                {copied ? "Copied!" : "Copy URL"}
              </button>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <div
                style={{
                  color: "#ffffff",
                  marginBottom: "0.5rem",
                  fontWeight: "bold",
                }}
              >
                2. Paste the authorization code:
              </div>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Paste code here..."
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSubmitCode();
                }}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  backgroundColor: "#1a1a1a",
                  color: "#ffffff",
                  border: "1px solid #808080",
                  fontFamily: "Courier New, monospace",
                  fontSize: "14px",
                  marginBottom: "0.5rem",
                  boxSizing: "border-box",
                }}
              />
              <button
                onClick={handleSubmitCode}
                disabled={submittingCode || !code.trim()}
                style={{
                  background: "#444",
                  color: "#fff",
                  border: "1px solid #666",
                  padding: "0.75rem 1.5rem",
                  fontFamily: "Courier New, monospace",
                  fontSize: "14px",
                  cursor:
                    submittingCode || !code.trim() ? "not-allowed" : "pointer",
                  width: "100%",
                  opacity: submittingCode || !code.trim() ? 0.6 : 1,
                }}
              >
                {submittingCode ? "Submitting..." : "Submit Code"}
              </button>
            </div>
          </div>
        )}

        {/* Done */}
        {state === "done" && (
          <div style={{ textAlign: "center", padding: "1rem 0" }}>
            <div
              style={{
                fontSize: "24px",
                color: "#00ff00",
                marginBottom: "0.5rem",
              }}
            >
              OK
            </div>
            <div style={{ color: "#00ff00", marginBottom: "1rem" }}>
              {status?.message || "Tokens refreshed successfully!"}
            </div>
            <button
              onClick={handleClose}
              style={{
                background: "#444",
                color: "#fff",
                border: "1px solid #666",
                padding: "0.75rem 1.5rem",
                fontFamily: "Courier New, monospace",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              Close
            </button>
          </div>
        )}

        {/* Error */}
        {state === "error" && (
          <div style={{ padding: "0.5rem 0" }}>
            <div
              style={{
                color: "#ff0000",
                marginBottom: "1rem",
                fontWeight: "bold",
              }}
            >
              ERROR
            </div>
            <div
              style={{
                color: "#ff6666",
                marginBottom: "0.5rem",
                wordBreak: "break-word",
              }}
            >
              {status?.error || "Unknown error"}
            </div>
            {status?.message && (
              <div
                style={{
                  color: "#808080",
                  fontSize: "12px",
                  marginBottom: "1rem",
                }}
              >
                {status.message}
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={handleStart}
                style={{
                  background: "#444",
                  color: "#fff",
                  border: "1px solid #666",
                  padding: "0.75rem 1.5rem",
                  fontFamily: "Courier New, monospace",
                  fontSize: "14px",
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                Try Again
              </button>
              <button
                onClick={handleClose}
                style={{
                  background: "none",
                  border: "1px solid #808080",
                  color: "#c0c0c0",
                  padding: "0.75rem 1.5rem",
                  fontFamily: "Courier New, monospace",
                  fontSize: "14px",
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
