import { formatPrice } from "../utils/format";

interface RangeSliderProps {
  current: number;
  low: number;
  high: number;
  currency?: string;
}

export default function RangeSlider({
  current,
  low,
  high,
  currency = "USD",
}: RangeSliderProps) {
  const percentage =
    low >= high
      ? 0
      : Math.min(100, Math.max(0, ((current - low) / (high - low)) * 100));

  return (
    <div className="range-slider">
      <div className="range-track">
        {/* Background track */}
        <div className="range-track-bg"></div>

        {/* Filled track from low to current */}
        <div
          className="range-track-fill"
          style={{ width: `${percentage}%` }}
        ></div>

        {/* Current position marker */}
        <div className="range-marker" style={{ left: `${percentage}%` }}></div>
      </div>

      <div className="range-labels">
        <span className="range-low">{formatPrice(low, currency)}</span>
        <span className="range-high">{formatPrice(high, currency)}</span>
      </div>
    </div>
  );
}
