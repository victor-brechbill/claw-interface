import { useState, useEffect, useCallback } from "react";
import { apiGet } from "../utils/api";

interface TommyFind {
  id: string;
  postId: string;
  postUrl: string;
  postText: string;
  authorHandle: string;
  authorName: string;
  authorVerified: boolean;
  hasMedia: boolean;
  mediaType: string;
  matchedInterests: string[];
  matchedTickers: string[];
  relevanceNote: string;
  foundAt: string;
  foundIn: string;
  liked: boolean;
  followed: boolean;
}

interface FindsResponse {
  finds: TommyFind[];
  total: number;
}

export default function TommyFinds() {
  const [finds, setFinds] = useState<TommyFind[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(3);

  const loadFinds = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<FindsResponse>(`/api/tommy/finds?days=${days}`);
      setFinds(data.finds || []);
    } catch (error) {
      console.error("Failed to load finds:", error);
      setFinds([]);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    loadFinds();
  }, [loadFinds]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 24) {
      return `${diffHours}h`;
    } else if (diffDays < 7) {
      return `${diffDays}d`;
    }
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  if (loading) {
    return (
      <div className="tommy-finds">
        <div className="loading">Loading social finds...</div>
        <style>{styles}</style>
      </div>
    );
  }

  return (
    <div className="tommy-finds">
      <header className="tommy-header">
        <div className="tommy-title">
          <div>
            <h2>Social Finds</h2>
            <p className="tommy-subtitle">Curated posts from X</p>
          </div>
        </div>
        <div className="tommy-controls">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="days-select"
          >
            <option value={1}>Today</option>
            <option value={3}>Last 3 days</option>
            <option value={7}>Last week</option>
          </select>
        </div>
      </header>

      {finds.length === 0 ? (
        <div className="tommy-empty">
          <p>No posts found yet. Check back later for curated X finds.</p>
        </div>
      ) : (
        <div className="tweet-feed">
          {finds.map((find) => (
            <a
              key={find.id}
              href={find.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="tweet-card"
            >
              <div className="tweet-header">
                <div className="tweet-avatar">𝕏</div>
                <div className="tweet-meta">
                  <span className="tweet-username">@{find.authorHandle}</span>
                  <span className="tweet-date">{formatDate(find.foundAt)}</span>
                </div>
                {find.liked && (
                  <span className="liked-badge" title="Tommy liked this">
                    ❤️
                  </span>
                )}
              </div>
              <div className="tweet-text">{find.postText}</div>
              {find.hasMedia && (
                <div className="media-indicator">
                  {find.mediaType === "video" ? "🎥" : "📷"} Has{" "}
                  {find.mediaType}
                </div>
              )}
              <div className="tweet-why">
                <span className="why-icon">💡</span>
                {find.relevanceNote}
              </div>
              {(find.matchedTickers.length > 0 ||
                find.matchedInterests.length > 0) && (
                <div className="tweet-tags">
                  {find.matchedTickers.map((ticker) => (
                    <span key={ticker} className="tag ticker">
                      ${ticker}
                    </span>
                  ))}
                  {find.matchedInterests.map((interest) => (
                    <span key={interest} className="tag interest">
                      {interest}
                    </span>
                  ))}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
      <style>{styles}</style>
    </div>
  );
}

const styles = `
  .tommy-finds {
    padding: 1rem;
    max-width: 600px;
    margin: 0 auto;
  }

  .tommy-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #333;
  }

  .tommy-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .tommy-avatar {
    font-size: 2rem;
  }

  .tommy-title h2 {
    margin: 0;
    font-size: 1.25rem;
    color: #fff;
  }

  .tommy-subtitle {
    margin: 0;
    font-size: 0.85rem;
    color: #888;
  }

  .days-select {
    background: #1a1a1a;
    color: #fff;
    border: 1px solid #333;
    padding: 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    cursor: pointer;
  }

  .days-select:hover {
    border-color: #555;
  }

  .tommy-empty {
    text-align: center;
    color: #666;
    padding: 3rem 1rem;
  }

  .loading {
    text-align: center;
    color: #888;
    padding: 3rem 1rem;
  }

  .tweet-feed {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .tweet-card {
    display: block;
    background: #0d0d0d;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 1rem;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.2s, background 0.2s;
  }

  .tweet-card:hover {
    border-color: #1d9bf0;
    background: #0f0f0f;
  }

  .tweet-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .tweet-avatar {
    width: 40px;
    height: 40px;
    background: #000;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.25rem;
    color: #fff;
  }

  .tweet-meta {
    display: flex;
    flex-direction: column;
    flex: 1;
  }

  .tweet-username {
    color: #1d9bf0;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .tweet-date {
    color: #666;
    font-size: 0.8rem;
  }

  .liked-badge {
    font-size: 0.9rem;
  }

  .tweet-text {
    color: #e0e0e0;
    font-size: 0.95rem;
    line-height: 1.5;
    margin-bottom: 0.75rem;
    white-space: pre-wrap;
  }

  .media-indicator {
    color: #666;
    font-size: 0.8rem;
    margin-bottom: 0.5rem;
  }

  .tweet-why {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid #222;
    color: #888;
    font-size: 0.85rem;
    font-style: italic;
  }

  .why-icon {
    flex-shrink: 0;
  }

  .tweet-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .tag {
    font-size: 0.75rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    background: #1a1a1a;
  }

  .tag.ticker {
    color: #22c55e;
    border: 1px solid #22c55e40;
  }

  .tag.interest {
    color: #c9a0dc;
    border: 1px solid #c9a0dc40;
  }

  @media (max-width: 480px) {
    .tommy-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 1rem;
    }

    .tommy-controls {
      width: 100%;
    }

    .days-select {
      width: 100%;
    }
  }
`;
