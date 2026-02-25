import StockRow from "./StockRow";

interface StockData {
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

interface StockTableProps {
  stocks: StockData[];
  loading: boolean;
  onRemoveStock: (symbol: string) => void;
}

export default function StockTable({
  stocks,
  loading,
  onRemoveStock,
}: StockTableProps) {
  if (loading && stocks.length === 0) {
    return (
      <div className="stocks-loading">
        <div className="loading-spinner"></div>
        <span>Loading stock prices...</span>
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div className="stocks-empty">
        <p>No stocks in your watchlist.</p>
        <button className="add-stock-button">Add Stock</button>
      </div>
    );
  }

  return (
    <div className="stock-table-container">
      <table className="stock-table">
        <thead>
          <tr className="table-header">
            <th className="header-symbol">Symbol</th>
            <th className="header-price">Price</th>
            <th className="header-day">Day</th>
            <th className="header-day-trend">Day Trend</th>
            <th className="header-week">Week</th>
            <th className="header-week-trend">Week Trend</th>
            <th className="header-range">52-Week Range</th>
            <th className="header-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock) => (
            <StockRow
              key={stock.symbol}
              symbol={stock.symbol}
              price={stock.price}
              changePercent={stock.changePercent}
              weekChangePercent={stock.weekChangePercent}
              fiftyTwoWeekHigh={stock.fiftyTwoWeekHigh}
              fiftyTwoWeekLow={stock.fiftyTwoWeekLow}
              daySparkline={stock.daySparkline}
              weekSparkline={stock.weekSparkline}
              currency={stock.currency}
              previousClose={stock.previousClose}
              onRemove={onRemoveStock}
            />
          ))}
        </tbody>
      </table>

      {loading && stocks.length > 0 && (
        <div className="table-loading-overlay">
          <div className="loading-indicator">
            <span className="spinner-small">🔄</span>
            Updating...
          </div>
        </div>
      )}
    </div>
  );
}
