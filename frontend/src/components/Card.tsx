import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Card as CardType } from "../types";
import { TYPE_ICONS, PRIORITY_COLORS } from "../types";

interface Props {
  card: CardType;
  onClick: () => void;
  isOverlay?: boolean;
}

export default function Card({ card, onClick, isOverlay }: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const className = `card${isOverlay ? " card-drag-overlay" : ""}`;

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={style}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {card.flagged && <span className="card-flag">🚩</span>}
      <div className="card-header">
        <span className="card-type">{TYPE_ICONS[card.type]}</span>
        <span
          className="card-priority"
          style={{ background: PRIORITY_COLORS[card.priority] }}
        >
          {card.priority}
        </span>
      </div>
      <div className="card-title">{card.title}</div>
      {card.assignee && <div className="card-assignee">{card.assignee}</div>}
    </div>
  );
}
