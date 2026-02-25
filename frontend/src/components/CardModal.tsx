import { useState, useEffect } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Card } from "../types";
import { useLocalStorageDraft } from "../hooks/useLocalStorageDraft";
import { useNotification } from "./Notification";

// Convert URLs in text to clickable links
function linkifyText(text: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (urlRegex.test(part)) {
      // Reset regex state
      urlRegex.lastIndex = 0;
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer">
          {part}
        </a>
      );
    }
    return part;
  });
}
import { COLUMN_LABELS, COLUMNS, TYPE_ICONS, PRIORITY_COLORS } from "../types";
import { apiPut, apiDelete, apiPost } from "../utils/api";

interface Props {
  card: Card;
  onClose: () => void;
  onUpdated: () => void;
}

interface CardEditFormData {
  title: string;
  description: string;
  type: Card["type"];
  project: string;
  priority: Card["priority"];
  assignee: string;
  column: Card["column"];
  approved: boolean;
  approvedBy: string;
  approvedAt: string;
}

export default function CardModal({ card, onClose, onUpdated }: Props) {
  const { notify } = useNotification();

  // Create initial form data from card
  const initialFormData: CardEditFormData = {
    title: card.title,
    description: card.description,
    type: card.type,
    project: card.project || "none",
    priority: card.priority,
    assignee: card.assignee,
    column: card.column,
    approved: card.approved || false,
    approvedBy: card.approvedBy || "",
    approvedAt: card.approvedAt || "",
  };

  const [formData, setFormData, clearDraft, isDraftRestored] =
    useLocalStorageDraft<CardEditFormData>(
      `kanban-draft-edit-${card.id}`,
      initialFormData,
    );
  const [commentText, setCommentText] = useState("");
  const [saving, setSaving] = useState(false);
  const [comments, setComments] = useState(card.comments || []);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState(card.attachments || []);
  const [uploading, setUploading] = useState(false);

  // Show restoration notification
  useEffect(() => {
    if (isDraftRestored) {
      notify("info", "Draft restored");
    }
  }, [isDraftRestored, notify]);

  // Helper function to update form data
  const updateFormData = <K extends keyof CardEditFormData>(
    field: K,
    value: CardEditFormData[K],
  ) => {
    setFormData((prev: CardEditFormData) => ({ ...prev, [field]: value }));
  };

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const updateData: Record<string, unknown> = {
        title: formData.title,
        description: formData.description,
        type: formData.type,
        project: formData.project,
        priority: formData.priority,
        assignee: formData.assignee,
        column: formData.column,
        approved: formData.approved,
      };

      // Only include approval fields when approved (avoid empty strings for time fields)
      if (formData.approved) {
        updateData.approvedBy = formData.approvedBy || "Victor";
        updateData.approvedAt = formData.approvedAt || new Date().toISOString();
      }

      await apiPut(`/api/cards/${card.id}`, updateData);
      clearDraft(); // Clear draft on successful save
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprovalToggle() {
    const newApproved = !formData.approved;
    const newApprovedBy = newApproved ? "Victor" : "";
    const newApprovedAt = newApproved ? new Date().toISOString() : "";

    // Update local state
    updateFormData("approved", newApproved);
    updateFormData("approvedBy", newApprovedBy);
    updateFormData("approvedAt", newApprovedAt);

    try {
      // Only include approval fields if approving (avoid empty string for time fields)
      const updateData: Record<string, unknown> = {
        title: formData.title,
        description: formData.description,
        type: formData.type,
        project: formData.project,
        priority: formData.priority,
        assignee: formData.assignee,
        column: formData.column,
        approved: newApproved,
      };

      if (newApproved) {
        updateData.approvedBy = newApprovedBy;
        updateData.approvedAt = newApprovedAt;
      }

      await apiPut(`/api/cards/${card.id}`, updateData);
      // Don't call onUpdated() - we don't want to close the modal
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update approval.",
      );
      // Revert on error
      updateFormData("approved", !newApproved);
      updateFormData("approvedBy", card.approvedBy || "");
      updateFormData("approvedAt", card.approvedAt || "");
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this card?")) return;
    setError("");
    try {
      await apiDelete(`/api/cards/${card.id}`);
      clearDraft(); // Clear draft on delete
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete card.");
    }
  }

  function handleClose() {
    clearDraft(); // Clear draft on close
    onClose();
  }

  async function handleAddComment(e: FormEvent) {
    e.preventDefault();
    if (!commentText.trim()) return;
    setError("");
    try {
      const updated = await apiPost<Card>(`/api/cards/${card.id}/comments`, {
        author: "Victor", // Auto-set - only Victor uses the web UI
        text: commentText,
      });
      setComments(updated.comments || []);
      setCommentText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add comment.");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be less than 10MB.");
      return;
    }

    // Check total size (50MB limit per card)
    const totalSize = attachments.reduce((sum, att) => sum + att.size, 0);
    if (totalSize + file.size > 50 * 1024 * 1024) {
      setError("Total attachments per card cannot exceed 50MB.");
      return;
    }

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`/api/cards/${card.id}/attachments`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const updatedCard = await response.json();
      setAttachments(updatedCard.attachments || []);

      // Clear the file input
      e.target.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file.");
    } finally {
      setUploading(false);
    }
  }

  async function handleFileDelete(filename: string) {
    setError("");
    try {
      const response = await fetch(
        `/api/cards/${card.id}/attachments/${encodeURIComponent(filename)}`,
        {
          method: "DELETE",
        },
      );

      if (!response.ok) {
        throw new Error("Delete failed");
      }

      const updatedCard = await response.json();
      setAttachments(updatedCard.attachments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete file.");
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {TYPE_ICONS[card.type]} #{card.number} - {card.title}
          </h2>
          <button className="modal-close" onClick={handleClose}>
            &times;
          </button>
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="form">
          <label>
            Title
            <input
              value={formData.title}
              onChange={(e) => updateFormData("title", e.target.value)}
            />
          </label>
          <label>
            Description
            <textarea
              value={formData.description}
              onChange={(e) => updateFormData("description", e.target.value)}
              rows={4}
            />
          </label>

          <div className="approval-section">
            <label className="approval-checkbox">
              <input
                type="checkbox"
                checked={formData.approved}
                onChange={handleApprovalToggle}
              />
              <span>
                {formData.approved && formData.approvedBy ? (
                  <>
                    ✓ Approved by {formData.approvedBy} —{" "}
                    {formData.approvedAt
                      ? new Date(formData.approvedAt).toLocaleString()
                      : ""}
                  </>
                ) : (
                  "Approve"
                )}
              </span>
            </label>
          </div>
          <div className="form-row">
            <label>
              Type
              <select
                value={formData.type}
                onChange={(e) =>
                  updateFormData("type", e.target.value as Card["type"])
                }
              >
                <option value="feature">Feature</option>
                <option value="bugfix">Bugfix</option>
                <option value="task">Task</option>
                <option value="refactor">Refactor</option>
                <option value="infrastructure">Infrastructure</option>
                <option value="cron">Cron</option>
              </select>
            </label>
            <label>
              Priority
              <select
                value={formData.priority}
                onChange={(e) =>
                  updateFormData("priority", e.target.value as Card["priority"])
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Project
              <select
                value={formData.project}
                onChange={(e) =>
                  updateFormData("project", e.target.value || "none")
                }
              >
                <option value="none">None</option>
                <option value="dashboard">Dashboard</option>
                <option value="neighborhood-share">Neighborhood Share</option>
                <option value="daily-stock-pick">Daily Stock Pick</option>
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Assignee
              <select
                value={formData.assignee}
                onChange={(e) => updateFormData("assignee", e.target.value)}
              >
                <option value="">Unassigned</option>
                <option value="victor">Victor</option>
                <option value="nova">Nova</option>
              </select>
            </label>
            <label>
              Move to
              <select
                value={formData.column}
                onChange={(e) =>
                  updateFormData("column", e.target.value as Card["column"])
                }
              >
                {COLUMNS.map((col) => (
                  <option key={col} value={col}>
                    {COLUMN_LABELS[col]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-actions">
            <button className="btn btn-danger" onClick={handleDelete}>
              Delete
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>

        <div className="attachments-section">
          <h3>Attachments ({attachments.length})</h3>
          <div className="attachment-upload">
            <label
              className="btn btn-secondary"
              style={{ cursor: uploading ? "wait" : "pointer" }}
            >
              {uploading ? "Uploading..." : "📎 Upload File"}
              <input
                type="file"
                onChange={handleFileUpload}
                disabled={uploading}
                style={{ display: "none" }}
              />
            </label>
          </div>

          {attachments.length === 0 && (
            <p className="text-muted">No attachments yet.</p>
          )}

          {attachments.map((attachment, i) => (
            <div key={i} className="attachment-item">
              <div className="attachment-info">
                <span className="attachment-icon">📎</span>
                <a
                  href={`/api/cards/${card.id}/attachments/${encodeURIComponent(attachment.filename)}`}
                  download={attachment.filename}
                  className="attachment-name"
                >
                  {attachment.filename}
                </a>
                <span className="attachment-meta text-muted">
                  {formatFileSize(attachment.size)} •{" "}
                  {new Date(attachment.uploadedAt).toLocaleDateString()}
                </span>
              </div>
              <button
                className="btn btn-danger attachment-delete"
                onClick={() => handleFileDelete(attachment.filename)}
                title="Delete attachment"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="comments-section">
          <h3>Comments ({comments.length})</h3>
          {comments.length === 0 && (
            <p className="text-muted">No comments yet.</p>
          )}
          {comments.map((c, i) => (
            <div key={i} className="comment">
              <div className="comment-meta">
                <strong>{c.author}</strong>
                <span className="text-muted">
                  {new Date(c.created_at).toLocaleDateString()}
                </span>
              </div>
              <div className="comment-text">{linkifyText(c.text)}</div>
            </div>
          ))}
          <form onSubmit={handleAddComment} className="comment-form">
            <textarea
              placeholder="Write a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={3}
              className="comment-input"
            />
            <div className="comment-submit">
              <button type="submit" className="btn btn-primary">
                Submit
              </button>
            </div>
          </form>
        </div>

        <div className="modal-meta text-muted">
          <span>Created: {new Date(card.created_at).toLocaleDateString()}</span>
          <span style={{ marginLeft: "1rem" }}>
            Priority:{" "}
            <span style={{ color: PRIORITY_COLORS[card.priority] }}>
              {card.priority}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
