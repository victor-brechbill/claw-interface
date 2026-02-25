import { useState, useEffect } from "react";
import SocialFindsTab from "../components/social/SocialFindsTab";
import SocialPostsTab from "../components/social/SocialPostsTab";
import SocialCronTab from "../components/social/SocialCronTab";
import SocialConfigTab from "../components/social/SocialConfigTab";
import "./SocialPage.css";

const TABS = ["finds", "posts", "cron", "config"] as const;
type TabId = (typeof TABS)[number];

const TAB_LABELS: Record<TabId, string> = {
  finds: "Finds",
  posts: "Posts",
  cron: "Cron",
  config: "Config",
};

function getHashTab(): TabId {
  const hash = window.location.hash.replace("#", "") as TabId;
  return TABS.includes(hash) ? hash : "finds";
}

export default function SocialPage() {
  const [activeTab, setActiveTab] = useState<TabId>(getHashTab);

  useEffect(() => {
    const onHash = () => setActiveTab(getHashTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
  };

  useEffect(() => {
    window.location.hash = activeTab;
  }, [activeTab]);

  return (
    <div className="social-page">
      <div className="social-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`social-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => switchTab(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      <div className="social-content">
        {activeTab === "finds" && <SocialFindsTab />}
        {activeTab === "posts" && <SocialPostsTab />}
        {activeTab === "cron" && <SocialCronTab />}
        {activeTab === "config" && <SocialConfigTab />}
      </div>
    </div>
  );
}
