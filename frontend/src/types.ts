export interface Comment {
  author: string;
  text: string;
  created_at: string;
}

export interface Attachment {
  filename: string;
  size: number;
  contentType: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface Card {
  id: string;
  number: number;
  title: string;
  description: string;
  type: "feature" | "bugfix" | "task" | "refactor" | "infrastructure" | "cron";
  project?: "none" | "dashboard" | "neighborhood-share" | "daily-stock-pick";
  priority: "low" | "medium" | "high" | "critical";
  column: "backlog" | "in_progress" | "review" | "done";
  position: number;
  assignee: string;
  comments: Comment[];
  approved: boolean;
  flagged?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  attachments?: Attachment[];
  created_at: string;
  updated_at: string;
}

export const COLUMNS = ["backlog", "in_progress", "review", "done"] as const;

export const COLUMN_LABELS: Record<string, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
};

export const TYPE_ICONS: Record<string, string> = {
  bugfix: "\u{1F41B}",
  refactor: "\u{1F527}",
  feature: "\u2B50",
  task: "\u{1F4CB}",
  infrastructure: "\u{1F3D7}",
  cron: "\u23F0",
};

export const PRIORITY_COLORS: Record<string, string> = {
  critical: "#f85149",
  high: "#d29922",
  medium: "#e3b341",
  low: "#3fb950",
};

export interface Notification {
  id: number;
  type: "success" | "error" | "info";
  message: string;
}

export interface TokenStatus {
  status: "healthy" | "warning" | "expired";
  expiresAt?: string;
  message: string;
}

export interface MorningBrief {
  id: string;
  date: string; // YYYY-MM-DD format
  content: string; // Full markdown content
  headline: string; // First line summary
  created_at: string;
}

export interface BriefsResponse {
  briefs: MorningBrief[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface SearchBriefsResponse extends BriefsResponse {
  query: string;
}
