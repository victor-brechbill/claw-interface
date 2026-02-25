import Sparkline from "./Sparkline";
import RangeSlider from "./RangeSlider";
import { formatPrice, formatPercentage } from "../utils/format";

interface StockRowProps {
  symbol: string;
  price: number;
  changePercent: number;
  weekChangePercent: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  daySparkline: number[];
  weekSparkline: number[];
  currency: string;
  previousClose: number;
  onRemove: (symbol: string) => void;
}

export default function StockRow({
  symbol,
  price,
  changePercent,
  weekChangePercent,
  fiftyTwoWeekHigh,
  fiftyTwoWeekLow,
  daySparkline,
  weekSparkline,
  currency,
  previousClose,
  onRemove,
}: StockRowProps) {
  const getChangeClassName = (percent: number): string => {
    if (percent > 0) return "change-positive";
    if (percent < 0) return "change-negative";
    return "change-neutral";
  };

  return (
    <tr className="stock-row">
      {/* Symbol */}
      <td className="stock-symbol">
        <span className="symbol-text">{symbol}</span>
      </td>

      {/* Price */}
      <td className="stock-price">
        <span className="price-text">{formatPrice(price, currency)}</span>
      </td>

      {/* Day Change % */}
      <td className="stock-day-change">
        <span className={`change-text ${getChangeClassName(changePercent)}`}>
          {formatPercentage(changePercent)}
        </span>
      </td>

      {/* Day Trend (Sparkline) */}
      <td className="stock-day-trend">
        <Sparkline
          data={daySparkline}
          width={100}
          height={32}
          positive={changePercent >= 0}
          className="day-sparkline"
          showReferenceLine={true}
          referencePrice={previousClose}
          timeRange="day"
        />
      </td>

      {/* Week Change % */}
      <td className="stock-week-change">
        <span
          className={`change-text ${getChangeClassName(weekChangePercent)}`}
        >
          {formatPercentage(weekChangePercent)}
        </span>
      </td>

      {/* Week Trend (Sparkline) */}
      <td className="stock-week-trend">
        <Sparkline
          data={weekSparkline}
          width={100}
          height={32}
          positive={weekChangePercent >= 0}
          className="week-sparkline"
          showReferenceLine={true}
          referencePrice={
            weekSparkline.length > 0 ? weekSparkline[0] : previousClose
          }
          timeRange="week"
        />
      </td>

      {/* 52-Week Range */}
      <td className="stock-range">
        <RangeSlider
          current={price}
          low={fiftyTwoWeekLow}
          high={fiftyTwoWeekHigh}
          currency={currency}
        />
      </td>

      {/* Actions */}
      <td className="stock-actions">
        <button
          className="remove-button"
          onClick={() => onRemove(symbol)}
          title={`Remove ${symbol} from watchlist`}
        >
          ×
        </button>
      </td>
    </tr>
  );
}
