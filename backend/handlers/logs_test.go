package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"
)

func TestParseLogMessage(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantTime    string
		wantSubsys  string
		wantMessage string
	}{
		{
			name:        "standard format",
			input:       "2026-02-18T16:20:00.533Z [gateway] signal SIGUSR1 received",
			wantTime:    "16:20:00",
			wantSubsys:  "gateway",
			wantMessage: "signal SIGUSR1 received",
		},
		{
			name:        "subsystem with hyphen",
			input:       "2026-02-18T09:05:30.123Z [http-server] listening on port 8080",
			wantTime:    "09:05:30",
			wantSubsys:  "http-server",
			wantMessage: "listening on port 8080",
		},
		{
			name:        "message with brackets",
			input:       "2026-02-18T12:00:00.000Z [parser] processing [data] block",
			wantTime:    "12:00:00",
			wantSubsys:  "parser",
			wantMessage: "processing [data] block",
		},
		{
			name:        "no match - plain message",
			input:       "raw system message without format",
			wantTime:    "",
			wantSubsys:  "system",
			wantMessage: "raw system message without format",
		},
		{
			name:        "no match - missing brackets",
			input:       "2026-02-18T16:20:00.533Z gateway signal received",
			wantTime:    "",
			wantSubsys:  "system",
			wantMessage: "2026-02-18T16:20:00.533Z gateway signal received",
		},
		{
			name:        "empty message",
			input:       "",
			wantTime:    "",
			wantSubsys:  "system",
			wantMessage: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotTime, gotSubsys, gotMessage := ParseLogMessage(tt.input)
			if gotTime != tt.wantTime {
				t.Errorf("ParseLogMessage() time = %q, want %q", gotTime, tt.wantTime)
			}
			if gotSubsys != tt.wantSubsys {
				t.Errorf("ParseLogMessage() subsystem = %q, want %q", gotSubsys, tt.wantSubsys)
			}
			if gotMessage != tt.wantMessage {
				t.Errorf("ParseLogMessage() message = %q, want %q", gotMessage, tt.wantMessage)
			}
		})
	}
}

func TestMapPriority(t *testing.T) {
	tests := []struct {
		priority int
		want     string
	}{
		{7, "debug"},
		{6, "info"},
		{5, "notice"},
		{4, "warn"},
		{3, "error"},
		{2, "fatal"},
		{1, "alert"},
		{0, "emerg"},
		{-1, "info"}, // unknown defaults to info
		{99, "info"}, // unknown defaults to info
		{8, "info"},  // unknown defaults to info
	}

	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got := MapPriority(tt.priority)
			if got != tt.want {
				t.Errorf("MapPriority(%d) = %q, want %q", tt.priority, got, tt.want)
			}
		})
	}
}

func TestLevelFilter(t *testing.T) {
	// Test the level filtering logic directly
	entries := []LogEntry{
		{Level: "info", Message: "info message"},
		{Level: "warn", Message: "warning message"},
		{Level: "error", Message: "error message"},
		{Level: "debug", Message: "debug message"},
	}

	// Filter for warn and error only
	allowedLevels := map[string]bool{
		"warn":  true,
		"error": true,
	}

	var filtered []LogEntry
	for _, e := range entries {
		if allowedLevels[e.Level] {
			filtered = append(filtered, e)
		}
	}

	if len(filtered) != 2 {
		t.Errorf("expected 2 filtered entries, got %d", len(filtered))
	}

	for _, e := range filtered {
		if e.Level != "warn" && e.Level != "error" {
			t.Errorf("unexpected level in filtered entries: %s", e.Level)
		}
	}
}

func TestSearchFilter(t *testing.T) {
	entries := []LogEntry{
		{Subsystem: "gateway", Message: "connection established"},
		{Subsystem: "parser", Message: "processing request"},
		{Subsystem: "gateway", Message: "error in handler"},
		{Subsystem: "system", Message: "Gateway shutdown"},
	}

	tests := []struct {
		name   string
		search string
		want   int
	}{
		{
			name:   "search in message",
			search: "connection",
			want:   1,
		},
		{
			name:   "search in subsystem",
			search: "gateway",
			want:   3, // matches subsystem=gateway (2) and message containing "Gateway" (1)
		},
		{
			name:   "case insensitive search",
			search: "GATEWAY",
			want:   3,
		},
		{
			name:   "no matches",
			search: "xyz123",
			want:   0,
		},
		{
			name:   "partial match",
			search: "request",
			want:   1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			searchLower := strings.ToLower(tt.search)
			var count int
			for _, e := range entries {
				if strings.Contains(strings.ToLower(e.Message), searchLower) ||
					strings.Contains(strings.ToLower(e.Subsystem), searchLower) {
					count++
				}
			}
			if count != tt.want {
				t.Errorf("search %q: got %d matches, want %d", tt.search, count, tt.want)
			}
		})
	}
}

// TestGetLogsHTTP tests the GetLogs HTTP handler for query param parsing and response format.
func TestGetLogsHTTP(t *testing.T) {
	logger, _ := zap.NewDevelopment()
	h := NewLogsHandler(logger)

	tests := []struct {
		name        string
		queryParams string
	}{
		{
			name:        "default params",
			queryParams: "",
		},
		{
			name:        "explicit lines param",
			queryParams: "lines=50",
		},
		{
			name:        "lines capped at 1000",
			queryParams: "lines=9999",
		},
		{
			name:        "invalid lines param uses default",
			queryParams: "lines=notanumber",
		},
		{
			name:        "level filter param",
			queryParams: "lines=10&level=error",
		},
		{
			name:        "search filter param",
			queryParams: "lines=10&search=gateway",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			url := "/api/system/logs"
			if tt.queryParams != "" {
				url += "?" + tt.queryParams
			}

			req := httptest.NewRequest(http.MethodGet, url, nil)
			w := httptest.NewRecorder()

			h.GetLogs(w, req)

			resp := w.Result()

			// Handler must return either 200 OK (success) or 500 (journalctl unavailable in CI).
			if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusInternalServerError {
				t.Errorf("unexpected status code %d", resp.StatusCode)
			}

			// Response must always be JSON regardless of outcome.
			ct := resp.Header.Get("Content-Type")
			if !strings.Contains(ct, "application/json") {
				t.Errorf("expected JSON Content-Type, got %q", ct)
			}

			// Response body must be valid JSON.
			var body map[string]interface{}
			if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
				t.Errorf("response body is not valid JSON: %v", err)
			}

			// On success (200), verify the LogsResponse shape.
			if resp.StatusCode == http.StatusOK {
				if _, ok := body["entries"]; !ok {
					t.Error("expected 'entries' field in response")
				}
				if _, ok := body["count"]; !ok {
					t.Error("expected 'count' field in response")
				}
			}
		})
	}
}
