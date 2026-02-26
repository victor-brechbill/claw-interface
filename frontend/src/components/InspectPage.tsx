import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPut } from "../utils/api";
import { useNotification } from "./Notification";
import "./InspectPage.css";

interface FileContent {
  file: string;
  path: string;
  content: string;
  size: number;
}

interface TreeItemConfig {
  id: string;
  label: string;
  type: "file";
}

interface TreeSectionConfig {
  id: string;
  title: string;
  icon: string;
  items: TreeItemConfig[];
}

const TREE_SECTIONS: TreeSectionConfig[] = [
  {
    id: "workspace",
    title: "Agent",
    icon: ">",
    items: [
      { id: "agents", label: "AGENTS.md", type: "file" },
      { id: "soul", label: "SOUL.md", type: "file" },
      { id: "tools", label: "TOOLS.md", type: "file" },
      { id: "user", label: "USER.md", type: "file" },
      { id: "identity", label: "IDENTITY.md", type: "file" },
      { id: "heartbeat", label: "HEARTBEAT.md", type: "file" },
      { id: "memory", label: "MEMORY.md", type: "file" },
    ],
  },
  {
    id: "developer",
    title: "Developer",
    icon: "💻",
    items: [{ id: "dev-agents", label: "AGENTS.md", type: "file" }],
  },
  {
    id: "code-reviewer",
    title: "Code Reviewer",
    icon: "🔍",
    items: [{ id: "reviewer-agents", label: "AGENTS.md", type: "file" }],
  },
  {
    id: "tommy",
    title: "Tommy",
    icon: "🐕",
    items: [
      { id: "tommy-agents", label: "AGENTS.md", type: "file" },
      { id: "tommy-soul", label: "SOUL.md", type: "file" },
      { id: "tommy-tools", label: "TOOLS.md", type: "file" },
      { id: "tommy-identity", label: "IDENTITY.md", type: "file" },
      { id: "tommy-wins", label: "wins.md", type: "file" },
      { id: "tommy-voice-examples", label: "voice-examples.md", type: "file" },
      {
        id: "tommy-market-prompt",
        label: "Market Session Prompt",
        type: "file",
      },
      {
        id: "tommy-explore-prompt",
        label: "Explore Session Prompt",
        type: "file",
      },
      {
        id: "tommy-hottake-prompt",
        label: "Hot Take Session Prompt",
        type: "file",
      },
    ],
  },
  {
    id: "ns-testing",
    title: "NS Testers",
    icon: "🧪",
    items: [
      { id: "ns-testing-agents", label: "AGENTS.md", type: "file" },
      { id: "ns-testing-prompt", label: "Daily Testing Prompt", type: "file" },
    ],
  },
  {
    id: "project",
    title: "Project",
    icon: "📂",
    items: [
      { id: "architecture", label: "ARCHITECTURE.md", type: "file" },
      { id: "sessions", label: "SESSIONS.md", type: "file" },
    ],
  },
];

// Flatten all items for lookup
const ALL_ITEMS = TREE_SECTIONS.flatMap((s) => s.items);

