package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.uber.org/zap"
)

// LogEntry represents a parsed log entry from journalctl
type LogEntry struct {
	Time      string `json:"time"`
	Level     string `json:"level"`
	Subsystem string `json:"subsystem"`
	Message   string `json:"message"`
	Raw       string `json:"raw"`
}

// LogsResponse is the API response for GET /api/system/logs
type LogsResponse struct {
	Entries []LogEntry `json:"entries"`
	Cursor  string     `json:"cursor"`
	Count   int        `json:"count"`
}

// journalEntry represents the raw JSON output from journalctl
type journalEntry struct {
	Message           string `json:"MESSAGE"`
	Priority          string `json:"PRIORITY"`
	Cursor            string `json:"__CURSOR"`
	RealtimeTimestamp string `json:"__REALTIME_TIMESTAMP"`
}

// fileLogEntry represents the JSON log format written by OpenClaw to /tmp/openclaw/
type fileLogEntry struct {
	Subsystem string `json:"0"` // e.g. '{"subsystem":"gateway"}'
	Message   string `json:"1"` // the log message
	Time      string `json:"time"`
	Meta      struct {
		Date         string `json:"date"`
		LogLevelName string `json:"logLevelName"` // DEBUG, INFO, WARN, ERROR, FATAL
	} `json:"_meta"`
}

// LogsHandler handles log-related API endpoints
type LogsHandler struct {
	logger *zap.Logger
}

// NewLogsHandler creates a new LogsHandler
func NewLogsHandler(logger *zap.Logger) *LogsHandler {
	return &LogsHandler{logger: logger}
}

// RegisterRoutes registers the logs API routes
func (h *LogsHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/system/logs", h.GetLogs)
}

// messageRegex matches log messages in format: "2026-02-18T16:20:00.533Z [subsystem] message"
var messageRegex = regexp.MustCompile(`^(\S+)\s+\[(\w[\w-]*)\]\s+(.+)`)

// ParseLogMessage extracts time, subsystem, and message from a log MESSAGE
// Exported for testing
func ParseLogMessage(msg string) (time, subsystem, message string) {
	matches := messageRegex.FindStringSubmatch(msg)
	if matches == nil {
		return "", "system", msg
	}

	timestamp := matches[1]
	subsystem = matches[2]
	message = matches[3]

	// Extract HH:MM:SS from ISO timestamp
	if len(timestamp) >= 19 && timestamp[10] == 'T' {
		time = timestamp[11:19]
	}

	return time, subsystem, message
}

// MapPriority converts syslog priority to level string
// Exported for testing
func MapPriority(priority int) string {
	switch priority {
	case 7:
		return "debug"
	case 6:
		return "info"
	case 5:
		return "notice"
	case 4:
		return "warn"
	case 3:
		return "error"
	case 2:
		return "fatal"
	case 1:
		return "alert"
	case 0:
		return "emerg"
	default:
		return "info"
	}
}

// mapFileLogLevel converts OpenClaw file log level names to our level strings
func mapFileLogLevel(level string) string {
	switch strings.ToUpper(level) {
	case "DEBUG", "TRACE", "SILLY":
		return "debug"
	case "INFO":
		return "info"
	case "WARN", "WARNING":
		return "warn"
	case "ERROR":
		return "error"
	case "FATAL":
		return "fatal"
	default:
		return "info"
	}
}

// parseFileLogSubsystem extracts the subsystem name from the JSON-encoded field
// e.g. '{"subsystem":"gateway"}' -> "gateway"
func parseFileLogSubsystem(raw string) string {
	var s struct {
		Subsystem string `json:"subsystem"`
	}
	if err := json.Unmarshal([]byte(raw), &s); err == nil && s.Subsystem != "" {
		return s.Subsystem
	}
	return "system"
}

// findLogFile returns the path to today's OpenClaw log file
func findLogFile() string {
	today := time.Now().UTC().Format("2006-01-02")
	path := filepath.Join("/tmp/openclaw", fmt.Sprintf("openclaw-%s.log", today))
	if _, err := os.Stat(path); err == nil {
		return path
	}
	// Try glob for any recent log file
	matches, err := filepath.Glob("/tmp/openclaw/openclaw-*.log")
	if err != nil || len(matches) == 0 {
		return ""
	}
	sort.Strings(matches)
	return matches[len(matches)-1] // most recent
}

