import { useState, useEffect, useRef } from "react";
import { apiGet, apiPut } from "../../utils/api";

interface TommyConfig {
  explore: {
    maxTimelinePosts: number;
    maxSearchResults: number;
    maxLikes: number;
    maxFollows: number;
    maxSearches: number;
  };
  market: {
    maxSearches: number;
    maxSearchResults: number;
    maxLikes: number;
    minScoreToLike: number;
    minScoreToDigest: number;
  };
  hotTake: {
    enabled: boolean;
    maxEngagements: number;
    minFollowersForQuoteRT: number;
    imageGenEnabled: boolean;
    imageModel: string;
    imageSize: string;
  };
  ai: {
    model: string;
    minScoreToLike: number;
    minScoreToFollow: number;
    minScoreToPost: number;
    minScoreToSave: number;
  };
  posting: {
    enabled: boolean;
    maxQuoteRTsPerDay: number;
    maxPickPostsPerDay: number;
    maxWords: number;
  };
  rateLimits: {
    apiDelayMs: number;
    engagementDelayMs: number;
    searchDelayMs: number;
  };
  budget: {
    monthlyXBudget: number;
  };
  ownerProfile: {
    username: string;
    maxLikesToScan: number;
    maxTweetsToScan: number;
  };
  maxLikesPerAuthor: number;
}

const DEFAULT_CONFIG: TommyConfig = {
  explore: {
    maxTimelinePosts: 25,
    maxSearchResults: 10,
    maxLikes: 3,
    maxFollows: 1,
    maxSearches: 1,
  },
  market: {
    maxSearches: 8,
    maxSearchResults: 15,
    maxLikes: 5,
    minScoreToLike: 7,
    minScoreToDigest: 7,
  },
  hotTake: {
    enabled: true,
    maxEngagements: 3,
    minFollowersForQuoteRT: 5000,
    imageGenEnabled: true,
    imageModel: "gpt-image-1",
    imageSize: "1024x1024",
  },
  ai: {
    model: "gpt-5-mini",
    minScoreToLike: 7,
    minScoreToFollow: 8,
    minScoreToPost: 8,
    minScoreToSave: 5,
  },
  posting: {
    enabled: true,
    maxQuoteRTsPerDay: 2,
    maxPickPostsPerDay: 1,
    maxWords: 20,
  },
  rateLimits: {
    apiDelayMs: 2000,
    engagementDelayMs: 5000,
    searchDelayMs: 3000,
  },
  budget: { monthlyXBudget: 10 },
  ownerProfile: {
    username: "your_handle",
    maxLikesToScan: 20,
    maxTweetsToScan: 10,
  },
  maxLikesPerAuthor: 2,
};