export default function InspectPage() {
  const [searchParams] = useSearchParams();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [activeItem, setActiveItem] = useState<string>("");
  const [sidebarOpen, setSidebarOpen] = useState(false); // mobile overlay
  const [wrapText, setWrapText] = useState<boolean>(() => {
    return localStorage.getItem("inspectPageWrapText") === "true";
  });

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => {
      const saved = localStorage.getItem("inspectCollapsed");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    },
  );

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const { notify } = useNotification();

  const viewerRef = useRef<HTMLPreElement>(null);

  // Persist collapsed state
  useEffect(() => {
    localStorage.setItem(
      "inspectCollapsed",
      JSON.stringify([...collapsedSections]),
    );
  }, [collapsedSections]);

  const toggleWrapText = () => {
    setWrapText((prev) => {
      const newValue = !prev;
      localStorage.setItem("inspectPageWrapText", String(newValue));
      return newValue;
    });
  };

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const loadFile = useCallback(
    async (fileName: string) => {
      if (
        isDirty &&
        !window.confirm("You have unsaved changes. Discard them?")
      ) {
        return;
      }
      setIsEditing(false);
      setIsDirty(false);
      setEditContent("");
      setLoading(true);
      setError("");
      setActiveItem(fileName);
      try {
        const fileData = await apiGet<FileContent>(`/api/inspect/${fileName}`);
        setContent(fileData.content || "File is empty");
      } catch (err) {
        setError(
          `Failed to load ${fileName}: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
        setContent("");
      } finally {
        setLoading(false);
      }
    },
    [isDirty],
  );

  const enterEditMode = () => {
    if (loading || error || !content) return;
    setEditContent(content);
    setIsEditing(true);
    setIsDirty(false);
  };

  const cancelEdit = useCallback(() => {
    if (isDirty && !window.confirm("You have unsaved changes. Discard them?")) {
      return;
    }
    setIsEditing(false);
    setIsDirty(false);
    setEditContent("");
  }, [isDirty]);

  const saveFile = useCallback(async () => {
    if (!activeItem || saving) return;
    setSaving(true);
    try {
      await apiPut(`/api/inspect/${activeItem}`, { content: editContent });
      setContent(editContent);
      setIsEditing(false);
      setIsDirty(false);
      setEditContent("");
      notify("success", `Saved ${activeItem} successfully`);
    } catch (err) {
      notify(
        "error",
        `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setSaving(false);
    }
  }, [activeItem, saving, editContent, notify]);

  const handleItemClick = (item: TreeItemConfig) => {
    loadFile(item.id);
    setSidebarOpen(false); // close mobile overlay
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ctrl+S / Cmd+S to save when editing
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (isEditing) saveFile();
        return;
      }

      // Escape to cancel editing
      if (e.key === "Escape" && isEditing) {
        e.preventDefault();
        cancelEdit();
        return;
      }

      // Disable vim keys when editing (textarea handles its own input)
      if (isEditing) return;

      const viewer = viewerRef.current;
      if (!viewer) return;
      const scrollAmount = 40;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          viewer.scrollTop += scrollAmount;
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          viewer.scrollTop -= scrollAmount;
          break;
        case "g":
          e.preventDefault();
          viewer.scrollTop = 0;
          break;
        case "G":
        case "End":
          e.preventDefault();
          viewer.scrollTop = viewer.scrollHeight;
          break;
      }
    },
    [saveFile, cancelEdit, isEditing],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // URL param auto-load
  useEffect(() => {
    const fileParam = searchParams.get("file");
    if (fileParam) {
      const item = ALL_ITEMS.find(
        (i) => i.type === "file" && i.label === fileParam,
      );
      if (item) loadFile(item.id);
    }
  }, [searchParams, loadFile]);

  const addLineNumbers = (text: string): string => {
    const lines = text.split("\n");
    const pad = lines.length.toString().length;
    return lines
      .map((line, i) => `${(i + 1).toString().padStart(pad, " ")} │ ${line}`)
      .join("\n");
  };

  const displayContent = content ? addLineNumbers(content) : "";
  const activeLabel = ALL_ITEMS.find((i) => i.id === activeItem)?.label || "";
  const lineCount = content ? content.split("\n").length : 0;

  return (
    <div className="inspect-page">
      {/* Header */}
      <div className="inspect-header">
        <button
          className="sidebar-hamburger"
          onClick={() => setSidebarOpen((p) => !p)}
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <span className="inspect-title">Inspect</span>
      </div>

      <div className="inspect-body">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`inspect-sidebar ${sidebarOpen ? "open" : ""}`}>
          {TREE_SECTIONS.map((section) => (
            <div key={section.id} className="tree-section">
              <div
                className="tree-section-header"
                onClick={() => toggleSection(section.id)}
              >
                <span className="tree-chevron">
                  {collapsedSections.has(section.id) ? "▶" : "▼"}
                </span>
                <span className="tree-section-icon">{section.icon}</span>
                <span className="tree-section-title">{section.title}</span>
              </div>
              {!collapsedSections.has(section.id) && (
                <div className="tree-items">
                  {section.items.map((item) => (
                    <div
                      key={item.id}
                      className={`tree-item ${activeItem === item.id ? "active" : ""}`}
                      onClick={() => handleItemClick(item)}
                    >
                      <span className="tree-item-icon">{"📄"}</span>
                      <span className="tree-item-label">{item.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </aside>

        {/* Viewer */}
        <div className={`inspect-viewer${isEditing ? " editing" : ""}`}>
          {loading && <div className="vim-loading">Loading...</div>}
          {error && <div className="vim-error">Error: {error}</div>}
          {!loading &&
            !error &&
            (isEditing ? (
              <textarea
                className={`vim-editor ${wrapText ? "wrap-text" : ""}`}
                ref={editorRef}
                value={editContent}
                onChange={(e) => {
                  setEditContent(e.target.value);
                  setIsDirty(e.target.value !== content);
                }}
                spellCheck={false}
                autoFocus
              />
            ) : (
              <pre
                className={`vim-viewer ${wrapText ? "wrap-text" : ""}`}
                tabIndex={0}
                ref={viewerRef}
              >
                {displayContent ||
                  "Select a file or status view from the sidebar.\n\nKeyboard shortcuts:\nj or ↓ - Scroll down\nk or ↑ - Scroll up\ng - Go to top\nG - Go to bottom"}
              </pre>
            ))}
        </div>
      </div>

      {/* Status bar */}
      <div className={`vim-statusline${isEditing ? " editing" : ""}`}>
        <span className="statusline-left">
          {activeItem && !loading && !error && (
            <>
              {isEditing && isDirty && (
                <span className="dirty-indicator">[+] </span>
              )}
              {isEditing && <span className="mode-indicator">EDIT </span>}
              {activeLabel}
              {lineCount > 0 && ` — ${lineCount} lines`}
            </>
          )}
          {loading && "Loading..."}
          {error && <span className="error">Error</span>}
        </span>
        <span className="statusline-right">
          {isEditing ? (
            <>
              <button
                className="save-btn"
                onClick={saveFile}
                disabled={saving}
                title="Save (Ctrl+S)"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                className="cancel-btn"
                onClick={cancelEdit}
                disabled={saving}
                title="Cancel (Esc)"
              >
                Cancel
              </button>
            </>
          ) : (
            activeItem &&
            !loading &&
            !error &&
            content && (
              <button
                className="edit-btn"
                onClick={enterEditMode}
                title="Edit file"
              >
                Edit
              </button>
            )
          )}
          <button
            className={`wrap-toggle-btn ${wrapText ? "active" : ""}`}
            onClick={toggleWrapText}
            title={wrapText ? "Disable text wrapping" : "Enable text wrapping"}
          >
            {wrapText ? "↩ Wrap" : "→ Scroll"}
          </button>
        </span>
      </div>
    </div>
  );
}
