import { useState, useEffect } from "react";
import { apiGet } from "../../utils/api";

interface TommyPost {
  id: string;
  postId: string;
  postUrl: string;
  text: string;
  type: string;
  quotedPostUrl?: string;
  quotedAuthor?: string;
  ticker?: string;
  engagementSnapshot?: {
    likes?: number;
    retweets?: number;
    replies?: number;
    views?: number;
  };
  postedAt: string;
}

interface PostsResponse {
  posts: TommyPost[];
  total: number;
}

function formatTimeAgo(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function SocialPostsTab() {
  const [posts, setPosts] = useState<TommyPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<PostsResponse>("/api/tommy/posts?limit=50")
      .then((data) => setPosts(data.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="social-loading">Loading posts...</div>;

  if (posts.length === 0) {
    return (
      <div className="social-empty">
        <p>🐦 Tommy hasn't posted yet. Check back after his next session.</p>
      </div>
    );
  }

  return (
    <div>
      {posts.map((post) => (
        <a
          key={post.id}
          href={post.postUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="post-card"
          style={{ display: "block", textDecoration: "none", color: "inherit" }}
        >
          <span className={`post-type-badge ${post.type}`}>
            {post.type === "quote_rt"
              ? "Quote-RT"
              : post.type === "dsp_pick"
                ? "DSP Pick"
                : post.type}
          </span>
          {post.ticker && (
            <span
              style={{
                marginLeft: "0.5rem",
                color: "#22c55e",
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              ${post.ticker}
            </span>
          )}
          <div className="post-text">{post.text}</div>
          {post.quotedAuthor && (
            <div
              style={{
                color: "#666",
                fontSize: "0.8rem",
                marginBottom: "0.5rem",
              }}
            >
              ↩ Quoting {post.quotedAuthor}
            </div>
          )}
          {post.engagementSnapshot && (
            <div className="post-engagement">
              {post.engagementSnapshot.views != null && (
                <span>👁 {post.engagementSnapshot.views}</span>
              )}
              {post.engagementSnapshot.likes != null && (
                <span>❤️ {post.engagementSnapshot.likes}</span>
              )}
              {post.engagementSnapshot.retweets != null && (
                <span>🔁 {post.engagementSnapshot.retweets}</span>
              )}
              {post.engagementSnapshot.replies != null && (
                <span>💬 {post.engagementSnapshot.replies}</span>
              )}
            </div>
          )}
          <div className="post-date">{formatTimeAgo(post.postedAt)}</div>
        </a>
      ))}
    </div>
  );
}
