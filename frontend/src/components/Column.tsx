import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Card as CardType } from "../types";
import Card from "./Card";

interface Props {
  id: string;
  title: string;
  cards: CardType[];
  onCardClick: (card: CardType) => void;
  onClearAll?: () => void;
}

export default function Column({
  id,
  title,
  cards,
  onCardClick,
  onClearAll,
}: Props) {
  const { setNodeRef } = useDroppable({ id });

  return (
    <div className="column" data-column={id}>
      <div className="column-header">
        <span className="column-title">{title}</span>
        <span className="column-count">{cards.length}</span>
        {onClearAll && cards.length > 0 && (
          <button
            className="clear-done-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (
                window.confirm(`Delete all ${cards.length} cards in ${title}?`)
              ) {
                onClearAll();
              }
            }}
            title={`Delete all ${cards.length} cards`}
          >
            🗑️
          </button>
        )}
      </div>
      <div className="column-cards" ref={setNodeRef}>
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) => (
            <Card key={card.id} card={card} onClick={() => onCardClick(card)} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
