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

func kernelDir() string {
	if dir := os.Getenv("KERNEL_DIR"); dir != "" {
		return dir
	}
	return filepath.Join(os.Getenv("HOME"), "clawd")
}

type InspectHandler struct {
	logger *zap.Logger
}

func NewInspectHandler(logger *zap.Logger) *InspectHandler {
	return &InspectHandler{
		logger: logger,
	}
}

// Allowlisted files only for security.
// Paths are resolved from KERNEL_DIR (env) or $HOME/clawd.
var allowedFiles = buildAllowedFiles()

func buildAllowedFiles() map[string]string {
	kd := kernelDir()
	return map[string]string{
		"agents":    filepath.Join(kd, "AGENTS.md"),
		"tools":     filepath.Join(kd, "TOOLS.md"),
		"heartbeat": filepath.Join(kd, "HEARTBEAT.md"),
		"soul":      filepath.Join(kd, "SOUL.md"),
		"identity":  filepath.Join(kd, "IDENTITY.md"),
		"user":      filepath.Join(kd, "USER.md"),
		"memory":    filepath.Join(kd, "MEMORY.md"),
	}
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