export default function SocialConfigTab() {
  const [config, setConfig] = useState<TommyConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const originalRef = useRef<string>("");

  useEffect(() => {
    apiGet<TommyConfig & { _id?: string }>("/api/tommy/config")
      .then((data) => {
        const c = { ...DEFAULT_CONFIG };
        if (data.explore) c.explore = { ...c.explore, ...data.explore };
        if (data.market) c.market = { ...c.market, ...data.market };
        if (data.hotTake) c.hotTake = { ...c.hotTake, ...data.hotTake };
        if (data.ai) c.ai = { ...c.ai, ...data.ai };
        if (data.posting) c.posting = { ...c.posting, ...data.posting };
        if (data.rateLimits)
          c.rateLimits = { ...c.rateLimits, ...data.rateLimits };
        if (data.budget) c.budget = { ...c.budget, ...data.budget };
        if (data.ownerProfile)
          c.ownerProfile = { ...c.ownerProfile, ...data.ownerProfile };
        if (data.maxLikesPerAuthor != null)
          c.maxLikesPerAuthor = data.maxLikesPerAuthor;
        setConfig(c);
        originalRef.current = JSON.stringify(c);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof TommyConfig>(
    section: K,
    field: string,
    value: unknown,
  ) => {
    setConfig((prev) => {
      const next = { ...prev };
      if (typeof next[section] === "object" && next[section] !== null) {
        (next[section] as Record<string, unknown>) = {
          ...(next[section] as Record<string, unknown>),
          [field]: value,
        };
      }
      return next;
    });
    setDirty(true);
    setSaved(false);
  };

  const updateTop = (field: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiPut("/api/tommy/config", config);
      setSaved(true);
      setDirty(false);
      originalRef.current = JSON.stringify(config);
    } catch (err) {
      alert("Failed to save config: " + err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="social-loading">Loading config...</div>;

  const numField = (
    section: keyof TommyConfig,
    field: string,
    label: string,
    min = 0,
    max = 100,
  ) => (
    <div className="config-row" key={`${String(section)}-${field}`}>
      <span className="config-label">{label}</span>
      <input
        className="config-input"
        type="number"
        min={min}
        max={max}
        value={(config[section] as Record<string, unknown>)[field] as number}
        onChange={(e) => update(section, field, Number(e.target.value))}
      />
    </div>
  );

  return (
    <div>
      <div className="config-section">
        <div className="config-section-title">Explore Session</div>
        {numField("explore", "maxTimelinePosts", "Timeline Posts", 1, 100)}
        {numField("explore", "maxSearchResults", "Search Results", 1, 50)}
        {numField("explore", "maxLikes", "Max Likes", 0, 20)}
        {numField("explore", "maxFollows", "Max Follows", 0, 10)}
        {numField("explore", "maxSearches", "Max Searches", 0, 10)}
      </div>

      <div className="config-section">
        <div className="config-section-title">Market Session</div>
        {numField("market", "maxSearches", "Max Searches", 1, 20)}
        {numField("market", "maxSearchResults", "Search Results", 1, 50)}
        {numField("market", "maxLikes", "Max Likes", 0, 20)}
        {numField("market", "minScoreToLike", "Min Score to Like", 1, 10)}
        {numField("market", "minScoreToDigest", "Min Score to Digest", 1, 10)}
      </div>

      <div className="config-section">
        <div className="config-section-title">Hot Take Session</div>
        <div className="config-row">
          <span className="config-label">Enabled</span>
          <button
            className={`config-toggle ${config.hotTake.enabled ? "on" : ""}`}
            onClick={() =>
              update("hotTake", "enabled", !config.hotTake.enabled)
            }
          />
        </div>
        {numField("hotTake", "maxEngagements", "Max Engagements", 1, 10)}
        {numField(
          "hotTake",
          "minFollowersForQuoteRT",
          "Min Followers for QRT",
          100,
          100000,
        )}
        <div className="config-row">
          <span className="config-label">Image Gen Enabled</span>
          <button
            className={`config-toggle ${config.hotTake.imageGenEnabled ? "on" : ""}`}
            onClick={() =>
              update(
                "hotTake",
                "imageGenEnabled",
                !config.hotTake.imageGenEnabled,
              )
            }
          />
        </div>
        <div className="config-row">
          <span className="config-label">Image Model</span>
          <input
            className="config-input"
            style={{ width: 160 }}
            value={config.hotTake.imageModel}
            onChange={(e) => update("hotTake", "imageModel", e.target.value)}
          />
        </div>
        <div className="config-row">
          <span className="config-label">Image Size</span>
          <input
            className="config-input"
            style={{ width: 120 }}
            value={config.hotTake.imageSize}
            onChange={(e) => update("hotTake", "imageSize", e.target.value)}
          />
        </div>
      </div>

      <div className="config-section">
        <div className="config-section-title">AI Scoring</div>
        {numField("ai", "minScoreToLike", "Min Score to Like", 1, 10)}
        {numField("ai", "minScoreToFollow", "Min Score to Follow", 1, 10)}
        {numField("ai", "minScoreToPost", "Min Score to Post", 1, 10)}
        {numField("ai", "minScoreToSave", "Min Score to Save", 1, 10)}
      </div>

      <div className="config-section">
        <div className="config-section-title">Posting</div>
        <div className="config-row">
          <span className="config-label">Posting Enabled</span>
          <button
            className={`config-toggle ${config.posting.enabled ? "on" : ""}`}
            onClick={() =>
              update("posting", "enabled", !config.posting.enabled)
            }
          />
        </div>
        {numField("posting", "maxQuoteRTsPerDay", "Max Quote-RTs/Day", 0, 10)}
        {numField("posting", "maxPickPostsPerDay", "Max Pick Posts/Day", 0, 5)}
        {numField("posting", "maxWords", "Max Words/Post", 5, 50)}
      </div>

      <div className="config-section">
        <div className="config-section-title">Rate Limits</div>
        {numField("rateLimits", "apiDelayMs", "API Delay (ms)", 500, 10000)}
        {numField(
          "rateLimits",
          "engagementDelayMs",
          "Engagement Delay (ms)",
          1000,
          20000,
        )}
        {numField(
          "rateLimits",
          "searchDelayMs",
          "Search Delay (ms)",
          500,
          10000,
        )}
      </div>

      <div className="config-section">
        <div className="config-section-title">Budget</div>
        <div className="config-row">
          <span className="config-label">Monthly X Budget ($)</span>
          <input
            className="config-input"
            type="number"
            min={0}
            step={0.5}
            value={config.budget.monthlyXBudget}
            onChange={(e) =>
              update("budget", "monthlyXBudget", Number(e.target.value))
            }
          />
        </div>
      </div>

      <div className="config-section">
        <div className="config-section-title">Owner Profile</div>
        <div className="config-row">
          <span className="config-label">Username</span>
          <input
            className="config-input"
            style={{ width: 160 }}
            value={config.ownerProfile.username}
            onChange={(e) =>
              update("ownerProfile", "username", e.target.value)
            }
          />
        </div>
        {numField("ownerProfile", "maxLikesToScan", "Likes to Scan", 1, 100)}
        {numField("ownerProfile", "maxTweetsToScan", "Tweets to Scan", 1, 100)}
      </div>

      <div className="config-section">
        <div className="config-section-title">Misc</div>
        <div className="config-row">
          <span className="config-label">Max Likes/Author</span>
          <input
            className="config-input"
            type="number"
            min={1}
            max={10}
            value={config.maxLikesPerAuthor}
            onChange={(e) =>
              updateTop("maxLikesPerAuthor", Number(e.target.value))
            }
          />
        </div>
      </div>

      <div className="config-save-row">
        {dirty && <span className="config-dirty">Unsaved changes</span>}
        {saved && <span className="config-saved">✓ Saved</span>}
        <button
          className="config-save-btn"
          onClick={save}
          disabled={saving || !dirty}
        >
          {saving ? "Saving..." : "Save Config"}
        </button>
      </div>
    </div>
  );
}
