package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"go.uber.org/zap"
)

// SessionsHandler handles the /api/sessions endpoints.
type SessionsHandler struct {
	logger *zap.Logger
}

// NewSessionsHandler creates a new SessionsHandler.
func NewSessionsHandler(logger *zap.Logger) *SessionsHandler {
	return &SessionsHandler{logger: logger}
}

// RegisterRoutes wires up session endpoints.
func (h *SessionsHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sessions/stats", h.GetStats)
	mux.HandleFunc("GET /api/sessions", h.ListSessions)
	mux.HandleFunc("DELETE /api/sessions/{key}", h.DeleteSession)
}

// SessionEntry is the JSON shape returned to the frontend.
type SessionEntry struct {
	Key          string `json:"key"`
	Agent        string `json:"agent"`
	Kind         string `json:"kind"`
	Label        string `json:"label,omitempty"`
	Model        string `json:"model,omitempty"`
	Status       string `json:"status"` // active | idle | stale
	UpdatedAt    int64  `json:"updatedAt"`
	InputTokens  int    `json:"inputTokens"`
	OutputTokens int    `json:"outputTokens"`
	TotalTokens  int    `json:"totalTokens"`
	SpawnedBy    string `json:"spawnedBy,omitempty"`
}

// GatewaySessionsResponse is the top-level response for GET /api/sessions.
type GatewaySessionsResponse struct {
	Sessions    []SessionEntry `json:"sessions"`
	Count       int            `json:"count"`
	TotalTokens int            `json:"totalTokens"`
}

// SessionsStatsResponse is the response for GET /api/sessions/stats.
type SessionsStatsResponse struct {
	TotalSessions int            `json:"totalSessions"`
	TotalTokens   int            `json:"totalTokens"`
	ActiveCount   int            `json:"activeCount"`
	IdleCount     int            `json:"idleCount"`
	StaleCount    int            `json:"staleCount"`
	ByKind        map[string]int `json:"byKind"`
}

// rawSession is used when deserialising one entry from sessions.json.
type rawSession struct {
	UpdatedAt    float64 `json:"updatedAt"`
	Label        string  `json:"label"`
	Model        string  `json:"model"`
	InputTokens  float64 `json:"inputTokens"`
	OutputTokens float64 `json:"outputTokens"`
	TotalTokens  float64 `json:"totalTokens"`
	SpawnedBy    string  `json:"spawnedBy"`
}

// ListSessions handles GET /api/sessions.
func (h *SessionsHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	// Parse query params.
	activeWithin := 60 // minutes
	limit := 50

	if v := r.URL.Query().Get("activeWithin"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			activeWithin = n
		}
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		h.logger.Error("failed to get home dir", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}

	agentsDir := filepath.Join(homeDir, ".openclaw", "agents")
	cutoff := time.Now().Add(-time.Duration(activeWithin) * time.Minute)
	now := time.Now()

	entries, err := os.ReadDir(agentsDir)
	if err != nil {
		// Agents directory might not exist — return empty response instead of error.
		h.logger.Warn("agents dir not found", zap.String("path", agentsDir))
		writeJSON(w, http.StatusOK, GatewaySessionsResponse{Sessions: []SessionEntry{}, Count: 0, TotalTokens: 0})
		return
	}

	var sessions []SessionEntry

	for _, agentEntry := range entries {
		if !agentEntry.IsDir() {
			continue
		}
		agentDir := agentEntry.Name()
		sessionsFile := filepath.Join(agentsDir, agentDir, "sessions", "sessions.json")

		data, err := os.ReadFile(sessionsFile)
		if err != nil {
			continue // no sessions file for this agent — skip
		}

		var raw map[string]rawSession
		if err := json.Unmarshal(data, &raw); err != nil {
			h.logger.Warn("failed to parse sessions.json",
				zap.String("agent", agentDir), zap.Error(err))
			continue
		}

		for key, sess := range raw {
			updatedMs := int64(sess.UpdatedAt)
			if updatedMs == 0 {
				continue
			}

			updatedTime := time.UnixMilli(updatedMs)

			// Apply activeWithin filter.
			if updatedTime.Before(cutoff) {
				continue
			}

			sessions = append(sessions, SessionEntry{
				Key:          key,
				Agent:        agentDirToName(agentDir),
				Kind:         deriveKind(key),
				Label:        sess.Label,
				Model:        sess.Model,
				Status:       deriveStatus(updatedTime, now),
				UpdatedAt:    updatedMs,
				InputTokens:  int(sess.InputTokens),
				OutputTokens: int(sess.OutputTokens),
				TotalTokens:  int(sess.TotalTokens),
				SpawnedBy:    sess.SpawnedBy,
			})
		}
	}

	// Sort by updatedAt descending (most recent first).
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].UpdatedAt > sessions[j].UpdatedAt
	})

	// Apply limit.
	if len(sessions) > limit {
		sessions = sessions[:limit]
	}

	// Compute totals.
	totalTokens := 0
	for _, s := range sessions {
		totalTokens += s.TotalTokens
	}

	if sessions == nil {
		sessions = []SessionEntry{}
	}

	writeJSON(w, http.StatusOK, GatewaySessionsResponse{
		Sessions:    sessions,
		Count:       len(sessions),
		TotalTokens: totalTokens,
	})
}