// GetLogs handles GET /api/system/logs
// It reads from both journalctl (systemd) and the OpenClaw file log, preferring
// whichever has more recent data. This handles the case where the gateway runs
// outside of systemd (e.g. after a SIGUSR1 restart or manual start).
func (h *LogsHandler) GetLogs(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	lines := 200
	if v := r.URL.Query().Get("lines"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			if n > 1000 {
				n = 1000
			}
			lines = n
		}
	}

	cursor := r.URL.Query().Get("cursor")
	levelFilter := r.URL.Query().Get("level")
	searchFilter := r.URL.Query().Get("search")

	// Parse allowed levels
	allowedLevels := make(map[string]bool)
	if levelFilter != "" {
		for _, lvl := range strings.Split(levelFilter, ",") {
			allowedLevels[strings.TrimSpace(lvl)] = true
		}
	}
	searchLower := strings.ToLower(searchFilter)

	// Determine source: cursor prefix tells us which source to continue from
	// "file:<basename>:<lineOffset>" = file log, "jrnl:<journalCursor>" = journalctl, "" = initial load
	useFile := false
	fileCursor := 0
	fileCursorName := ""
	journalCursor := ""

	if strings.HasPrefix(cursor, "file:") {
		useFile = true
		// Format: "file:<basename>:<lineOffset>" or legacy "file:<lineOffset>"
		rest := strings.TrimPrefix(cursor, "file:")
		parts := strings.SplitN(rest, ":", 2)
		if len(parts) == 2 {
			fileCursorName = parts[0]
			fileCursor, _ = strconv.Atoi(parts[1])
		} else {
			fileCursor, _ = strconv.Atoi(rest)
		}
	} else if strings.HasPrefix(cursor, "jrnl:") {
		journalCursor = strings.TrimPrefix(cursor, "jrnl:")
	} else if cursor != "" {
		journalCursor = cursor
	}

	// Helper to build a file cursor string
	makeFileCursor := func(logFile string, lineNum int) string {
		return fmt.Sprintf("file:%s:%d", filepath.Base(logFile), lineNum)
	}

	// For initial load (no cursor), try file log first since it's always up-to-date
	if cursor == "" {
		logFile := findLogFile()
		if logFile != "" {
			entries, newCursor := h.readFileLog(logFile, lines, 0, allowedLevels, searchLower)
			if len(entries) > 0 {
				writeJSON(w, http.StatusOK, LogsResponse{
					Entries: entries,
					Cursor:  makeFileCursor(logFile, newCursor),
					Count:   len(entries),
				})
				return
			}
		}
		// Fall through to journalctl if file log is empty
	}

	if useFile {
		logFile := findLogFile()
		if logFile == "" {
			writeJSON(w, http.StatusOK, LogsResponse{Entries: []LogEntry{}, Count: 0})
			return
		}

		// Detect file rollover (new day) — reset cursor to 0 for the new file
		cursorForFile := fileCursor
		if fileCursorName != "" && fileCursorName != filepath.Base(logFile) {
			cursorForFile = 0
		}

		entries, newCursor := h.readFileLog(logFile, lines, cursorForFile, allowedLevels, searchLower)
		writeJSON(w, http.StatusOK, LogsResponse{
			Entries: entries,
			Cursor:  makeFileCursor(logFile, newCursor),
			Count:   len(entries),
		})
		return
	}

	// Journalctl path
	h.getLogsFromJournalctl(w, r, lines, journalCursor, allowedLevels, searchLower)
}

