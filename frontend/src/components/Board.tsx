import { useState, useEffect, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensors,
  useSensor,
} from "@dnd-kit/core";
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { Card as CardType } from "../types";
import { COLUMNS, COLUMN_LABELS } from "../types";
import { apiGet, apiPut } from "../utils/api";
import { useNotification } from "./Notification";
import { useOpenCard } from "../hooks/useLocalStorageDraft";
import Column from "./Column";
import CardComponent from "./Card";
import CardModal from "./CardModal";
import CreateCardForm from "./CreateCardForm";

export default function Board() {
  const [cards, setCards] = useState<CardType[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeCard, setActiveCard] = useState<CardType | null>(null);
  const [reordering, setReordering] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const pollingInterval = useRef<number | null>(null);
  const { notify } = useNotification();
  const [openCardId, setOpenCardId, clearOpenCard] = useOpenCard();

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 }, // Desktop: move 5px to start drag
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200, // Mobile: press and hold 200ms
        tolerance: 8, // Allow slight movement during hold
      },
    }),
    useSensor(KeyboardSensor),
  );

  // Helper function to check if cards have actually changed
  const cardsEqual = useCallback((a: CardType[], b: CardType[]): boolean => {
    if (a.length !== b.length) return false;
    const aMap = new Map(a.map((card) => [card.id, card]));
    return b.every((card) => {
      const existing = aMap.get(card.id);
      return (
        existing &&
        existing.title === card.title &&
        existing.column === card.column &&
        existing.position === card.position &&
        existing.updated_at === card.updated_at
      );
    });
  }, []);

  const fetchCards = useCallback(
    async (isPolling = false) => {
      try {
        const data = await apiGet<CardType[]>("/api/cards");
        const newCards = data || [];

        setCards((prevCards) => {
          // If polling and cards haven't changed, don't update state
          if (isPolling && cardsEqual(prevCards, newCards)) {
            return prevCards;
          }
          return newCards;
        });
      } catch {
        if (!isPolling) {
          notify("error", "Failed to load cards. Please try again.");
        }
        // Silent fail for polling requests to avoid spamming user
      } finally {
        if (!isPolling) {
          setLoading(false);
        }
      }
    },
    [notify, cardsEqual],
  );

  useEffect(() => {
    // Initial fetch
    fetchCards();

    // Start polling every 10 seconds
    pollingInterval.current = setInterval(() => {
      // Don't poll if user is dragging to avoid interference
      if (!isDragging) {
        fetchCards(true);
      }
    }, 10000);

    // Cleanup interval on unmount
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, [fetchCards, isDragging]);

  // Restore modal state from localStorage
  useEffect(() => {
    if (openCardId && cards.length > 0 && !selectedCard) {
      const cardToOpen = cards.find((card) => card.id === openCardId);
      if (cardToOpen) {
        setSelectedCard(cardToOpen);
        notify("info", "Draft restored - modal reopened");
      } else {
        // Card no longer exists, clear the saved ID
        clearOpenCard();
      }
    }
  }, [openCardId, cards, selectedCard, notify, clearOpenCard]);

  function handleUpdated() {
    setSelectedCard(null);
    setShowCreate(false);
    clearOpenCard(); // Clear saved open card when modal closes
    fetchCards(false); // Explicit non-polling fetch
  }

  // Handle clearing all done cards
  async function handleClearDone() {
    const doneCards = cards.filter((c) => c.column === "done");
    if (doneCards.length === 0) return;

    try {
      await Promise.all(
        doneCards.map((c) => fetch(`/api/cards/${c.id}`, { method: "DELETE" })),
      );
      fetchCards(false);
    } catch (err) {
      console.error("Failed to clear done cards:", err);
    }
  }

  // Handle card selection and save to localStorage
  function handleCardSelect(card: CardType) {
    setSelectedCard(card);
    setOpenCardId(card.id);
  }

  // Handle modal close
  function handleModalClose() {
    setSelectedCard(null);
    clearOpenCard();
  }

  const grouped = COLUMNS.reduce(
    (acc, col) => {
      acc[col] = cards
        .filter((c) => c.column === col)
        .sort((a, b) => a.position - b.position);
      return acc;
    },
    {} as Record<string, CardType[]>,
  );

  function findColumn(cardId: string): string | undefined {
    if (COLUMNS.includes(cardId as CardType["column"])) {
      return cardId;
    }
    return cards.find((c) => c.id === cardId)?.column;
  }

  function handleDragStart(event: DragStartEvent) {
    const card = cards.find((c) => c.id === event.active.id);
    setActiveCard(card || null);
    setIsDragging(true);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeCol = findColumn(active.id as string);
    const overCol = findColumn(over.id as string);
    if (!activeCol || !overCol || activeCol === overCol) return;

    setCards((prev) => {
      const card = prev.find((c) => c.id === active.id);
      if (!card) return prev;

      const updated = prev.map((c) =>
        c.id === active.id
          ? { ...c, column: overCol as CardType["column"] }
          : c,
      );

      const targetCards = updated
        .filter((c) => c.column === overCol)
        .sort((a, b) => a.position - b.position);

      return updated.map((c) => {
        if (c.column === overCol) {
          const idx = targetCards.findIndex((tc) => tc.id === c.id);
          return { ...c, position: idx };
        }
        return c;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    setIsDragging(false);
    const { active, over } = event;
    if (!over) return;

    const activeCol = findColumn(active.id as string);
    const overCol = findColumn(over.id as string);
    if (!activeCol || !overCol) return;

    setCards((prev) => {
      let updated = [...prev];

      if (activeCol === overCol && active.id !== over.id) {
        const colCards = updated
          .filter((c) => c.column === activeCol)
          .sort((a, b) => a.position - b.position);
        const oldIdx = colCards.findIndex((c) => c.id === active.id);
        const newIdx = colCards.findIndex((c) => c.id === over.id);

        if (oldIdx !== -1 && newIdx !== -1) {
          const reordered = arrayMove(colCards, oldIdx, newIdx);
          const posMap = new Map(reordered.map((c, i) => [c.id, i]));
          updated = updated.map((c) =>
            posMap.has(c.id) ? { ...c, position: posMap.get(c.id)! } : c,
          );
        }
      }

      const affectedCols = new Set([activeCol, overCol]);
      for (const col of affectedCols) {
        const colCards = updated
          .filter((c) => c.column === col)
          .sort((a, b) => a.position - b.position);
        const posMap = new Map(colCards.map((c, i) => [c.id, i]));
        updated = updated.map((c) =>
          posMap.has(c.id) ? { ...c, position: posMap.get(c.id)! } : c,
        );
      }

      const reorderUpdates = updated
        .filter((c) => affectedCols.has(c.column))
        .map((c) => ({ id: c.id, column: c.column, position: c.position }));

      setReordering(true);
      apiPut("/api/cards/reorder", { updates: reorderUpdates })
        .then(() => fetchCards())
        .catch(() => {
          notify("error", "Failed to save card order. Refreshing...");
          fetchCards();
        })
        .finally(() => setReordering(false));

      return updated;
    });
  }

  if (loading) {
    return (
      <div className="board-loading">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <>
      <div className="board-toolbar">
        <div className="board-toolbar-left">
          {/* Updated indicator removed per owner's request */}
        </div>
        <div className="board-toolbar-right">
          {reordering && <span className="reorder-indicator">Saving...</span>}
          <button
            className="btn btn-primary"
            onClick={() => setShowCreate(true)}
          >
            + New Card
          </button>
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        autoScroll={{
          threshold: { x: 0.15, y: 0.15 }, // Start scrolling when 15% from edge
          acceleration: 15, // Scroll speed
        }}
      >
        <div className="board">
          {COLUMNS.map((col) => (
            <Column
              key={col}
              id={col}
              title={COLUMN_LABELS[col]}
              cards={grouped[col]}
              onCardClick={handleCardSelect}
              onClearAll={col === "done" ? handleClearDone : undefined}
            />
          ))}
        </div>
        <DragOverlay>
          {activeCard ? (
            <CardComponent card={activeCard} onClick={() => {}} isOverlay />
          ) : null}
        </DragOverlay>
      </DndContext>
      {selectedCard && (
        <CardModal
          card={selectedCard}
          onClose={handleModalClose}
          onUpdated={handleUpdated}
        />
      )}
      {showCreate && (
        <CreateCardForm
          onCreated={handleUpdated}
          onCancel={() => setShowCreate(false)}
        />
      )}
    </>
  );
}
