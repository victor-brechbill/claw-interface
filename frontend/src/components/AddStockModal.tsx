import { useState, useRef, useEffect } from "react";

interface AddStockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddStock: (symbol: string) => Promise<void>;
}

export default function AddStockModal({
  isOpen,
  onClose,
  onAddStock,
}: AddStockModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      // Focus the input when modal opens
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  const handleClose = () => {
    setSearchQuery("");
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const symbol = searchQuery.toUpperCase().trim();

    if (symbol) {
      await onAddStock(symbol);
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content add-stock-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>Add Stock to Watchlist</h3>
          <button className="modal-close" onClick={handleClose}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="search-input-container">
              <input
                ref={inputRef}
                type="text"
                placeholder="Enter stock symbol (e.g., AAPL, GOOGL)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="search-input"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="cancel-button"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="add-button"
              disabled={!searchQuery.trim()}
            >
              Add Stock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