// GetStats handles GET /api/sessions/stats.
func (h *SessionsHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		h.logger.Error("failed to get home dir", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}

	agentsDir := filepath.Join(homeDir, ".openclaw", "agents")
	now := time.Now()

	entries, err := os.ReadDir(agentsDir)
	if err != nil {
		h.logger.Warn("agents dir not found", zap.String("path", agentsDir))
		writeJSON(w, http.StatusOK, SessionsStatsResponse{
			ByKind: map[string]int{"main": 0, "isolated": 0, "cron": 0, "global": 0},
		})
		return
	}

	stats := SessionsStatsResponse{
		ByKind: map[string]int{"main": 0, "isolated": 0, "cron": 0, "global": 0},
	}

	for _, agentEntry := range entries {
		if !agentEntry.IsDir() {
			continue
		}
		sessionsFile := filepath.Join(agentsDir, agentEntry.Name(), "sessions", "sessions.json")

		data, err := os.ReadFile(sessionsFile)
		if err != nil {
			continue
		}

		var raw map[string]rawSession
		if err := json.Unmarshal(data, &raw); err != nil {
			h.logger.Warn("failed to parse sessions.json",
				zap.String("agent", agentEntry.Name()), zap.Error(err))
			continue
		}

		for key, sess := range raw {
			updatedMs := int64(sess.UpdatedAt)
			if updatedMs == 0 {
				continue
			}

			stats.TotalSessions++
			stats.TotalTokens += int(sess.TotalTokens)

			updatedTime := time.UnixMilli(updatedMs)
			switch deriveStatus(updatedTime, now) {
			case "active":
				stats.ActiveCount++
			case "idle":
				stats.IdleCount++
			case "stale":
				stats.StaleCount++
			}

			stats.ByKind[deriveKind(key)]++
		}
	}

	writeJSON(w, http.StatusOK, stats)
}

// DeleteSession handles DELETE /api/sessions/{key}.
func (h *SessionsHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	rawKey := r.PathValue("key")
	if rawKey == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing session key"})
		return
	}

	key, err := url.PathUnescape(rawKey)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid session key"})
		return
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server error"})
		return
	}

	agentsDir := filepath.Join(homeDir, ".openclaw", "agents")
	entries, err := os.ReadDir(agentsDir)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "agents directory not found"})
		return
	}

	for _, agentEntry := range entries {
		if !agentEntry.IsDir() {
			continue
		}
		sessionsFile := filepath.Join(agentsDir, agentEntry.Name(), "sessions", "sessions.json")

		data, err := os.ReadFile(sessionsFile)
		if err != nil {
			continue
		}

		var raw map[string]json.RawMessage
		if err := json.Unmarshal(data, &raw); err != nil {
			continue
		}

		if _, exists := raw[key]; !exists {
			continue
		}

		// Found the session — delete it.
		delete(raw, key)

		updated, err := json.MarshalIndent(raw, "", "  ")
		if err != nil {
			h.logger.Error("failed to marshal sessions", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to update sessions file"})
			return
		}

		if err := os.WriteFile(sessionsFile, updated, 0644); err != nil {
			h.logger.Error("failed to write sessions file", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to write sessions file"})
			return
		}

		h.logger.Info("deleted session", zap.String("key", key), zap.String("agent", agentEntry.Name()))
		w.WriteHeader(http.StatusNoContent)
		return
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
}

// agentDirToName converts an agent directory name to a display name.
func agentDirToName(dir string) string {
	switch dir {
	case "developer":
		return "Developer"
	case "code-reviewer":
		return "Reviewer"
	case "tommy":
		return "Tommy"
	case "main":
		return "Main"
	case "ns-tester":
		return "Tester"
	case "content-editor":
		return "Editor"
	default:
		// Capitalise first letter of each word for unknown agents.
		return titleCase(dir)
	}
}

// deriveKind infers the session kind from the session key.
// Key formats: "agent:main:main", "agent:developer:subagent:uuid", "agent:tommy:cron:uuid"
func deriveKind(key string) string {
	switch {
	case strings.Contains(key, ":subagent:"):
		return "isolated"
	case strings.Contains(key, ":cron:"):
		return "cron"
	case strings.Contains(key, ":main:"):
		return "main"
	default:
		return "global"
	}
}

// deriveStatus returns "active", "idle", or "stale" based on last update time.
func deriveStatus(updatedAt, now time.Time) string {
	age := now.Sub(updatedAt)
	switch {
	case age < 5*time.Minute:
		return "active"
	case age < 60*time.Minute:
		return "idle"
	default:
		return "stale"
	}
}

// titleCase converts "foo-bar" → "Foo-Bar".
func titleCase(s string) string {
	if s == "" {
		return s
	}
	runes := []rune(s)
	capitalise := true
	for i, r := range runes {
		if capitalise && unicode.IsLetter(r) {
			runes[i] = unicode.ToUpper(r)
			capitalise = false
		} else if r == '-' || r == '_' || r == ' ' {
			capitalise = true
		}
	}
	return string(runes)
}
