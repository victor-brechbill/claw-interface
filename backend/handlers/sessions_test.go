package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// setupTestAgentDir creates a mock agent sessions directory with the given sessions data.
func setupTestAgentDir(t *testing.T, homeDir, agentName string, sessions map[string]rawSession) {
	t.Helper()
	dir := filepath.Join(homeDir, ".openclaw", "agents", agentName, "sessions")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatalf("failed to create agent dir: %v", err)
	}
	data, err := json.MarshalIndent(sessions, "", "  ")
	if err != nil {
		t.Fatalf("failed to marshal sessions: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "sessions.json"), data, 0644); err != nil {
		t.Fatalf("failed to write sessions.json: %v", err)
	}
}

func TestListSessions_Success(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	now := time.Now()
	setupTestAgentDir(t, tmpHome, "developer", map[string]rawSession{
		"agent:developer:main:main": {
			UpdatedAt:    float64(now.Add(-2 * time.Minute).UnixMilli()),
			Label:        "Fix bug",
			Model:        "claude-opus-4",
			InputTokens:  1000,
			OutputTokens: 500,
			TotalTokens:  1500,
		},
	})
	setupTestAgentDir(t, tmpHome, "tommy", map[string]rawSession{
		"agent:tommy:cron:abc123": {
			UpdatedAt:    float64(now.Add(-30 * time.Minute).UnixMilli()),
			Label:        "Daily report",
			Model:        "claude-sonnet-4",
			InputTokens:  200,
			OutputTokens: 100,
			TotalTokens:  300,
		},
	})

	handler := NewSessionsHandler(newTestLogger())
	req := httptest.NewRequest("GET", "/api/sessions?activeWithin=9999", nil)
	w := httptest.NewRecorder()
	handler.ListSessions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp GatewaySessionsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if resp.Count != 2 {
		t.Errorf("expected 2 sessions, got %d", resp.Count)
	}
	if resp.TotalTokens != 1800 {
		t.Errorf("expected 1800 totalTokens, got %d", resp.TotalTokens)
	}

	// Most recent should be first (developer session is newer).
	if resp.Sessions[0].Agent != "Developer" {
		t.Errorf("expected first session agent=Developer, got %s", resp.Sessions[0].Agent)
	}
	if resp.Sessions[0].Kind != "main" {
		t.Errorf("expected first session kind=main, got %s", resp.Sessions[0].Kind)
	}
}

func TestListSessions_EmptyAgentsDir(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	handler := NewSessionsHandler(newTestLogger())
	req := httptest.NewRequest("GET", "/api/sessions", nil)
	w := httptest.NewRecorder()
	handler.ListSessions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp GatewaySessionsResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if resp.Count != 0 {
		t.Errorf("expected 0 sessions, got %d", resp.Count)
	}
	if len(resp.Sessions) != 0 {
		t.Errorf("expected empty sessions slice, got %d", len(resp.Sessions))
	}
}

func TestListSessions_ActiveWithinFilter(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	now := time.Now()
	setupTestAgentDir(t, tmpHome, "developer", map[string]rawSession{
		"agent:developer:main:main": {
			UpdatedAt:   float64(now.Add(-2 * time.Minute).UnixMilli()),
			Label:       "Recent session",
			TotalTokens: 1000,
		},
		"agent:developer:subagent:old-one": {
			UpdatedAt:   float64(now.Add(-120 * time.Minute).UnixMilli()),
			Label:       "Old session",
			TotalTokens: 500,
		},
	})

	handler := NewSessionsHandler(newTestLogger())
	req := httptest.NewRequest("GET", "/api/sessions?activeWithin=60", nil)
	w := httptest.NewRecorder()
	handler.ListSessions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp GatewaySessionsResponse
	json.NewDecoder(w.Body).Decode(&resp)

	if resp.Count != 1 {
		t.Errorf("expected 1 session (recent only), got %d", resp.Count)
	}
	if resp.Count > 0 && resp.Sessions[0].Label != "Recent session" {
		t.Errorf("expected recent session, got %s", resp.Sessions[0].Label)
	}
}

func TestDeleteSession_Success(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	now := time.Now()
	setupTestAgentDir(t, tmpHome, "developer", map[string]rawSession{
		"agent:developer:main:main": {
			UpdatedAt:   float64(now.UnixMilli()),
			Label:       "Keep me",
			TotalTokens: 1000,
		},
		"agent:developer:subagent:delete-me": {
			UpdatedAt:   float64(now.UnixMilli()),
			Label:       "Delete me",
			TotalTokens: 500,
		},
	})

	handler := NewSessionsHandler(newTestLogger())
	encodedKey := url.PathEscape("agent:developer:subagent:delete-me")
	req := httptest.NewRequest("DELETE", "/api/sessions/"+encodedKey, nil)
	req.SetPathValue("key", encodedKey)
	w := httptest.NewRecorder()
	handler.DeleteSession(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", w.Code, w.Body.String())
	}

	// Verify the file was updated — deleted key should be gone.
	sessFile := filepath.Join(tmpHome, ".openclaw", "agents", "developer", "sessions", "sessions.json")
	data, err := os.ReadFile(sessFile)
	if err != nil {
		t.Fatalf("failed to read sessions file: %v", err)
	}

	var remaining map[string]json.RawMessage
	if err := json.Unmarshal(data, &remaining); err != nil {
		t.Fatalf("failed to parse sessions file: %v", err)
	}

	if _, exists := remaining["agent:developer:subagent:delete-me"]; exists {
		t.Error("deleted session key should not exist in file")
	}
	if _, exists := remaining["agent:developer:main:main"]; !exists {
		t.Error("other session key should still exist")
	}
}

