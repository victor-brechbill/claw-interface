package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	"go.uber.org/zap"
)

type InspectHandler struct {
	logger *zap.Logger
}

func NewInspectHandler(logger *zap.Logger) *InspectHandler {
	return &InspectHandler{
		logger: logger,
	}
}

// Allowlisted files only for security
var allowedFiles = map[string]string{
	// Nova workspace
	"agents":       "/home/ubuntu/clawd/AGENTS.md",
	"soul":         "/home/ubuntu/clawd/SOUL.md",
	"tools":        "/home/ubuntu/clawd/TOOLS.md",
	"user":         "/home/ubuntu/clawd/USER.md",
	"identity":     "/home/ubuntu/clawd/IDENTITY.md",
	"heartbeat":    "/home/ubuntu/clawd/HEARTBEAT.md",
	"memory":       "/home/ubuntu/clawd/MEMORY.md",
	"architecture": "/home/ubuntu/clawd/vault/dev/repos/dashboard/ARCHITECTURE.md",
	"sessions":     "/home/ubuntu/clawd/vault/dev/repos/dashboard/tommy/SESSIONS.md",

	// Developer workspace
	"dev-agents": "/home/ubuntu/clawd-developer/AGENTS.md",

	// Code Reviewer workspace
	"reviewer-agents": "/home/ubuntu/clawd-code-reviewer/AGENTS.md",

	// Tommy workspace
	"tommy-agents":         "/home/ubuntu/clawd-tommy/AGENTS.md",
	"tommy-soul":           "/home/ubuntu/clawd-tommy/SOUL.md",
	"tommy-tools":          "/home/ubuntu/clawd-tommy/TOOLS.md",
	"tommy-identity":       "/home/ubuntu/clawd-tommy/IDENTITY.md",
	"tommy-wins":           "/home/ubuntu/clawd-tommy/wins.md",
	"tommy-voice-examples": "/home/ubuntu/clawd-tommy/voice-examples.md",

	// Tommy cron session prompts
	"tommy-market-prompt":  "/home/ubuntu/clawd/vault/inspect-refs/tommy-market-session-prompt.md",
	"tommy-explore-prompt": "/home/ubuntu/clawd/vault/inspect-refs/tommy-explore-session-prompt.md",
	"tommy-hottake-prompt": "/home/ubuntu/clawd/vault/inspect-refs/tommy-hottake-session-prompt.md",

	// NS Testing
	"ns-testing-agents": "/home/ubuntu/clawd-ns-tester/AGENTS.md",
	"ns-testing-prompt": "/home/ubuntu/clawd/vault/inspect-refs/ns-daily-testing-prompt.md",
}

func (h *InspectHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/inspect/{file}", h.GetFile)
	mux.HandleFunc("PUT /api/inspect/{file}", h.SaveFile)
}

func (h *InspectHandler) GetFile(w http.ResponseWriter, r *http.Request) {
	file := r.PathValue("file")
	if file == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "file parameter is required"})
		return
	}

	// Check if file is in allowlist
	filePath, exists := allowedFiles[file]
	if !exists {
		h.logger.Warn("attempt to access non-allowlisted file",
			zap.String("file", file),
			zap.String("remote", r.RemoteAddr))
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "file not allowed",
			"file":  file,
		})
		return
	}

	// Resolve any symbolic links and clean path for extra security
	resolvedPath, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		// File might not exist or be a symlink, try the original path
		resolvedPath = filepath.Clean(filePath)
	}

	// Read file contents
	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		if os.IsNotExist(err) {
			h.logger.Debug("file not found",
				zap.String("file", file),
				zap.String("path", resolvedPath))
			writeJSON(w, http.StatusNotFound, map[string]string{
				"error": "file not found",
				"file":  file,
			})
			return
		}
		h.logger.Error("failed to read file",
			zap.Error(err),
			zap.String("file", file),
			zap.String("path", resolvedPath))
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "failed to read file",
		})
		return
	}

	h.logger.Debug("file served",
		zap.String("file", file),
		zap.String("path", resolvedPath),
		zap.Int("size", len(content)))

	// Return file content as JSON
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"file":    file,
		"path":    filePath, // Return the original path, not resolved
		"content": string(content),
		"size":    len(content),
	})
}

func (h *InspectHandler) SaveFile(w http.ResponseWriter, r *http.Request) {
	file := r.PathValue("file")
	if file == "" {
		writeError(w, http.StatusBadRequest, "file parameter is required")
		return
	}

	// Check if file is in allowlist
	filePath, exists := allowedFiles[file]
	if !exists {
		h.logger.Warn("attempt to write non-allowlisted file",
			zap.String("file", file),
			zap.String("remote", r.RemoteAddr))
		writeJSON(w, http.StatusForbidden, map[string]string{
			"error": "file not allowed",
			"file":  file,
		})
		return
	}

	// Limit request body to 2MB to prevent memory exhaustion.
	// Workspace config files are typically <100KB, so this provides
	// comfortable headroom while preventing DoS attacks.
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read request body")
		return
	}

	// Parse JSON payload
	var payload struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
		return
	}

	// Resolve symlinks (same as GetFile)
	resolvedPath, err := filepath.EvalSymlinks(filePath)
	if err != nil {
		resolvedPath = filepath.Clean(filePath)
	}

	// Atomic write: temp file in same directory, then rename
	dir := filepath.Dir(resolvedPath)
	base := filepath.Base(resolvedPath)
	tmpPath := filepath.Join(dir, "."+base+".tmp")

	if err := os.WriteFile(tmpPath, []byte(payload.Content), 0644); err != nil {
		h.logger.Error("failed to write temp file",
			zap.Error(err),
			zap.String("file", file),
			zap.String("tmpPath", tmpPath))
		writeError(w, http.StatusInternalServerError, "failed to write file")
		return
	}

	if err := os.Rename(tmpPath, resolvedPath); err != nil {
		os.Remove(tmpPath) // clean up on rename failure
		h.logger.Error("failed to rename temp file",
			zap.Error(err),
			zap.String("file", file),
			zap.String("tmpPath", tmpPath),
			zap.String("target", resolvedPath))
		writeError(w, http.StatusInternalServerError, "failed to save file")
		return
	}

	h.logger.Info("file saved via inspect",
		zap.String("file", file),
		zap.String("path", resolvedPath),
		zap.Int("size", len(payload.Content)),
		zap.String("remote", r.RemoteAddr))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"file":    file,
		"path":    filePath,
		"size":    len(payload.Content),
		"message": fmt.Sprintf("saved %s (%d bytes)", file, len(payload.Content)),
	})
}
