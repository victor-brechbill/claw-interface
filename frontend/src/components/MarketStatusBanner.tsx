import { useEffect, useState } from "react";

interface MarketStatus {
  state: string;
  isOpen: boolean;
  nextOpenTime?: string;
  nextCloseTime?: string;
  currentTimeET: string;
}

interface MarketStatusBannerProps {
  marketStatus: MarketStatus;
  lastUpdate: string;
  onRefresh: () => void;
  loading: boolean;
}

export default function MarketStatusBanner({
  marketStatus,
  lastUpdate,
  onRefresh,
  loading,
}: MarketStatusBannerProps) {
  const [countdown, setCountdown] = useState("");

  useEffect(() => {
    const updateCountdown = () => {
      const targetTime =
        marketStatus.nextOpenTime || marketStatus.nextCloseTime;
      if (!targetTime) {
        setCountdown("");
        return;
      }

      const now = new Date();
      const target = new Date(targetTime);
      const diff = target.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown("");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [marketStatus.nextOpenTime, marketStatus.nextCloseTime]);

  const getStatusBadge = () => {
    switch (marketStatus.state) {
      case "regular":
        return {
          emoji: "🟢",
          text: "Market Open",
          className: "market-status-open",
        };
      case "pre":
        return {
          emoji: "🟡",
          text: "Pre-Market",
          className: "market-status-pre",
        };
      case "post":
        return {
          emoji: "🟡",
          text: "After-Hours",
          className: "market-status-post",
        };
      default:
        return {
          emoji: "🔴",
          text: "Market Closed",
          className: "market-status-closed",
        };
    }
  };

  const getCountdownText = () => {
    if (!countdown) return "";

    if (marketStatus.state === "regular" && marketStatus.nextCloseTime) {
      return `Closes in ${countdown}`;
    } else if (marketStatus.nextOpenTime) {
      return `Opens in ${countdown}`;
    }
    return "";
  };

  const statusBadge = getStatusBadge();

  return (
    <div className="market-status-banner">
      <div className="market-status-left">
        <div className={`market-status-badge ${statusBadge.className}`}>
          <span className="market-status-emoji">{statusBadge.emoji}</span>
          <span className="market-status-text">{statusBadge.text}</span>
        </div>

        {countdown && (
          <div className="market-countdown">
            <span className="countdown-text">{getCountdownText()}</span>
          </div>
        )}

        <div className="market-time">
          <span className="current-time">{marketStatus.currentTimeET} ET</span>
        </div>
      </div>

      <div className="market-status-right">
        <div className="market-controls">
          {lastUpdate && (
            <span className="last-update">Updated: {lastUpdate}</span>
          )}
          <button
            className="refresh-button"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh stock prices"
          >
            {loading ? "🔄" : "↻"}
          </button>
        </div>
      </div>
    </div>
  );
}
