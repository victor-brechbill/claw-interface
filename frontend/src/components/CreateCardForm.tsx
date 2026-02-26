import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { apiPost } from "../utils/api";
import { useLocalStorageDraft } from "../hooks/useLocalStorageDraft";
import { useNotification } from "./Notification";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

interface CreateCardFormData {
  title: string;
  description: string;
  type: string;
  project: string;
  priority: string;
  assignee: string;
  column: string;
}

const initialFormData: CreateCardFormData = {
  title: "",
  description: "",
  type: "feature",
  project: "none",
  priority: "medium",
  assignee: "",
  column: "backlog",
};

export default function CreateCardForm({ onCreated, onCancel }: Props) {
  const [formData, setFormData, clearDraft, isDraftRestored] =
    useLocalStorageDraft<CreateCardFormData>(
      "kanban-draft-new",
      initialFormData,
    );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { notify } = useNotification();

  // Show restoration notification
  useEffect(() => {
    if (isDraftRestored) {
      notify("info", "Draft restored");
    }
  }, [isDraftRestored, notify]);

  // Helper function to update form data
  const updateFormData = (field: keyof CreateCardFormData, value: string) => {
    setFormData((prev: CreateCardFormData) => ({ ...prev, [field]: value }));
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!formData.title.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      await apiPost("/api/cards", formData);
      clearDraft(); // Clear draft on successful creation
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create card.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCancel() {
    clearDraft(); // Clear draft on cancel
    onCancel();
  }

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>New Card</h2>
          <button className="modal-close" onClick={handleCancel}>
            &times;
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={handleSubmit} className="form">
          <label>
            Title *
            <input
              value={formData.title}
              onChange={(e) => updateFormData("title", e.target.value)}
              required
            />
          </label>
          <label>
            Description
            <textarea
              value={formData.description}
              onChange={(e) => updateFormData("description", e.target.value)}
              rows={3}
            />
          </label>
          <div className="form-row">
            <label>
              Type
              <select
                value={formData.type}
                onChange={(e) => updateFormData("type", e.target.value)}
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
                onChange={(e) => updateFormData("priority", e.target.value)}
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
                onChange={(e) => updateFormData("project", e.target.value)}
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
                <option value="owner">Owner</option>
                <option value="agent">Agent</option>
              </select>
            </label>
            <label>
              Column
              <select
                value={formData.column}
                onChange={(e) => updateFormData("column", e.target.value)}
              >
                <option value="backlog">Backlog</option>
                <option value="in_progress">In Progress</option>
                <option value="review">Review</option>
                <option value="done">Done</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
            >
              {submitting ? "Creating..." : "Create Card"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
