import { useMemo } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  positive?: boolean;
  className?: string;
  showReferenceLine?: boolean;
  referencePrice?: number;
  timeRange?: "day" | "week";
}

export default function Sparkline({
  data,
  width = 100,
  height = 32,
  positive = true,
  className = "",
  showReferenceLine = false,
  referencePrice,
  timeRange = "day",
}: SparklineProps) {
  const { pathData, yBounds } = useMemo(() => {
    if (!data || data.length < 2)
      return { pathData: "", yBounds: { yMin: 0, yMax: 1, range: 1 } };

    // Y-axis: Always include reference line in bounds
    const getYBounds = (data: number[], referencePrice?: number) => {
      const allValues = referencePrice ? [...data, referencePrice] : data;
      const min = Math.min(...allValues);
      const max = Math.max(...allValues);
      const padding = (max - min) * 0.1;
      return {
        yMin: min - padding,
        yMax: max + padding,
        range: max + padding - (min - padding),
      };
    };

    const bounds = getYBounds(data, referencePrice);

    if (bounds.range === 0) {
      // Flat line if all values are the same
      const y = height / 2;
      return { pathData: `M 0 ${y} L ${width} ${y}`, yBounds: bounds };
    }

    // X-axis: Fixed time range support
    const points: string[] = [];

    if (timeRange === "day") {
      // Day chart: 9:30 AM - 4:00 PM ET (78 data points at 5-min intervals)
      const totalPoints = 78; // 6.5 hours * 12 points per hour

      data.forEach((value, index) => {
        // Position data points based on their actual position within trading day
        const x = (index / Math.max(totalPoints - 1, data.length - 1)) * width;
        const y = height - ((value - bounds.yMin) / bounds.range) * height;
        points.push(`${x} ${y}`);
      });
    } else if (timeRange === "week") {
      // Week chart: Exactly 5 trading days
      const totalDays = 5;

      data.forEach((value, index) => {
        // Position data points based on trading days
        const x = (index / Math.max(totalDays - 1, data.length - 1)) * width;
        const y = height - ((value - bounds.yMin) / bounds.range) * height;
        points.push(`${x} ${y}`);
      });
    } else {
      // Default behavior: stretch across full width
      data.forEach((value, index) => {
        const x = (index / (data.length - 1)) * width;
        const y = height - ((value - bounds.yMin) / bounds.range) * height;
        points.push(`${x} ${y}`);
      });
    }

    return { pathData: `M ${points.join(" L ")}`, yBounds: bounds };
  }, [data, width, height, referencePrice, timeRange]);

  const areaPathData = useMemo(() => {
    if (!data || data.length < 2 || !pathData || yBounds.range === 0) return "";

    // Add area fill below the line using the same bounds as pathData
    let points: [number, number][] = [];

    if (timeRange === "day") {
      const totalPoints = 78;
      points = data.map((value, index) => {
        const x = (index / Math.max(totalPoints - 1, data.length - 1)) * width;
        const y = height - ((value - yBounds.yMin) / yBounds.range) * height;
        return [x, y];
      });
    } else if (timeRange === "week") {
      const totalDays = 5;
      points = data.map((value, index) => {
        const x = (index / Math.max(totalDays - 1, data.length - 1)) * width;
        const y = height - ((value - yBounds.yMin) / yBounds.range) * height;
        return [x, y];
      });
    } else {
      points = data.map((value, index) => {
        const x = (index / (data.length - 1)) * width;
        const y = height - ((value - yBounds.yMin) / yBounds.range) * height;
        return [x, y];
      });
    }

    const areaPath = [
      `M ${points[0][0]} ${height}`, // Start at bottom-left
      ...points.map(([x, y]) => `L ${x} ${y}`), // Follow the line
      `L ${points[points.length - 1][0]} ${height}`, // Go to bottom-right
      "Z", // Close the path
    ].join(" ");

    return areaPath;
  }, [data, width, height, pathData, yBounds, timeRange]);

  const currentValue = data && data.length > 0 ? data[data.length - 1] : 0;

  // Calculate X position for the end dot based on time range
  let endX = width - 3;
  if (timeRange === "day" && data && data.length > 0) {
    const totalPoints = 78;
    endX =
      ((data.length - 1) / Math.max(totalPoints - 1, data.length - 1)) * width;
  } else if (timeRange === "week" && data && data.length > 0) {
    const totalDays = 5;
    endX =
      ((data.length - 1) / Math.max(totalDays - 1, data.length - 1)) * width;
  }

  // Calculate Y position for the end dot using consistent bounds
  const endY =
    yBounds.range === 0
      ? height / 2
      : height - ((currentValue - yBounds.yMin) / yBounds.range) * height;

  const lineColor = positive ? "#22c55e" : "#ef4444"; // Green for positive, red for negative
  const fillColor = positive
    ? "rgba(34, 197, 94, 0.1)"
    : "rgba(239, 68, 68, 0.1)";

  // Reference line Y position (using provided referencePrice or fallback to first data point)
  const referenceValue =
    referencePrice !== undefined
      ? referencePrice
      : data && data.length > 0
        ? data[0]
        : 0;
  const referenceY =
    yBounds.range === 0
      ? height / 2
      : height - ((referenceValue - yBounds.yMin) / yBounds.range) * height;

  return (
    <div className={`sparkline ${className}`}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="sparkline-svg"
      >
        {/* Reference line (dotted horizontal line at previous close) */}
        {showReferenceLine && data && data.length > 1 && (
          <line
            x1={0}
            y1={referenceY}
            x2={width}
            y2={referenceY}
            stroke="#888"
            strokeWidth="1"
            strokeDasharray="3,3"
            opacity={0.5}
          />
        )}

        {/* Area fill */}
        {areaPathData && (
          <path d={areaPathData} fill={fillColor} stroke="none" />
        )}

        {/* Main line */}
        {pathData && (
          <path
            d={pathData}
            fill="none"
            stroke={lineColor}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* End point dot */}
        {pathData && (
          <circle
            cx={endX}
            cy={endY}
            r="2"
            fill={lineColor}
            stroke="white"
            strokeWidth="1"
          />
        )}
      </svg>
    </div>
  );
}