// readFileLog reads entries from the OpenClaw file log
// afterLine=0 means read last N lines; afterLine>0 means read lines after that offset
// Returns entries and the new line cursor
func (h *LogsHandler) readFileLog(path string, limit int, afterLine int, allowedLevels map[string]bool, searchLower string) ([]LogEntry, int) {
	f, err := os.Open(path)
	if err != nil {
		return nil, afterLine
	}
	defer f.Close()

	// Read all lines (file is typically <10K lines per day)
	var allLines []string
	scanner := bufio.NewScanner(f)
	// Increase buffer for long log lines
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, 1024*1024)
	for scanner.Scan() {
		allLines = append(allLines, scanner.Text())
	}

	totalLines := len(allLines)

	var startLine int
	if afterLine > 0 {
		// Read new lines after the cursor
		startLine = afterLine
		if startLine >= totalLines {
			// No new lines
			return []LogEntry{}, totalLines
		}
	} else {
		// Initial load: scan enough lines to find N non-debug entries
		// The file is mostly DEBUG (~90%), so scan 10x the limit
		scanLines := limit * 10
		if scanLines < 500 {
			scanLines = 500
		}
		startLine = totalLines - scanLines
		if startLine < 0 {
			startLine = 0
		}
	}

	var entries []LogEntry
	for i := startLine; i < totalLines; i++ {
		line := allLines[i]
		if line == "" {
			continue
		}

		var fe fileLogEntry
		if err := json.Unmarshal([]byte(line), &fe); err != nil {
			continue
		}

		level := mapFileLogLevel(fe.Meta.LogLevelName)

		// Apply level filter (no default filtering - show everything)
		if len(allowedLevels) > 0 && !allowedLevels[level] {
			continue
		}

		message := fe.Message
		subsystem := parseFileLogSubsystem(fe.Subsystem)

		// Some log entries store the message in field "0" with no "1" field
		// (agent output, tool results, etc). Fall back to "0" as the message.
		if message == "" && fe.Subsystem != "" {
			message = fe.Subsystem
			subsystem = "agent"
			// Try to extract [subsystem] prefix from the message itself
			if matches := messageRegex.FindStringSubmatch(message); matches != nil {
				subsystem = matches[2]
				message = matches[3]
			}
		}

		// Skip empty or obviously-noisy messages
		if message == "" {
			continue
		}
		// Skip bare version strings (e.g. "2026.2.16") and raw JSON blobs
		if strings.HasPrefix(message, "{") || strings.HasPrefix(message, "[") {
			continue
		}

		// Apply search filter
		if searchLower != "" {
			if !strings.Contains(strings.ToLower(message), searchLower) &&
				!strings.Contains(strings.ToLower(subsystem), searchLower) {
				continue
			}
		}

		// Extract HH:MM:SS from timestamp
		timeStr := ""
		ts := fe.Time
		if ts == "" {
			ts = fe.Meta.Date
		}
		if len(ts) >= 19 && ts[10] == 'T' {
			timeStr = ts[11:19]
		}

		entries = append(entries, LogEntry{
			Time:      timeStr,
			Level:     level,
			Subsystem: subsystem,
			Message:   message,
			Raw:       fe.Message,
		})
	}

	if entries == nil {
		entries = []LogEntry{}
	}

	// For initial loads, return only the last N entries (newest)
	if afterLine == 0 && len(entries) > limit {
		entries = entries[len(entries)-limit:]
	}

	return entries, totalLines
}

// getLogsFromJournalctl reads logs from journalctl (legacy/fallback)
func (h *LogsHandler) getLogsFromJournalctl(w http.ResponseWriter, r *http.Request, lines int, cursor string, allowedLevels map[string]bool, searchLower string) {
	args := []string{
		"--user",
		"-u", "openclaw-gateway",
		"--output=json",
		"--no-pager",
		"-n", strconv.Itoa(lines),
	}

	if cursor != "" {
		args = append(args, "--after-cursor="+cursor)
	}

	cmd := exec.CommandContext(r.Context(), "journalctl", args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		h.logger.Error("failed to create stdout pipe", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to read logs")
		return
	}

	if err := cmd.Start(); err != nil {
		h.logger.Error("failed to start journalctl", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to read logs")
		return
	}

	var entries []LogEntry
	var lastCursor string

	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}

		var je journalEntry
		if err := json.Unmarshal([]byte(line), &je); err != nil {
			continue
		}

		// Parse priority
		priority := 6 // default to info
		if je.Priority != "" {
			if p, err := strconv.Atoi(je.Priority); err == nil {
				priority = p
			}
		}
		level := MapPriority(priority)

		// Apply level filter
		if len(allowedLevels) > 0 && !allowedLevels[level] {
			continue
		}

		// Parse message
		timeStr, subsystem, message := ParseLogMessage(je.Message)

		// Apply search filter
		if searchLower != "" {
			if !strings.Contains(strings.ToLower(message), searchLower) &&
				!strings.Contains(strings.ToLower(subsystem), searchLower) {
				continue
			}
		}

		entries = append(entries, LogEntry{
			Time:      timeStr,
			Level:     level,
			Subsystem: subsystem,
			Message:   message,
			Raw:       je.Message,
		})

		lastCursor = je.Cursor
	}

	// Wait for command to finish
	if err := cmd.Wait(); err != nil {
		h.logger.Warn("journalctl command finished with error", zap.Error(err))
	}

	if entries == nil {
		entries = []LogEntry{}
	}

	cursorStr := ""
	if lastCursor != "" {
		cursorStr = "jrnl:" + lastCursor
	}

	writeJSON(w, http.StatusOK, LogsResponse{
		Entries: entries,
		Cursor:  cursorStr,
		Count:   len(entries),
	})
}
