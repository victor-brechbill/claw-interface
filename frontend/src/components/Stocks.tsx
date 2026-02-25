import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "../utils/api";
import MarketStatusBanner from "./MarketStatusBanner";
import StockTable from "./StockTable";
import AddStockModal from "./AddStockModal";

interface StockPrice {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  weekChangePercent: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  volume: number;
  previousClose: number;
  daySparkline: number[];
  weekSparkline: number[];
  lastUpdate: string;
  currency: string;
  marketCap?: number;
}

interface MarketStatus {
  state: string;
  isOpen: boolean;
  nextOpenTime?: string;
  nextCloseTime?: string;
  currentTimeET: string;
}

interface StockPricesResponse {
  stocks: StockPrice[];
  marketStatus: MarketStatus;
  timestamp: string;
  source: string;
}

export default function Stocks() {
  const [stocks, setStocks] = useState<StockPrice[]>([]);
  const [marketStatus, setMarketStatus] = useState<MarketStatus>({
    state: "closed",
    isOpen: false,
    currentTimeET: new Date().toLocaleTimeString(),
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [showAddModal, setShowAddModal] = useState(false);

  const loadStocks = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const data = await apiGet<StockPricesResponse>("/api/stocks/prices");

      setStocks(data.stocks || []);
      setMarketStatus(data.marketStatus);
      setLastUpdate(new Date(data.timestamp).toLocaleTimeString());
    } catch (err) {
      setError("Failed to load stock prices");
      console.error("Stock API error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAddStock = async (symbol: string) => {
    try {
      await apiPost("/api/stocks/watchlist", { symbol });
      // Reload stock data after adding - await to ensure state updates
      await loadStocks();
    } catch (err) {
      console.error("Failed to add stock:", err);
      setError("Failed to add stock to watchlist");
    }
  };

  const handleRemoveStock = async (symbol: string) => {
    try {
      await apiDelete(`/api/stocks/watchlist/${symbol}`);
      // Remove from local state immediately for better UX
      setStocks((prev) => prev.filter((stock) => stock.symbol !== symbol));
    } catch (err) {
      console.error("Failed to remove stock:", err);
      setError("Failed to remove stock from watchlist");
      // Reload to sync with server state
      loadStocks();
    }
  };

  // Auto-refresh logic based on market hours
  useEffect(() => {
    loadStocks();

    let refreshInterval: number;

    if (marketStatus.isOpen) {
      // Refresh every 60 seconds during market hours
      refreshInterval = setInterval(loadStocks, 60 * 1000);
    } else {
      // Refresh every 5 minutes outside market hours
      refreshInterval = setInterval(loadStocks, 5 * 60 * 1000);
    }

    return () => clearInterval(refreshInterval);
  }, [loadStocks, marketStatus.isOpen]);

  // Update refresh interval when market status changes
  useEffect(() => {
    const timer = setTimeout(() => {
      // Check for market status changes every minute
      loadStocks();
    }, 60 * 1000);

    return () => clearTimeout(timer);
  }, [marketStatus.state, loadStocks]);

  const handleRefresh = () => {
    loadStocks();
  };

  const handleOpenAddModal = () => {
    setShowAddModal(true);
  };

  const handleCloseAddModal = () => {
    setShowAddModal(false);
  };

  return (
    <div className="stocks-container">
      {/* Market Status Banner serves as the page header */}
      <MarketStatusBanner
        marketStatus={marketStatus}
        lastUpdate={lastUpdate}
        onRefresh={handleRefresh}
        loading={loading}
      />

      {/* Error display */}
      {error && (
        <div className="stock-error-banner">
          <span className="error-icon">⚠️</span>
          <span className="error-text">{error}</span>
          <button className="error-dismiss" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}

      {/* Main Stock Table */}
      <div className="stocks-main">
        <div className="stocks-header-actions">
          <button
            className="add-stock-btn"
            onClick={handleOpenAddModal}
            disabled={loading}
          >
            + Add Stock
          </button>
        </div>

        <StockTable
          stocks={stocks}
          loading={loading}
          onRemoveStock={handleRemoveStock}
        />
      </div>

      {/* Add Stock Modal */}
      <AddStockModal
        isOpen={showAddModal}
        onClose={handleCloseAddModal}
        onAddStock={handleAddStock}
      />

      {/* Footer with data disclaimer */}
      <div className="stocks-footer">
        <p className="stock-disclaimer">
          Data provided by Yahoo Finance. Prices may be delayed up to 20
          minutes.
        </p>
      </div>
    </div>
  );
}