func TestDeleteSession_NotFound(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	now := time.Now()
	setupTestAgentDir(t, tmpHome, "developer", map[string]rawSession{
		"agent:developer:main:main": {
			UpdatedAt:   float64(now.UnixMilli()),
			TotalTokens: 1000,
		},
	})

	handler := NewSessionsHandler(newTestLogger())
	encodedKey := url.PathEscape("agent:developer:subagent:nonexistent")
	req := httptest.NewRequest("DELETE", "/api/sessions/"+encodedKey, nil)
	req.SetPathValue("key", encodedKey)
	w := httptest.NewRecorder()
	handler.DeleteSession(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetStats_Aggregates(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	now := time.Now()
	setupTestAgentDir(t, tmpHome, "developer", map[string]rawSession{
		"agent:developer:main:main": {
			UpdatedAt:   float64(now.Add(-2 * time.Minute).UnixMilli()), // active
			TotalTokens: 1000,
		},
		"agent:developer:subagent:uuid1": {
			UpdatedAt:   float64(now.Add(-120 * time.Minute).UnixMilli()), // stale
			TotalTokens: 500,
		},
	})
	setupTestAgentDir(t, tmpHome, "tommy", map[string]rawSession{
		"agent:tommy:cron:uuid2": {
			UpdatedAt:   float64(now.Add(-30 * time.Minute).UnixMilli()), // idle
			TotalTokens: 300,
		},
	})

	handler := NewSessionsHandler(newTestLogger())
	req := httptest.NewRequest("GET", "/api/sessions/stats", nil)
	w := httptest.NewRecorder()
	handler.GetStats(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SessionsStatsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if resp.TotalSessions != 3 {
		t.Errorf("totalSessions: got %d, want 3", resp.TotalSessions)
	}
	if resp.TotalTokens != 1800 {
		t.Errorf("totalTokens: got %d, want 1800", resp.TotalTokens)
	}
	if resp.ActiveCount != 1 {
		t.Errorf("activeCount: got %d, want 1", resp.ActiveCount)
	}
	if resp.IdleCount != 1 {
		t.Errorf("idleCount: got %d, want 1", resp.IdleCount)
	}
	if resp.StaleCount != 1 {
		t.Errorf("staleCount: got %d, want 1", resp.StaleCount)
	}
	if resp.ByKind["main"] != 1 {
		t.Errorf("byKind.main: got %d, want 1", resp.ByKind["main"])
	}
	if resp.ByKind["isolated"] != 1 {
		t.Errorf("byKind.isolated: got %d, want 1", resp.ByKind["isolated"])
	}
	if resp.ByKind["cron"] != 1 {
		t.Errorf("byKind.cron: got %d, want 1", resp.ByKind["cron"])
	}
	if resp.ByKind["global"] != 0 {
		t.Errorf("byKind.global: got %d, want 0", resp.ByKind["global"])
	}
}

func TestGetStats_EmptyDir(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	handler := NewSessionsHandler(newTestLogger())
	req := httptest.NewRequest("GET", "/api/sessions/stats", nil)
	w := httptest.NewRecorder()
	handler.GetStats(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp SessionsStatsResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error: %v", err)
	}

	if resp.TotalSessions != 0 {
		t.Errorf("totalSessions: got %d, want 0", resp.TotalSessions)
	}
	if resp.TotalTokens != 0 {
		t.Errorf("totalTokens: got %d, want 0", resp.TotalTokens)
	}
	if resp.ByKind["main"] != 0 {
		t.Errorf("byKind.main: got %d, want 0", resp.ByKind["main"])
	}
}

func TestDeriveKind(t *testing.T) {
	tests := []struct {
		key  string
		want string
	}{
		{"agent:developer:subagent:uuid", "isolated"},
		{"agent:tommy:cron:uuid", "cron"},
		{"agent:main:main", "main"},
		{"agent:developer:main:main", "main"},
		{"some:other:key", "global"},
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			got := deriveKind(tt.key)
			if got != tt.want {
				t.Errorf("deriveKind(%q) = %q, want %q", tt.key, got, tt.want)
			}
		})
	}
}

func TestDeriveStatus(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name string
		age  time.Duration
		want string
	}{
		{"just now", 0, "active"},
		{"2 minutes ago", 2 * time.Minute, "active"},
		{"4 minutes ago", 4 * time.Minute, "active"},
		{"6 minutes ago", 6 * time.Minute, "idle"},
		{"30 minutes ago", 30 * time.Minute, "idle"},
		{"59 minutes ago", 59 * time.Minute, "idle"},
		{"61 minutes ago", 61 * time.Minute, "stale"},
		{"2 hours ago", 2 * time.Hour, "stale"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := deriveStatus(now.Add(-tt.age), now)
			if got != tt.want {
				t.Errorf("deriveStatus(age=%v) = %q, want %q", tt.age, got, tt.want)
			}
		})
	}
}
