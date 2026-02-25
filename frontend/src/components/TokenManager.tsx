import { useState, useEffect, useCallback } from "react";
import type { TokenStatus } from "../types";
import { apiGet } from "../utils/api";
import { useNotification } from "./Notification";

export default function TokenManager() {
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const { notify } = useNotification();

  const loadTokenStatus = useCallback(async () => {
    try {
      setLoading(true);
      const status = await apiGet<TokenStatus>("/api/system/token-status");
      setTokenStatus(status);
    } catch (error) {
      console.error("Failed to load token status:", error);
      notify("error", "Failed to load token status");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadTokenStatus();
    // Auto-refresh status every 5 minutes
    const interval = setInterval(loadTokenStatus, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [loadTokenStatus]);

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "healthy":
        return "status-badge status-badge-healthy";
      case "warning":
        return "status-badge status-badge-warning";
      case "expired":
        return "status-badge status-badge-expired";
      default:
        return "status-badge";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "healthy":
        return "✅";
      case "warning":
        return "⚠️";
      case "expired":
        return "❌";
      default:
        return "❓";
    }
  };

  const formatExpiryTime = (expiresAt?: string) => {
    if (!expiresAt) return null;
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const timeDiff = expiryDate.getTime() - now.getTime();
    if (timeDiff <= 0) return "Expired";
    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 1) return `${days}d ${hours % 24}h remaining`;
    if (hours > 0) {
      const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
      return `${hours}h ${minutes}m remaining`;
    }
    return `${Math.floor(timeDiff / (1000 * 60))}m remaining`;
  };

  if (loading) {
    return (
      <div className="token-manager">
        <div className="token-status-card">
          <div className="loading">Loading token status...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="token-manager">
      <div className="token-status-card">
        <h3>
          <span className="icon">🔐</span>
          Claude Token Status
        </h3>

        {tokenStatus && (
          <div className="token-status">
            <div className="status-row">
              <span className="status-icon">
                {getStatusIcon(tokenStatus.status)}
              </span>
              <span className={getStatusBadgeClass(tokenStatus.status)}>
                {tokenStatus.status.charAt(0).toUpperCase() +
                  tokenStatus.status.slice(1)}
              </span>
            </div>

            <div className="status-message">{tokenStatus.message}</div>

            {tokenStatus.expiresAt && (
              <div className="expiry-info">
                Expires: {new Date(tokenStatus.expiresAt).toLocaleString()}
                <span className="time-remaining">
                  ({formatExpiryTime(tokenStatus.expiresAt)})
                </span>
              </div>
            )}

            <div className="auto-refresh-note">
              <span className="icon">🤖</span>
              Token is auto-refreshed by Nova every 6 hours
            </div>
          </div>
        )}

        <div className="token-actions">
          <button
            className="btn btn-secondary"
            onClick={loadTokenStatus}
            disabled={loading}
          >
            <span className="icon">🔍</span>
            Check Status
          </button>
        </div>
      </div>
    </div>
  );
}
