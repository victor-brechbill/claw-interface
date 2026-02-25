import type { MorningBrief } from "../types";

interface BriefCardProps {
  brief: MorningBrief;
  onClick: () => void;
}

export default function BriefCard({ brief, onClick }: BriefCardProps) {
  // Create preview text from content (first 150 characters)
  const preview =
    brief.content.length > 150
      ? brief.content.substring(0, 150) + "..."
      : brief.content;

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

  return (
    <div className="brief-card" onClick={onClick}>
      <div className="brief-card-header">
        <h3 className="brief-headline">{brief.headline}</h3>
        <div className="brief-date">{formatDate(brief.date)}</div>
      </div>
      <p className="brief-preview">{preview}</p>
      <div className="brief-card-footer">
        <span className="brief-read-more">Read more →</span>
      </div>
    </div>
  );
}
