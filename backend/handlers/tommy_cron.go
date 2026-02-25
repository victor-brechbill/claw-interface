package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
)

type TommyCronHandler struct {
	logger   *zap.Logger
	cronFile string
}

type cronJobsFile struct {
	Version int            `json:"version"`
	Jobs    []cronJobEntry `json:"jobs"`
}

type cronJobEntry struct {
	ID       string                 `json:"id"`
	Name     string                 `json:"name"`
	Enabled  bool                   `json:"enabled"`
	AgentID  string                 `json:"agentId,omitempty"`
	Schedule map[string]interface{} `json:"schedule"`
	State    map[string]interface{} `json:"state,omitempty"`
	Payload  map[string]interface{} `json:"payload,omitempty"`
}

func NewTommyCronHandler(logger *zap.Logger) *TommyCronHandler {
	homeDir, _ := os.UserHomeDir()
	return &TommyCronHandler{
		logger:   logger,
		cronFile: filepath.Join(homeDir, ".openclaw", "cron", "jobs.json"),
	}
}

func (h *TommyCronHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/tommy/cron", h.ListCronJobs)
	mux.HandleFunc("PUT /api/tommy/cron/{jobId}", h.UpdateCronJob)
	mux.HandleFunc("POST /api/tommy/cron/{jobId}/run", h.RunCronJob)
}

func (h *TommyCronHandler) loadTommyJobs() ([]cronJobEntry, error) {
	data, err := os.ReadFile(h.cronFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read cron file: %w", err)
	}

	var file cronJobsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, fmt.Errorf("failed to parse cron file: %w", err)
	}

	var tommyJobs []cronJobEntry
	for _, job := range file.Jobs {
		nameLower := strings.ToLower(job.Name)
		if strings.Contains(nameLower, "tommy") || job.AgentID == "tommy" {
			tommyJobs = append(tommyJobs, job)
		}
	}

	return tommyJobs, nil
}

func (h *TommyCronHandler) ListCronJobs(w http.ResponseWriter, r *http.Request) {
	jobs, err := h.loadTommyJobs()
	if err != nil {
		h.logger.Error("failed to load cron jobs", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to load cron jobs")
		return
	}

	if jobs == nil {
		jobs = []cronJobEntry{}
	}

	writeJSON(w, http.StatusOK, jobs)
}

func (h *TommyCronHandler) UpdateCronJob(w http.ResponseWriter, r *http.Request) {
	jobId := r.PathValue("jobId")
	if jobId == "" {
		writeError(w, http.StatusBadRequest, "jobId required")
		return
	}

	// Verify this is a Tommy job
	jobs, err := h.loadTommyJobs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load cron jobs")
		return
	}
	found := false
	for _, j := range jobs {
		if j.ID == jobId {
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "job not found or not a Tommy job")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body")
		return
	}

	var input struct {
		Schedule *struct {
			Expr string `json:"expr"`
			Tz   string `json:"tz"`
		} `json:"schedule,omitempty"`
		Enabled *bool `json:"enabled,omitempty"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	// Build openclaw cron edit command
	args := []string{"cron", "edit", jobId}

	if input.Schedule != nil {
		if input.Schedule.Expr != "" {
			args = append(args, "--cron", input.Schedule.Expr)
		}
		if input.Schedule.Tz != "" {
			args = append(args, "--tz", input.Schedule.Tz)
		}
	}
	if input.Enabled != nil {
		if *input.Enabled {
			args = append(args, "--enable")
		} else {
			args = append(args, "--disable")
		}
	}

	if len(args) <= 3 {
		writeError(w, http.StatusBadRequest, "no valid fields to update")
		return
	}

	cmd := exec.Command("openclaw", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		h.logger.Error("openclaw cron edit failed",
			zap.Error(err),
			zap.String("output", string(output)),
			zap.Strings("args", args))
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to update: %s", string(output)))
		return
	}

	h.logger.Info("updated cron job", zap.String("jobId", jobId), zap.Strings("args", args))
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated", "jobId": jobId})
}

func (h *TommyCronHandler) RunCronJob(w http.ResponseWriter, r *http.Request) {
	jobId := r.PathValue("jobId")
	if jobId == "" {
		writeError(w, http.StatusBadRequest, "jobId required")
		return
	}

	// Verify this is a Tommy job
	jobs, err := h.loadTommyJobs()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load cron jobs")
		return
	}
	found := false
	for _, j := range jobs {
		if j.ID == jobId {
			found = true
			break
		}
	}
	if !found {
		writeError(w, http.StatusNotFound, "job not found or not a Tommy job")
		return
	}

	cmd := exec.Command("openclaw", "cron", "run", jobId)
	output, err := cmd.CombinedOutput()
	if err != nil {
		h.logger.Error("openclaw cron run failed",
			zap.Error(err),
			zap.String("output", string(output)))
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("failed to run: %s", string(output)))
		return
	}

	h.logger.Info("triggered cron job", zap.String("jobId", jobId))
	writeJSON(w, http.StatusOK, map[string]string{"status": "triggered", "jobId": jobId})
}
