package gateway

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// Client defines the interface for the gateway RPC client.
type Client interface {
	SessionsUsage(ctx context.Context, startDate, endDate string) (*SessionsUsageResult, error)
	CostUsage(ctx context.Context, startDate, endDate string) (*CostUsageSummary, error)
	Close() error
}

// WSClient implements Client using WebSocket connections to the gateway.
type WSClient struct {
	url    string
	logger *zap.Logger
}

// NewWSClient creates a new WebSocket RPC client.
func NewWSClient(url string, logger *zap.Logger) *WSClient {
	return &WSClient{
		url:    url,
		logger: logger,
	}
}

func randomID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%x", b)
}

// connect opens a WebSocket, performs the handshake, and returns the connection.
func (c *WSClient) connect(ctx context.Context) (*websocket.Conn, error) {
	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	conn, _, err := dialer.DialContext(ctx, c.url, nil)
	if err != nil {
		return nil, fmt.Errorf("ws dial: %w", err)
	}

	// Read optional connect.challenge event or hello-ok
	conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("ws read handshake: %w", err)
	}

	var frame genericFrame
	if err := json.Unmarshal(msg, &frame); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ws parse handshake: %w", err)
	}

	// If we got a challenge event, send connect request and read hello-ok
	if frame.Type == "event" && frame.Event == "connect.challenge" {
		connectReq := connectRequest{
			Type: "connect",
			ID:   randomID(),
		}
		if err := conn.WriteJSON(connectReq); err != nil {
			conn.Close()
			return nil, fmt.Errorf("ws send connect: %w", err)
		}

		_, msg, err = conn.ReadMessage()
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("ws read hello-ok: %w", err)
		}
		if err := json.Unmarshal(msg, &frame); err != nil {
			conn.Close()
			return nil, fmt.Errorf("ws parse hello-ok: %w", err)
		}
	}

	// At this point we should have a hello-ok or similar confirmation
	if frame.Type == "res" && !frame.OK {
		conn.Close()
		return nil, fmt.Errorf("ws handshake rejected")
	}

	return conn, nil
}

// rpc performs a single RPC call: connect, handshake, request, response, close.
func (c *WSClient) rpc(ctx context.Context, method string, params interface{}) (json.RawMessage, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	conn, err := c.connect(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	reqID := randomID()
	req := RequestFrame{
		Type:   "req",
		ID:     reqID,
		Method: method,
		Params: params,
	}

	if err := conn.WriteJSON(req); err != nil {
		return nil, fmt.Errorf("ws write request: %w", err)
	}

	conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	_, msg, err := conn.ReadMessage()
	if err != nil {
		return nil, fmt.Errorf("ws read response: %w", err)
	}

	var resp ResponseFrame
	if err := json.Unmarshal(msg, &resp); err != nil {
		return nil, fmt.Errorf("ws parse response: %w", err)
	}

	if resp.Type != "res" {
		return nil, fmt.Errorf("unexpected frame type: %s", resp.Type)
	}
	if resp.ID != reqID {
		return nil, fmt.Errorf("response ID mismatch: got %s, want %s", resp.ID, reqID)
	}
	if !resp.OK {
		return nil, fmt.Errorf("rpc error: %s", resp.Error)
	}

	return resp.Payload, nil
}

// SessionsUsage fetches session usage data for the given date range.
func (c *WSClient) SessionsUsage(ctx context.Context, startDate, endDate string) (*SessionsUsageResult, error) {
	params := map[string]string{
		"startDate": startDate,
		"endDate":   endDate,
	}

	payload, err := c.rpc(ctx, "sessions.usage", params)
	if err != nil {
		return nil, fmt.Errorf("sessions.usage: %w", err)
	}

	var result SessionsUsageResult
	if err := json.Unmarshal(payload, &result); err != nil {
		return nil, fmt.Errorf("parse sessions.usage: %w", err)
	}

	return &result, nil
}

// CostUsage fetches cost usage data for the given date range.
func (c *WSClient) CostUsage(ctx context.Context, startDate, endDate string) (*CostUsageSummary, error) {
	params := map[string]string{
		"startDate": startDate,
		"endDate":   endDate,
	}

	payload, err := c.rpc(ctx, "cost.usage", params)
	if err != nil {
		return nil, fmt.Errorf("cost.usage: %w", err)
	}

	var result CostUsageSummary
	if err := json.Unmarshal(payload, &result); err != nil {
		return nil, fmt.Errorf("parse cost.usage: %w", err)
	}

	return &result, nil
}

// Close is a no-op since connections are per-request.
func (c *WSClient) Close() error {
	return nil
}
