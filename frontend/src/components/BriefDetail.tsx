import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import type { MorningBrief } from "../types";
import { apiGet } from "../utils/api";

interface BriefDetailProps {
  briefId?: string;
  date?: string;
  onClose: () => void;
}

export default function BriefDetail({
  briefId,
  date,
  onClose,
}: BriefDetailProps) {
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBrief = async () => {
      setLoading(true);
      setError(null);

      try {
        let url: string;
        if (date) {
          url = `/api/briefs/${date}`;
        } else if (briefId) {
          // This would need a separate endpoint for fetching by ID
          // For now, we'll primarily use the date-based lookup
          url = `/api/briefs/${briefId}`;
        } else {
          throw new Error("Either briefId or date is required");
        }

        const briefData = await apiGet<MorningBrief>(url);
        setBrief(briefData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch brief");
      } finally {
        setLoading(false);
      }
    };

    fetchBrief();
  }, [briefId, date]);

  // Format date for display — parse manually to avoid UTC/local timezone shift
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day); // local midnight, no UTC shift
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="brief-detail-overlay">
        <div className="brief-detail">
          <div className="brief-detail-header">
            <button className="close-button" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="loading">Loading brief...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="brief-detail-overlay">
        <div className="brief-detail">
          <div className="brief-detail-header">
            <button className="close-button" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="error">Error: {error}</div>
        </div>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="brief-detail-overlay">
        <div className="brief-detail">
          <div className="brief-detail-header">
            <button className="close-button" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="error">Brief not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="brief-detail-overlay" onClick={onClose}>
      <div className="brief-detail" onClick={(e) => e.stopPropagation()}>
        <div className="brief-detail-header">
          <div className="brief-detail-title">
            <h2>{brief.headline}</h2>
            <p className="brief-detail-date">{formatDate(brief.date)}</p>
          </div>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="brief-detail-content">
          <ReactMarkdown>{brief.content}</ReactMarkdown>
        </div>

        <div className="brief-detail-footer">
          <span className="brief-date-badge">{brief.date}</span>
        </div>
      </div>
    </div>
  );
}
