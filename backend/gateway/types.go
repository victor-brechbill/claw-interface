package gateway

import (
	"encoding/json"
	"time"
)

// UsageTotals holds token counts and costs.
type UsageTotals struct {
	Input          int64   `json:"input"`
	Output         int64   `json:"output"`
	CacheRead      int64   `json:"cacheRead"`
	CacheWrite     int64   `json:"cacheWrite"`
	TotalTokens    int64   `json:"totalTokens"`
	TotalCost      float64 `json:"totalCost"`
	InputCost      float64 `json:"inputCost"`
	OutputCost     float64 `json:"outputCost"`
	CacheReadCost  float64 `json:"cacheReadCost"`
	CacheWriteCost float64 `json:"cacheWriteCost"`
}

// SessionUsage represents a single session's usage data.
type SessionUsage struct {
	Key           string      `json:"key"`
	Label         string      `json:"label"`
	AgentID       string      `json:"agentId"`
	Model         string      `json:"model"`
	Channel       string      `json:"channel"`
	Usage         UsageTotals `json:"usage"`
	FirstActivity time.Time   `json:"firstActivity"`
	LastActivity  time.Time   `json:"lastActivity"`
	DurationMs    int64       `json:"durationMs"`
}

// DailyAggregate holds per-day aggregated data.
type DailyAggregate struct {
	Date      string  `json:"date"`
	Tokens    int64   `json:"tokens"`
	Cost      float64 `json:"cost"`
	Messages  int64   `json:"messages"`
	ToolCalls int64   `json:"toolCalls"`
	Errors    int64   `json:"errors"`
}

// ByAgentAggregate holds per-agent aggregated data.
type ByAgentAggregate struct {
	AgentID     string  `json:"agentId"`
	TotalCost   float64 `json:"totalCost"`
	TotalTokens int64   `json:"totalTokens"`
}

// ByModelAggregate holds per-model aggregated data.
type ByModelAggregate struct {
	Model       string  `json:"model"`
	TotalCost   float64 `json:"totalCost"`
	TotalTokens int64   `json:"totalTokens"`
}

// MessageAggregates holds message-level aggregated data.
type MessageAggregates struct {
	TotalMessages int64 `json:"totalMessages"`
	TotalTools    int64 `json:"totalTools"`
	TotalErrors   int64 `json:"totalErrors"`
}

// Aggregates groups all aggregation types.
type Aggregates struct {
	ByAgent  []ByAgentAggregate `json:"byAgent"`
	ByModel  []ByModelAggregate `json:"byModel"`
	Daily    []DailyAggregate   `json:"daily"`
	Messages MessageAggregates  `json:"messages"`
}

// SessionsUsageResult is the response from sessions.usage RPC.
type SessionsUsageResult struct {
	Sessions   []SessionUsage `json:"sessions"`
	Totals     UsageTotals    `json:"totals"`
	Aggregates Aggregates     `json:"aggregates"`
	StartDate  string         `json:"startDate"`
	EndDate    string         `json:"endDate"`
}

// DailyCost holds per-day cost data from cost.usage RPC.
type DailyCost struct {
	Date           string  `json:"date"`
	TotalCost      float64 `json:"totalCost"`
	InputCost      float64 `json:"inputCost"`
	OutputCost     float64 `json:"outputCost"`
	CacheReadCost  float64 `json:"cacheReadCost"`
	CacheWriteCost float64 `json:"cacheWriteCost"`
	TotalTokens    int64   `json:"totalTokens"`
	Messages       int64   `json:"messages"`
}

// CostUsageTotals holds totals from cost.usage RPC.
type CostUsageTotals struct {
	TotalCost      float64 `json:"totalCost"`
	InputCost      float64 `json:"inputCost"`
	OutputCost     float64 `json:"outputCost"`
	CacheReadCost  float64 `json:"cacheReadCost"`
	CacheWriteCost float64 `json:"cacheWriteCost"`
	TotalTokens    int64   `json:"totalTokens"`
	Messages       int64   `json:"messages"`
}

// CostUsageSummary is the response from cost.usage RPC.
type CostUsageSummary struct {
	Daily  []DailyCost     `json:"daily"`
	Totals CostUsageTotals `json:"totals"`
}

// RequestFrame is the JSON-RPC request frame sent over WebSocket.
type RequestFrame struct {
	Type   string      `json:"type"`
	ID     string      `json:"id"`
	Method string      `json:"method"`
	Params interface{} `json:"params,omitempty"`
}

// ResponseFrame is the JSON-RPC response frame received over WebSocket.
type ResponseFrame struct {
	Type    string          `json:"type"`
	ID      string          `json:"id"`
	OK      bool            `json:"ok"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Error   string          `json:"error,omitempty"`
}

// EventFrame is an event frame received during the handshake.
type EventFrame struct {
	Type  string          `json:"type"`
	Event string          `json:"event"`
	Data  json.RawMessage `json:"data,omitempty"`
}

// connectRequest is sent during the handshake.
type connectRequest struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

// genericFrame is used to peek at the type field of incoming messages.
type genericFrame struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	Event string `json:"event"`
	OK    bool   `json:"ok"`
}
