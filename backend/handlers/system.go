package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.uber.org/zap"

	"agent-dashboard/models"
)

type SystemHandler struct {
	logger           *zap.Logger
	doctorCollection *mongo.Collection
	doctorMutex      sync.Mutex
	lastDoctorRun    time.Time
	isDoctorRunning  bool
	// OAuth refresh
	oauthRefreshMutex    sync.Mutex
	oauthRefreshCmd      *exec.Cmd
	isOAuthRefreshActive bool
	oauthDir             string             // dedicated working directory for OAuth refresh files
	oauthRefreshScript   string             // path to oauth-refresh-interactive.py (defaults to defaultOAuthRefreshScript)
	shutdownCtx          context.Context    // cancelled on server shutdown
	shutdownCancel       context.CancelFunc // triggers shutdown cancellation
}

const (
	oauthStateFile            = "state.json"
	oauthCodeFile             = "code.txt"
	oauthCodeTmpFile          = "code.txt.tmp"
	oauthLogFile              = "refresh.log"
	oauthRefreshTimeout       = 5 * time.Minute
	defaultOAuthRefreshScript = "/home/ubuntu/clawd/scripts/oauth-refresh-interactive.py"
)

type SystemStatsResponse struct {
	Uptime    string `json:"uptime"`
	DiskUsage string `json:"diskUsage"`
	MemUsage  string `json:"memUsage"`
	IPAddress string `json:"ipAddress"`
}

type PeakMetricsResponse struct {
	PeakCPU    float64   `json:"peakCpu"`
	PeakRAM    string    `json:"peakRam"`
	OOMEvents  int       `json:"oomEvents"`
	CurrentCPU float64   `json:"currentCpu"`
	CurrentRAM string    `json:"currentRam"`
	LoadAvg    []float64 `json:"loadAvg"` // 1min, 5min, 15min
	Timestamp  time.Time `json:"timestamp"`
}

type CronJobStatus struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Schedule  string    `json:"schedule"`
	Timezone  string    `json:"timezone,omitempty"`
	LastRunAt time.Time `json:"lastRunAt"`
	Status    string    `json:"status"` // "healthy", "failed", or "never"
	NextRunAt time.Time `json:"nextRunAt"`
	Enabled   bool      `json:"enabled"`
	AgentID   string    `json:"agentId,omitempty"`
}

type CronHistoryResponse struct {
	Jobs      []CronJobStatus `json:"jobs"`
	Timestamp time.Time       `json:"timestamp"`
}

type ActivityWindow struct {
	WindowStart   time.Time `json:"windowStart"`
	WindowEnd     time.Time `json:"windowEnd"`
	ActivityCount int       `json:"activityCount"`
}

type ActivityGridResponse struct {
	AgentID   string           `json:"agentId"`
	Windows   []ActivityWindow `json:"windows"`
	Timestamp time.Time        `json:"timestamp"`
}

type AgentSession struct {
	SessionKey  string    `json:"sessionKey"`
	AgentID     string    `json:"agentId"`
	Label       string    `json:"label,omitempty"`
	Channel     string    `json:"channel"`
	Status      string    `json:"status"`
	CurrentTask string    `json:"currentTask,omitempty"`
	Expression  string    `json:"expression,omitempty"`
	LastActive  time.Time `json:"lastActive"`
}

type AgentsResponse struct {
	Agents    []AgentSession `json:"agents"`
	Timestamp time.Time      `json:"timestamp"`
}

type FileTokenInfo struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Tokens int    `json:"tokens"`
}

type ContextInfo struct {
	TotalTokens     int             `json:"total_tokens"`
	StaticTokens    int             `json:"static_tokens"`
	AvailableTokens int             `json:"available_tokens"`
	Files           []FileTokenInfo `json:"files"`
	Warnings        []string        `json:"warnings"`
	LastUpdated     time.Time       `json:"last_updated"`
}

type DomainSSLInfo struct {
	Domain            string    `json:"domain"`
	SSLExpiry         string    `json:"sslExpiry"`
	SSLDaysRemaining  int       `json:"sslDaysRemaining"`
	CloudflareStatus  string    `json:"cloudflareStatus"`
	DNSStatus         string    `json:"dnsStatus"`
	TunnelStatus      string    `json:"tunnelStatus"`
	TunnelConnections int       `json:"tunnelConnections"`
	Timestamp         time.Time `json:"timestamp"`
}

type OAuthRefreshStatus struct {
	State     string `json:"state"`
	AuthURL   string `json:"authUrl,omitempty"`
	Error     string `json:"error,omitempty"`
	Message   string `json:"message"`
	StartedAt string `json:"startedAt,omitempty"`
	UpdatedAt string `json:"updatedAt,omitempty"`
	Active    bool   `json:"active"`
}

func NewSystemHandler(logger *zap.Logger, doctorCollection *mongo.Collection) *SystemHandler {
	ctx, cancel := context.WithCancel(context.Background())
	return &SystemHandler{
		logger:           logger,
		doctorCollection: doctorCollection,
		shutdownCtx:      ctx,
		shutdownCancel:   cancel,
	}
}

// oauthRefreshDir returns the directory for OAuth refresh working files,
// creating it with 0700 permissions if it does not exist.
func (h *SystemHandler) oauthRefreshDir() (string, error) {
	if h.oauthDir != "" {
		return h.oauthDir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home directory: %w", err)
	}
	dir := filepath.Join(home, ".agent-dashboard", "oauth-refresh")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", fmt.Errorf("cannot create oauth refresh directory: %w", err)
	}
	h.oauthDir = dir
	return dir, nil
}

// Shutdown cancels any in-flight OAuth refresh process and releases resources.
func (h *SystemHandler) Shutdown() {
	h.shutdownCancel()

	h.oauthRefreshMutex.Lock()
	defer h.oauthRefreshMutex.Unlock()

	if h.oauthRefreshCmd != nil && h.oauthRefreshCmd.Process != nil {
		h.oauthRefreshCmd.Process.Kill()
		h.oauthRefreshCmd = nil
		h.isOAuthRefreshActive = false
	}
}

// extractSubagentStatus reads a live status file (one-liner) or falls back to dev status file
func extractSubagentStatus(label string) string {
	if label == "" {
		return ""
	}

	// Extract ticket ID from label (e.g., "TASK-011-approval-workflow" -> "TASK-011")
	parts := strings.SplitN(label, "-", 3)
	if len(parts) < 2 {
		return ""
	}
	ticketID := parts[0] + "-" + parts[1] // e.g., "TASK-011"

	// First try the live status file (simple one-liner, updated frequently)
	liveFile := fmt.Sprintf("/home/ubuntu/clawd/coding/status/%s-live.txt", ticketID)
	if liveData, err := os.ReadFile(liveFile); err == nil {
		status := strings.TrimSpace(string(liveData))
		if status != "" {
			if len(status) > 80 {
				return status[:77] + "..."
			}
			return status
		}
	}

	// Fall back to parsing the dev status file
	statusFile := fmt.Sprintf("/home/ubuntu/clawd/coding/status/%s-dev.md", ticketID)
	data, err := os.ReadFile(statusFile)
	if err != nil {
		return ""
	}

	content := string(data)
	lines := strings.Split(content, "\n")

	// Look for status line or last checked progress item
	var lastChecked string
	var statusLine string

	for _, line := range lines {
		line = strings.TrimSpace(line)

		// Look for "**Status:**" line
		if strings.HasPrefix(line, "**Status:**") {
			statusLine = strings.TrimPrefix(line, "**Status:**")
			statusLine = strings.TrimSpace(statusLine)
		}

		// Track last completed checkbox
		if strings.HasPrefix(line, "- [x]") {
			lastChecked = strings.TrimPrefix(line, "- [x]")
			lastChecked = strings.TrimSpace(lastChecked)
		}

		// Also check for "## ✅ COMPLETED" markers
		if strings.Contains(line, "COMPLETED") {
			return "✅ Completed"
		}
	}

	// Prefer status line if available
	if statusLine != "" {
		if len(statusLine) > 60 {
			return statusLine[:57] + "..."
		}
		return statusLine
	}

	// Fall back to last checked item
	if lastChecked != "" {
		result := "✓ " + lastChecked
		if len(result) > 60 {
			return result[:57] + "..."
		}
		return result
	}

	return "Working..."
}

func (h *SystemHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/system/stats", h.Stats)
	mux.HandleFunc("GET /api/system/agents", h.Agents)

	// Enhanced metrics endpoints
	mux.HandleFunc("GET /api/system/metrics/peaks", h.PeakMetrics)
	mux.HandleFunc("GET /api/system/cron-history", h.CronHistory)
	mux.HandleFunc("GET /api/system/cron-runs", h.CronRuns)
	mux.HandleFunc("GET /api/system/activity-grid", h.ActivityGrid)
	mux.HandleFunc("GET /api/system/domain-ssl", h.DomainSSL)

	// Reset endpoints
	mux.HandleFunc("POST /api/system/reset-server", h.ResetServer)
	mux.HandleFunc("POST /api/system/reset-gateway", h.ResetGateway)

	// Doctor endpoints
	mux.HandleFunc("POST /api/system/doctor", h.RunDoctor)
	mux.HandleFunc("GET /api/system/doctor/status", h.DoctorStatus)
	mux.HandleFunc("GET /api/system/doctor/report", h.DoctorReport)

	// Kernel endpoints
	mux.HandleFunc("GET /api/system/kernel-info", h.KernelInfo)
	mux.HandleFunc("POST /api/system/kernel-rollback", h.KernelRollback)

	// Config endpoints
	mux.HandleFunc("GET /api/system/config-info", h.ConfigInfo)
	mux.HandleFunc("POST /api/system/config-rollback", h.ConfigRollback)
	mux.HandleFunc("POST /api/system/config-backup", h.ConfigBackup)
	mux.HandleFunc("GET /api/system/config-rollforward-available", h.ConfigRollForwardAvailable)
	mux.HandleFunc("POST /api/system/config-rollforward", h.ConfigRollForward)

	// Context Manager endpoint
	mux.HandleFunc("GET /api/agent/context", h.ContextInfo)

	// OAuth refresh endpoints
	mux.HandleFunc("POST /api/system/oauth-refresh/start", h.OAuthRefreshStart)
	mux.HandleFunc("POST /api/system/oauth-refresh/code", h.OAuthRefreshCode)
	mux.HandleFunc("GET /api/system/oauth-refresh/status", h.OAuthRefreshStatus)
	mux.HandleFunc("GET /api/system/oauth-refresh/log", h.OAuthRefreshLog)

	// Token status endpoint
	mux.HandleFunc("GET /api/system/token-status", h.TokenStatus)
}

func (h *SystemHandler) Stats(w http.ResponseWriter, r *http.Request) {
	stats := SystemStatsResponse{}

	// Uptime
	if out, err := exec.Command("uptime", "-p").Output(); err == nil {
		stats.Uptime = strings.TrimSpace(string(out))
	}

	// Disk usage
	if out, err := exec.Command("df", "-h", "--output=pcent", "/").Output(); err == nil {
		lines := strings.Split(strings.TrimSpace(string(out)), "\n")
		if len(lines) > 1 {
			stats.DiskUsage = strings.TrimSpace(lines[1])
		}
	}

	// Memory usage
	if out, err := exec.Command("free", "-h", "--si").Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "Mem:") {
				fields := strings.Fields(line)
				if len(fields) >= 3 {
					stats.MemUsage = fmt.Sprintf("%s / %s", fields[2], fields[1])
				}
			}
		}
	}

	// Public IP address (for SSH access)
	if out, err := exec.Command("curl", "-s", "--max-time", "3", "ifconfig.me").Output(); err == nil {
		ip := strings.TrimSpace(string(out))
		if ip != "" && len(ip) < 50 { // Basic validation
			stats.IPAddress = ip
		}
	}

	writeJSON(w, http.StatusOK, stats)
}

// Agents returns currently active Clawdbot sessions
func (h *SystemHandler) Agents(w http.ResponseWriter, r *http.Request) {
	response := AgentsResponse{
		Agents:    []AgentSession{},
		Timestamp: time.Now().UTC(),
	}

	// Session file type
	type sessionEntry struct {
		SessionID  string `json:"sessionId"`
		UpdatedAt  int64  `json:"updatedAt"`
		SystemSent bool   `json:"systemSent"`
		Label      string `json:"label"`
	}

	// Collect sessions from all agent session files
	sessionsMap := make(map[string]sessionEntry)

	sessionsFiles := []string{
		"/home/ubuntu/.openclaw/agents/main/sessions/sessions.json",
		"/home/ubuntu/.openclaw/agents/developer/sessions/sessions.json",
		"/home/ubuntu/.openclaw/agents/code-reviewer/sessions/sessions.json",
		"/home/ubuntu/.openclaw/agents/tommy/sessions/sessions.json",
	}

	for _, sessionsFile := range sessionsFiles {
		data, err := os.ReadFile(sessionsFile)
		if err != nil {
			continue // Skip files that don't exist
		}

		var fileSessions map[string]sessionEntry
		if err := json.Unmarshal(data, &fileSessions); err != nil {
			h.logger.Warn("failed to parse sessions JSON", zap.String("file", sessionsFile), zap.Error(err))
			continue
		}

		// Merge into main map
		for k, v := range fileSessions {
			sessionsMap[k] = v
		}
	}

	h.logger.Info("parsed sessions", zap.Int("count", len(sessionsMap)))

	now := time.Now().UnixMilli()

	// Convert to our format (only sessions active in last 30 minutes)
	for key, s := range sessionsMap {
		ageMs := now - s.UpdatedAt

		h.logger.Debug("checking session", zap.String("key", key), zap.Int64("updatedAt", s.UpdatedAt), zap.Int64("ageMs", ageMs))

		// Skip sessions older than 30 minutes
		if ageMs > 30*60*1000 {
			continue
		}

		// Parse key to extract agent info (format: "agent:main:channel:id" or "agent:main:main")
		parts := strings.Split(key, ":")
		agentID := "unknown"
		channel := "system"

		if len(parts) >= 2 {
			agentID = parts[1] // e.g., "main"
		}
		if len(parts) >= 3 {
			channel = parts[2] // e.g., "main" or "cron" or "telegram"
		}

		// Calculate last active time from updatedAt (milliseconds)
		lastActive := time.UnixMilli(s.UpdatedAt)

		// Determine status based on age
		status := "active"
		if ageMs > 2*60*1000 { // > 2 minutes
			status = "idle"
		}
		if ageMs > 5*60*1000 { // > 5 minutes
			status = "inactive"
		}

		// Try to read current task from status file
		currentTask := ""

		// For sub-agents, read from their dev status files
		if strings.Contains(key, "subagent") && s.Label != "" {
			currentTask = extractSubagentStatus(s.Label)
		} else {
			// For main agent, read from status.txt
			statusFile := fmt.Sprintf("/home/ubuntu/.openclaw/agents/%s/status.txt", agentID)
			if taskData, err := os.ReadFile(statusFile); err == nil {
				currentTask = strings.TrimSpace(string(taskData))
				// Truncate if too long
				if len(currentTask) > 120 {
					currentTask = currentTask[:117] + "..."
				}
			}
		}

		// Try to read expression from expression file (explicit control)
		expression := ""
		expressionFile := fmt.Sprintf("/home/ubuntu/.openclaw/agents/%s/expression.txt", agentID)
		if exprData, err := os.ReadFile(expressionFile); err == nil {
			expression = strings.TrimSpace(string(exprData))
			// Validate expression (only allow known values)
			validExpressions := map[string]bool{
				"neutral": true, "happy": true, "curious": true,
				"busy": true, "sleepy": true, "surprised": true,
			}
			if !validExpressions[expression] {
				expression = "" // Invalid expression, let frontend decide
			}
		}

		agent := AgentSession{
			SessionKey:  key,
			AgentID:     agentID,
			Label:       s.Label,
			Channel:     channel,
			Status:      status,
			LastActive:  lastActive,
			CurrentTask: currentTask,
			Expression:  expression,
		}

		response.Agents = append(response.Agents, agent)
	}

	writeJSON(w, http.StatusOK, response)
}

// ResetServer triggers a server reboot via `sudo reboot`
func (h *SystemHandler) ResetServer(w http.ResponseWriter, r *http.Request) {
	h.logger.Info("reset server requested", zap.String("remote", r.RemoteAddr))

	// Execute sudo reboot command
	cmd := exec.Command("sudo", "reboot")
	err := cmd.Start()

	if err != nil {
		h.logger.Error("failed to execute reboot command", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Failed to execute reboot command: " + err.Error(),
		})
		return
	}

	h.logger.Info("reboot command initiated successfully")
	writeJSON(w, http.StatusOK, map[string]string{
		"message": "Server reboot initiated successfully",
		"note":    "Connection will be lost momentarily",
	})
}

// ResetGateway restarts the Clawdbot gateway using proper sequence
func (h *SystemHandler) ResetGateway(w http.ResponseWriter, r *http.Request) {
	h.logger.Info("reset gateway requested", zap.String("remote", r.RemoteAddr))

	// Step 1: Stop the service FIRST (prevents auto-restart)
	stopCmd := exec.Command("systemctl", "--user", "stop", "openclaw-gateway.service")
	if err := stopCmd.Run(); err != nil {
		h.logger.Error("failed to stop gateway service", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Failed to stop gateway service: " + err.Error(),
		})
		return
	}

	// Step 2: Kill any remaining processes
	killCmd := exec.Command("pkill", "-9", "-f", "openclaw")
	_ = killCmd.Run() // Don't fail if no processes found

	// Step 3: Wait for cleanup
	time.Sleep(3 * time.Second)

	// Step 4: Start fresh
	startCmd := exec.Command("systemctl", "--user", "start", "openclaw-gateway.service")
	if err := startCmd.Run(); err != nil {
		h.logger.Error("failed to start gateway service", zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error": "Failed to start gateway service: " + err.Error(),
		})
		return
	}

	h.logger.Info("gateway restart completed successfully")
	writeJSON(w, http.StatusOK, map[string]string{
		"message": "Gateway restart completed successfully",
	})
}

// KernelInfo returns the current and backup kernel version information
func (h *SystemHandler) KernelInfo(w http.ResponseWriter, r *http.Request) {
	const installPath = "/home/ubuntu/.npm-global/lib/node_modules/openclaw"
	const backupPath = "/home/ubuntu/.npm-global/lib/node_modules/openclaw.bak"

	type KernelInfoResponse struct {
		CurrentVersion string `json:"currentVersion"`
		BackupExists   bool   `json:"backupExists"`
		BackupVersion  string `json:"backupVersion"`
		InstallPath    string `json:"installPath"`
		BackupPath     string `json:"backupPath"`
	}

	resp := KernelInfoResponse{
		InstallPath: installPath,
		BackupPath:  backupPath,
	}

	// Get current version
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "node", installPath+"/openclaw.mjs", "--version").Output(); err == nil {
		resp.CurrentVersion = strings.TrimSpace(string(out))
	}

	// Check if backup exists
	if _, err := os.Stat(backupPath); err == nil {
		resp.BackupExists = true

		// Get backup version
		ctx2, cancel2 := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel2()
		if out, err := exec.CommandContext(ctx2, "node", backupPath+"/openclaw.mjs", "--version").Output(); err == nil {
			resp.BackupVersion = strings.TrimSpace(string(out))
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// KernelRollback executes the kernel rollback script
func (h *SystemHandler) KernelRollback(w http.ResponseWriter, r *http.Request) {
	const installPath = "/home/ubuntu/.npm-global/lib/node_modules/openclaw"
	const backupPath = "/home/ubuntu/.npm-global/lib/node_modules/openclaw.bak"

	h.logger.Info("kernel rollback requested", zap.String("remote", r.RemoteAddr))

	// Check backup exists
	if _, err := os.Stat(backupPath); err != nil {
		writeError(w, http.StatusBadRequest, "No backup kernel found")
		return
	}

	// Capture current version before rollback
	previousVersion := ""
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "node", installPath+"/openclaw.mjs", "--version").Output(); err == nil {
		previousVersion = strings.TrimSpace(string(out))
	}

	// Execute rollback script (fire-and-forget since it restarts the gateway)
	cmd := exec.Command("/home/ubuntu/clawd/scripts/rollback-kernel.sh")
	err := cmd.Start()
	if err != nil {
		h.logger.Error("failed to execute rollback script", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "Failed to execute rollback script: "+err.Error())
		return
	}

	h.logger.Info("kernel rollback initiated", zap.String("previousVersion", previousVersion))
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":         true,
		"previousVersion": previousVersion,
		"message":         "Kernel rollback initiated. Gateway will restart.",
	})
}

// RunDoctor executes the full doctor sequence: stop gateway → run doctor → restart gateway
func (h *SystemHandler) RunDoctor(w http.ResponseWriter, r *http.Request) {
	h.doctorMutex.Lock()
	defer h.doctorMutex.Unlock()

	h.logger.Info("doctor run requested", zap.String("remote", r.RemoteAddr))

	// Check rate limiting (max 1 run per minute)
	if time.Since(h.lastDoctorRun) < time.Minute {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{
			"error": "Rate limited: max 1 doctor run per minute",
		})
		return
	}

	// Check if already running
	if h.isDoctorRunning {
		writeJSON(w, http.StatusConflict, map[string]string{
			"error": "Doctor is already running",
		})
		return
	}

	h.isDoctorRunning = true
	h.lastDoctorRun = time.Now()
	startTime := time.Now()

	// Ensure we reset the running flag even if something goes wrong
	defer func() {
		h.isDoctorRunning = false
	}()

	var output strings.Builder
	var finalResult string = "broken" // Default to broken if something goes wrong

	// Step 1: Stop gateway service
	output.WriteString("=== Stopping Gateway ===\n")
	stopCmd := exec.Command("systemctl", "--user", "stop", "openclaw-gateway.service")
	stopOut, err := stopCmd.CombinedOutput()
	output.Write(stopOut)
	if err != nil {
		output.WriteString(fmt.Sprintf("Error stopping gateway: %v\n", err))
		h.logger.Error("failed to stop gateway for doctor", zap.Error(err))
	}

	// Step 2: Kill remaining processes
	output.WriteString("\n=== Killing Remaining Processes ===\n")
	killCmd := exec.Command("pkill", "-9", "-f", "openclaw")
	killOut, _ := killCmd.CombinedOutput() // Don't fail if no processes found
	output.Write(killOut)

	// Step 3: Wait for cleanup
	time.Sleep(3 * time.Second)

	// Step 4: Run doctor with timeout
	output.WriteString("\n=== Running Doctor ===\n")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	doctorCmd := exec.CommandContext(ctx, "/home/ubuntu/.npm-global/bin/openclaw", "doctor", "--fix", "--non-interactive")
	doctorOut, err := doctorCmd.CombinedOutput()
	output.Write(doctorOut)

	doctorRanOk := true
	if err != nil {
		doctorRanOk = false
		if ctx.Err() == context.DeadlineExceeded {
			output.WriteString("\nDoctor timeout after 60 seconds\n")
		} else {
			output.WriteString(fmt.Sprintf("\nDoctor error: %v\n", err))
		}
	}

	// Step 5: Restart gateway
	output.WriteString("\n=== Restarting Gateway ===\n")
	startCmd := exec.Command("systemctl", "--user", "start", "openclaw-gateway.service")
	startOut, err := startCmd.CombinedOutput()
	output.Write(startOut)

	gatewayRestarted := true
	if err != nil {
		gatewayRestarted = false
		output.WriteString(fmt.Sprintf("Error restarting gateway: %v\n", err))
		h.logger.Error("failed to restart gateway after doctor", zap.Error(err))
	}

	// Determine final result based on what actually matters
	doctorOutputStr := string(doctorOut)
	if !doctorRanOk || !gatewayRestarted {
		// Doctor failed to run or gateway didn't restart = broken
		finalResult = "broken"
	} else if strings.Contains(doctorOutputStr, "Updated") || strings.Contains(doctorOutputStr, "repaired") || strings.Contains(doctorOutputStr, "fixed") {
		// Doctor made changes = repaired
		finalResult = "repaired"
	} else if strings.Contains(doctorOutputStr, "Doctor complete") {
		// Doctor ran successfully = healthy (warnings are informational)
		finalResult = "healthy"
	} else {
		// Doctor completed but couldn't determine status
		finalResult = "healthy"
	}

	duration := time.Since(startTime)
	outputStr := output.String()

	// Store the report in MongoDB
	report := models.DoctorReport{
		RunAt:      startTime,
		Result:     finalResult,
		Output:     outputStr,
		DurationMs: duration.Milliseconds(),
	}

	ctx = context.Background()
	_, err = h.doctorCollection.InsertOne(ctx, report)
	if err != nil {
		h.logger.Error("failed to store doctor report", zap.Error(err))
	}

	// Clean up old reports (keep only last 10)
	go h.cleanupOldReports()

	h.logger.Info("doctor run completed",
		zap.String("result", finalResult),
		zap.Duration("duration", duration))

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"result":    finalResult,
		"output":    outputStr,
		"duration":  duration.Milliseconds(),
		"timestamp": startTime,
	})
}

// DoctorStatus returns the current doctor status
func (h *SystemHandler) DoctorStatus(w http.ResponseWriter, r *http.Request) {
	h.doctorMutex.Lock()
	isRunning := h.isDoctorRunning
	lastRun := h.lastDoctorRun
	h.doctorMutex.Unlock()

	status := "standby"
	if isRunning {
		status = "working"
	}

	// Get the last report from MongoDB
	ctx := context.Background()
	var lastReport models.DoctorReport
	err := h.doctorCollection.FindOne(ctx, bson.M{}, options.FindOne().SetSort(bson.M{"runAt": -1})).Decode(&lastReport)

	lastResult := "unknown"
	if err == nil {
		lastResult = lastReport.Result
		if lastRun.IsZero() {
			lastRun = lastReport.RunAt
		}
	}

	// Count gateway processes
	gatewayCount := 0
	if out, err := exec.Command("pgrep", "-fc", "openclaw-gateway").Output(); err == nil {
		if count, err := strconv.Atoi(strings.TrimSpace(string(out))); err == nil {
			gatewayCount = count
		}
	}

	// Count total openclaw processes
	clawdbotCount := 0
	if out, err := exec.Command("pgrep", "-fc", "openclaw").Output(); err == nil {
		if count, err := strconv.Atoi(strings.TrimSpace(string(out))); err == nil {
			clawdbotCount = count
		}
	}

	// Get gateway process start time (last restart)
	var lastRestart time.Time
	var gatewayUptime string
	if out, err := exec.Command("bash", "-c", "ps -o lstart= -p $(pgrep -f 'openclaw-gateway' | head -1) 2>/dev/null").Output(); err == nil {
		startStr := strings.TrimSpace(string(out))
		// Parse format: "Thu Jan 30 10:00:00 2026"
		if t, err := time.Parse("Mon Jan 2 15:04:05 2006", startStr); err == nil {
			lastRestart = t
			gatewayUptime = time.Since(t).Round(time.Minute).String()
		}
	}

	response := models.DoctorStatus{
		Status:               status,
		LastRunAt:            lastRun,
		LastResult:           lastResult,
		IsRunning:            isRunning,
		LastReportPath:       "", // Not used
		GatewayProcessCount:  gatewayCount,
		ClawdbotProcessCount: clawdbotCount,
		LastRestart:          lastRestart,
		GatewayUptime:        gatewayUptime,
	}

	writeJSON(w, http.StatusOK, response)
}

// DoctorReport returns the full text of the last doctor report
func (h *SystemHandler) DoctorReport(w http.ResponseWriter, r *http.Request) {
	ctx := context.Background()
	var report models.DoctorReport
	err := h.doctorCollection.FindOne(ctx, bson.M{}, options.FindOne().SetSort(bson.M{"runAt": -1})).Decode(&report)

	if err != nil {
		if err == mongo.ErrNoDocuments {
			writeJSON(w, http.StatusNotFound, map[string]string{
				"error": "No doctor reports found",
			})
		} else {
			h.logger.Error("failed to fetch doctor report", zap.Error(err))
			writeJSON(w, http.StatusInternalServerError, map[string]string{
				"error": "Failed to fetch report: " + err.Error(),
			})
		}
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"report":   report.Output,
		"result":   report.Result,
		"runAt":    report.RunAt,
		"duration": report.DurationMs,
	})
}

// cleanupOldReports removes old doctor reports, keeping only the last 10
func (h *SystemHandler) cleanupOldReports() {
	ctx := context.Background()

	// Count total reports
	total, err := h.doctorCollection.CountDocuments(ctx, bson.M{})
	if err != nil {
		h.logger.Error("failed to count doctor reports", zap.Error(err))
		return
	}

	if total <= 10 {
		return // Nothing to clean up
	}

	// Get the 10th newest report timestamp
	cursor, err := h.doctorCollection.Find(ctx, bson.M{}, options.Find().SetSort(bson.M{"runAt": -1}).SetLimit(10))
	if err != nil {
		h.logger.Error("failed to find reports for cleanup", zap.Error(err))
		return
	}
	defer cursor.Close(ctx)

	var reports []models.DoctorReport
	if err := cursor.All(ctx, &reports); err != nil {
		h.logger.Error("failed to decode reports for cleanup", zap.Error(err))
		return
	}

	if len(reports) == 10 {
		cutoffTime := reports[9].RunAt

		// Delete reports older than the cutoff
		result, err := h.doctorCollection.DeleteMany(ctx, bson.M{"runAt": bson.M{"$lt": cutoffTime}})
		if err != nil {
			h.logger.Error("failed to delete old reports", zap.Error(err))
		} else {
			h.logger.Info("cleaned up old doctor reports", zap.Int64("deleted", result.DeletedCount))
		}
	}
}

// ContextInfo returns information about the agent's static context files
func (h *SystemHandler) ContextInfo(w http.ResponseWriter, r *http.Request) {
	contextFiles := []string{
		"AGENTS.md",
		"SOUL.md",
		"TOOLS.md",
		"USER.md",
		"IDENTITY.md",
		"HEARTBEAT.md",
		"MEMORY.md",
	}
	basePath := "/home/ubuntu/clawd"

	var files []FileTokenInfo
	var staticTokens int
	var warnings []string

	for _, filename := range contextFiles {
		filePath := filepath.Join(basePath, filename)
		info, err := os.Stat(filePath)
		if err != nil {
			continue // Skip missing files
		}

		tokens := int(info.Size() / 4) // ~4 bytes per token
		files = append(files, FileTokenInfo{
			Name:   filename,
			Path:   filePath,
			Tokens: tokens,
		})
		staticTokens += tokens

		// Warn if file > 10K tokens
		if tokens > 10000 {
			warnings = append(warnings, fmt.Sprintf("%s is large (%d tokens) - consider trimming", filename, tokens))
		}
	}

	totalTokens := 1000000 // Claude Opus 4.6 context window (1M)
	availableTokens := totalTokens - staticTokens

	// Warn if total static > 50K
	if staticTokens > 50000 {
		warnings = append(warnings, fmt.Sprintf("Total static context is high (%d tokens) - consider reducing", staticTokens))
	}

	response := ContextInfo{
		TotalTokens:     totalTokens,
		StaticTokens:    staticTokens,
		AvailableTokens: availableTokens,
		Files:           files,
		Warnings:        warnings,
		LastUpdated:     time.Now().UTC(),
	}

	writeJSON(w, http.StatusOK, response)
}

// PeakMetrics returns peak CPU/RAM usage over past 24 hours using sar (sysstat)
func (h *SystemHandler) PeakMetrics(w http.ResponseWriter, r *http.Request) {
	response := PeakMetricsResponse{
		Timestamp: time.Now().UTC(),
	}

	// Create context with timeout for all system commands
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Get current CPU usage by summing user + system percentages directly
	// This avoids the "100 - idle" calculation which fails when parsing returns empty
	// Use -bn2 and take second reading for accuracy (first iteration is unreliable)
	cmd := exec.CommandContext(ctx, "bash", "-c", `top -bn2 -d0.5 | grep 'Cpu(s)' | tail -1 | awk '{gsub(/,/, "", $0); for(i=1; i<=NF; i++) {if($(i+1) == "us") user = $i; if($(i+1) == "sy") sys = $i} printf "%.1f\n", user + sys}'`)
	if out, err := cmd.Output(); err == nil {
		if cpuStr := strings.TrimSpace(string(out)); cpuStr != "" {
			if cpu, err := strconv.ParseFloat(cpuStr, 64); err == nil && cpu >= 0 && cpu <= 100 {
				response.CurrentCPU = cpu
			}
		}
	}

	// Get current memory usage
	cmd = exec.CommandContext(ctx, "free", "-h", "--si")
	if out, err := cmd.Output(); err == nil {
		lines := strings.Split(string(out), "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "Mem:") {
				fields := strings.Fields(line)
				if len(fields) >= 3 {
					response.CurrentRAM = fields[2] // Used memory
				}
			}
		}
	}

	// Get peak CPU from sar (sysstat) - last 24 hours
	// sar -u gives CPU usage, we want max (100 - %idle)
	cmd = exec.CommandContext(ctx, "bash", "-c", "sar -u | awk 'NR>3 && /^[0-9]/ {print 100-$NF}' | sort -rn | head -1")
	if out, err := cmd.Output(); err == nil {
		if cpuStr := strings.TrimSpace(string(out)); cpuStr != "" {
			if cpu, err := strconv.ParseFloat(cpuStr, 64); err == nil {
				response.PeakCPU = cpu
			}
		}
	}
	// Fallback: if sar failed or no data, use current as peak
	if response.PeakCPU == 0 && response.CurrentCPU > 0 {
		response.PeakCPU = response.CurrentCPU
	}

	// Get peak memory from sar -r (memory stats)
	// %memused is the percentage of used memory
	cmd = exec.CommandContext(ctx, "bash", "-c", "sar -r | awk 'NR>3 && /^[0-9]/ {print $5}' | sort -rn | head -1")
	if out, err := cmd.Output(); err == nil {
		if memStr := strings.TrimSpace(string(out)); memStr != "" {
			if memPct, err := strconv.ParseFloat(memStr, 64); err == nil {
				// Convert percentage to human readable using total memory
				cmd2 := exec.CommandContext(ctx, "bash", "-c", "free -b | awk '/^Mem:/ {print $2}'")
				if out2, err := cmd2.Output(); err == nil {
					if totalStr := strings.TrimSpace(string(out2)); totalStr != "" {
						if total, err := strconv.ParseFloat(totalStr, 64); err == nil {
							peakBytes := total * memPct / 100
							response.PeakRAM = formatBytes(int64(peakBytes))
						}
					}
				}
			}
		}
	}
	// Fallback: if sar failed, use current as peak
	if response.PeakRAM == "" {
		response.PeakRAM = response.CurrentRAM
	}

	// Sanity check: peak should be >= current (sar and free use different metrics)
	// Parse and compare, use current if it's higher
	if response.PeakRAM != "" && response.CurrentRAM != "" {
		peakVal := parseMemoryString(response.PeakRAM)
		currVal := parseMemoryString(response.CurrentRAM)
		if currVal > peakVal {
			response.PeakRAM = response.CurrentRAM
		}
	}

	// Check for OOM events in system logs (with timeout to prevent hanging)
	// Use specific patterns for actual kernel OOM kills, not just any mention of "oom"
	cmd = exec.CommandContext(ctx, "bash", "-c", "journalctl -k --since '24 hours ago' 2>/dev/null | grep -iE 'oom-killer|killed process|out of memory' | wc -l")
	if out, err := cmd.Output(); err == nil {
		if oomStr := strings.TrimSpace(string(out)); oomStr != "" {
			if oom, err := strconv.Atoi(oomStr); err == nil {
				response.OOMEvents = oom
			}
		}
	} else if ctx.Err() == context.DeadlineExceeded {
		h.logger.Warn("journalctl command timed out, using default OOM count")
		response.OOMEvents = 0 // Default to 0 if timeout
	}

	// Get load averages (1min, 5min, 15min)
	cmd = exec.CommandContext(ctx, "bash", "-c", "cat /proc/loadavg | awk '{print $1, $2, $3}'")
	if out, err := cmd.Output(); err == nil {
		loadParts := strings.Fields(strings.TrimSpace(string(out)))
		loadAvg := make([]float64, 0, 3)
		for _, part := range loadParts {
			if load, err := strconv.ParseFloat(part, 64); err == nil {
				loadAvg = append(loadAvg, load)
			}
		}
		if len(loadAvg) == 3 {
			response.LoadAvg = loadAvg
		}
	}

	writeJSON(w, http.StatusOK, response)
}

// formatBytes converts bytes to human-readable format (e.g., "1.2G")
func formatBytes(bytes int64) string {
	const (
		KB = 1000
		MB = KB * 1000
		GB = MB * 1000
	)
	switch {
	case bytes >= GB:
		return fmt.Sprintf("%.1fG", float64(bytes)/float64(GB))
	case bytes >= MB:
		return fmt.Sprintf("%.1fM", float64(bytes)/float64(MB))
	case bytes >= KB:
		return fmt.Sprintf("%.1fK", float64(bytes)/float64(KB))
	default:
		return fmt.Sprintf("%dB", bytes)
	}
}

// parseMemoryString converts strings like "2.5G", "512M" to bytes for comparison
func parseMemoryString(s string) float64 {
	s = strings.TrimSpace(s)
	if len(s) == 0 {
		return 0
	}
	unit := s[len(s)-1]
	numStr := s[:len(s)-1]
	num, err := strconv.ParseFloat(numStr, 64)
	if err != nil {
		return 0
	}
	switch unit {
	case 'G':
		return num * 1000 * 1000 * 1000
	case 'M':
		return num * 1000 * 1000
	case 'K':
		return num * 1000
	default:
		return num
	}
}

// CronHistory returns recent cron job execution history
// ClawdbotCronJob represents a job from the Clawdbot cron API
type ClawdbotCronJob struct {
	ID       string `json:"id"`
	AgentID  string `json:"agentId"`
	Name     string `json:"name"`
	Enabled  bool   `json:"enabled"`
	Schedule struct {
		Kind string `json:"kind"`
		Expr string `json:"expr"`
		Tz   string `json:"tz"`
	} `json:"schedule"`
	State struct {
		NextRunAtMs    int64  `json:"nextRunAtMs"`
		LastRunAtMs    int64  `json:"lastRunAtMs"`
		LastStatus     string `json:"lastStatus"`
		LastDurationMs int64  `json:"lastDurationMs"`
	} `json:"state"`
}

type ClawdbotCronResponse struct {
	Jobs []ClawdbotCronJob `json:"jobs"`
}

func (h *SystemHandler) CronHistory(w http.ResponseWriter, r *http.Request) {
	response := CronHistoryResponse{
		Jobs:      []CronJobStatus{},
		Timestamp: time.Now().UTC(),
	}

	// Call openclaw cron list to get actual job data
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "/home/ubuntu/.npm-global/bin/openclaw", "cron", "list", "--json", "--all")
	out, err := cmd.Output()
	if err != nil {
		h.logger.Warn("failed to get cron jobs from openclaw", zap.Error(err))
		writeJSON(w, http.StatusOK, response)
		return
	}

	var cronData ClawdbotCronResponse
	if err := json.Unmarshal(out, &cronData); err != nil {
		h.logger.Warn("failed to parse cron jobs", zap.Error(err))
		writeJSON(w, http.StatusOK, response)
		return
	}

	// Convert to our response format
	for _, job := range cronData.Jobs {
		jobStatus := CronJobStatus{
			ID:       job.ID,
			Name:     job.Name,
			Schedule: job.Schedule.Expr,
			Timezone: job.Schedule.Tz,
			Enabled:  job.Enabled,
			AgentID:  job.AgentID,
		}

		// Convert timestamps from milliseconds
		if job.State.LastRunAtMs > 0 {
			jobStatus.LastRunAt = time.UnixMilli(job.State.LastRunAtMs)
		}
		if job.State.NextRunAtMs > 0 {
			jobStatus.NextRunAt = time.UnixMilli(job.State.NextRunAtMs)
		}

		// Map status
		switch job.State.LastStatus {
		case "ok":
			jobStatus.Status = "healthy"
		case "":
			jobStatus.Status = "never"
		default:
			jobStatus.Status = "failed"
		}

		response.Jobs = append(response.Jobs, jobStatus)
	}

	writeJSON(w, http.StatusOK, response)
}

// CronRuns returns run history for a specific cron job
func (h *SystemHandler) CronRuns(w http.ResponseWriter, r *http.Request) {
	jobId := r.URL.Query().Get("jobId")
	if jobId == "" {
		writeError(w, http.StatusBadRequest, "jobId is required")
		return
	}

	limit := r.URL.Query().Get("limit")
	if limit == "" {
		limit = "20"
	} else if _, err := strconv.Atoi(limit); err != nil {
		limit = "20"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "/home/ubuntu/.npm-global/bin/openclaw", "cron", "runs", "--id", jobId, "--limit", limit, "--json")
	out, err := cmd.Output()
	if err != nil {
		h.logger.Warn("failed to get cron runs from openclaw", zap.String("jobId", jobId), zap.Error(err))
		writeJSON(w, http.StatusOK, map[string]interface{}{"entries": []interface{}{}})
		return
	}

	var result map[string]interface{}
	if err := json.Unmarshal(out, &result); err != nil {
		h.logger.Warn("failed to parse cron runs", zap.Error(err))
		writeJSON(w, http.StatusOK, map[string]interface{}{"entries": []interface{}{}})
		return
	}

	// Pass through the entries array from the CLI response
	entries, ok := result["entries"]
	if !ok {
		entries = []interface{}{}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{"entries": entries})
}

// ActivityGrid returns agent activity data in GitHub contribution style
func (h *SystemHandler) ActivityGrid(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent")
	if agentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "agent parameter is required",
		})
		return
	}

	response := ActivityGridResponse{
		AgentID:   agentID,
		Windows:   []ActivityWindow{},
		Timestamp: time.Now().UTC(),
	}

	// Calculate 4-hour windows for the past 30 days in EST timezone
	est, _ := time.LoadLocation("America/Detroit")
	now := time.Now().In(est)
	startDate := now.AddDate(0, 0, -29) // 30 days ago (inclusive)

	// Generate all 4-hour windows
	var allWindows []ActivityWindow
	for d := 0; d < 30; d++ {
		day := startDate.AddDate(0, 0, d)
		dayStart := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, est)

		// Only generate windows up to current time for today
		maxHour := 24
		if day.YearDay() == now.YearDay() && day.Year() == now.Year() {
			// Current day - only show completed 4-hour chunks
			maxHour = (now.Hour() / 4) * 4
		}

		for h := 0; h < maxHour; h += 4 {
			windowStart := dayStart.Add(time.Duration(h) * time.Hour)
			windowEnd := windowStart.Add(4 * time.Hour)

			window := ActivityWindow{
				WindowStart:   windowStart,
				WindowEnd:     windowEnd,
				ActivityCount: 0,
			}

			allWindows = append(allWindows, window)
		}
	}

	// Query activity data - only repo paths supported now (format: "owner/repo")
	if strings.Contains(agentID, "/") {
		// Treat as a GitHub repo - query commits via gh CLI
		// Fetch ALL commits for the last 30 days in ONE call
		since := allWindows[0].WindowStart.Format(time.RFC3339)

		cmd := exec.Command("gh", "api", fmt.Sprintf("repos/%s/commits?since=%s&per_page=100", agentID, since))

		if out, err := cmd.Output(); err == nil {
			var commits []struct {
				Commit struct {
					Author struct {
						Date time.Time `json:"date"`
					} `json:"author"`
				} `json:"commit"`
			}

			if json.Unmarshal(out, &commits) == nil {
				// Distribute commits into windows
				for _, commit := range commits {
					commitTime := commit.Commit.Author.Date

					// Find which window this commit belongs to
					for i := range allWindows {
						if (commitTime.Equal(allWindows[i].WindowStart) || commitTime.After(allWindows[i].WindowStart)) &&
							commitTime.Before(allWindows[i].WindowEnd) {
							allWindows[i].ActivityCount++
							break
						}
					}
				}
			}
		}
	} else {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "agent parameter must be a GitHub repo path (format: owner/repo)",
		})
		return
	}

	response.Windows = allWindows
	writeJSON(w, http.StatusOK, response)
}

// ── Config Rollback ───────────────────────────────────────────────────────────
// Targets: openclaw.json (main config) + auth-profiles.json (OAuth credentials)
// Note: clawdbot.json is legacy and NOT backed up/restored.
// auth-profiles.json field names must be: access, refresh, expires (NOT access_token etc.)

type ConfigInfoResponse struct {
	OpenClawConfig  string `json:"openClawConfig"`
	AuthConfig      string `json:"authConfig"`
	BackupExists    bool   `json:"backupExists"`
	LatestBackup    string `json:"latestBackup"`
	LatestBackupAge string `json:"latestBackupAge"`
}

// findLatestConfigBackup returns the most recent backup file for a given config path
func findLatestConfigBackup(base string) (string, time.Time) {
	// Glob timestamped backups
	pattern := base + ".backup-*"
	matches, _ := filepath.Glob(pattern)

	var newest string
	var newestMod time.Time
	for _, m := range matches {
		info, err := os.Stat(m)
		if err != nil {
			continue
		}
		if info.ModTime().After(newestMod) {
			newestMod = info.ModTime()
			newest = m
		}
	}
	if newest != "" {
		return newest, newestMod
	}

	// Fall back to .bak
	bak := base + ".bak"
	info, err := os.Stat(bak)
	if err == nil {
		return bak, info.ModTime()
	}

	return "", time.Time{}
}

// ConfigInfo returns info about the current configs and available backups
func (h *SystemHandler) ConfigInfo(w http.ResponseWriter, r *http.Request) {
	configDir := os.ExpandEnv("$HOME/.openclaw")
	openClawPath := filepath.Join(configDir, "openclaw.json")
	authPath := filepath.Join(configDir, "agents", "main", "agent", "auth-profiles.json")

	resp := ConfigInfoResponse{
		OpenClawConfig: openClawPath,
		AuthConfig:     authPath,
	}

	// Find latest backup (either file's backup works)
	ocBak, ocMod := findLatestConfigBackup(openClawPath)
	authBak, authMod := findLatestConfigBackup(authPath)

	// Use whichever has the most recent backup
	var latestPath string
	var latestMod time.Time
	if ocMod.After(authMod) {
		latestPath, latestMod = ocBak, ocMod
	} else if !authMod.IsZero() {
		latestPath, latestMod = authBak, authMod
	}

	if latestPath != "" {
		resp.BackupExists = true
		resp.LatestBackup = filepath.Base(latestPath)
		age := time.Since(latestMod)
		switch {
		case age < time.Minute:
			resp.LatestBackupAge = "just now"
		case age < time.Hour:
			resp.LatestBackupAge = fmt.Sprintf("%dm ago", int(age.Minutes()))
		case age < 24*time.Hour:
			resp.LatestBackupAge = fmt.Sprintf("%dh ago", int(age.Hours()))
		default:
			resp.LatestBackupAge = fmt.Sprintf("%dd ago", int(age.Hours()/24))
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// ConfigBackup creates a fresh timestamped backup of openclaw.json + auth-profiles.json
func (h *SystemHandler) ConfigBackup(w http.ResponseWriter, r *http.Request) {
	configDir := os.ExpandEnv("$HOME/.openclaw")
	stamp := time.Now().Format("20060102-150405")

	backed := []string{}
	errs := []string{}

	// Files to back up: path → destination dir
	targets := map[string]string{
		filepath.Join(configDir, "openclaw.json"):                                 configDir,
		filepath.Join(configDir, "agents", "main", "agent", "auth-profiles.json"): filepath.Join(configDir, "agents", "main", "agent"),
	}

	for src, dstDir := range targets {
		name := filepath.Base(src)
		dst := filepath.Join(dstDir, name+".backup-"+stamp)
		data, err := os.ReadFile(src)
		if err != nil {
			errs = append(errs, fmt.Sprintf("read %s: %v", name, err))
			continue
		}
		if err := os.WriteFile(dst, data, 0600); err != nil {
			errs = append(errs, fmt.Sprintf("write %s: %v", dst, err))
			continue
		}
		backed = append(backed, dst)
		h.logger.Info("config backup created", zap.String("file", dst))
	}

	if len(errs) > 0 {
		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"success": false,
			"backed":  backed,
			"errors":  errs,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success": true,
		"stamp":   stamp,
		"files":   backed,
		"message": fmt.Sprintf("Backed up %d config file(s) with timestamp %s", len(backed), stamp),
	})
}

// ConfigRollback runs the rollback-config.sh script (fire-and-forget — restarts gateway)
func (h *SystemHandler) ConfigRollback(w http.ResponseWriter, r *http.Request) {
	h.logger.Info("config rollback requested", zap.String("remote", r.RemoteAddr))

	// Verify at least one backup exists before starting
	configDir := os.ExpandEnv("$HOME/.openclaw")
	ocBak, _ := findLatestConfigBackup(filepath.Join(configDir, "openclaw.json"))
	authBak, _ := findLatestConfigBackup(filepath.Join(configDir, "agents", "main", "agent", "auth-profiles.json"))
	if ocBak == "" && authBak == "" {
		writeError(w, http.StatusBadRequest, "No config backups found")
		return
	}

	// Fire-and-forget — gateway will restart mid-execution
	cmd := exec.Command("/home/ubuntu/clawd/scripts/rollback-config.sh")
	if err := cmd.Start(); err != nil {
		h.logger.Error("failed to launch rollback-config.sh", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "Failed to launch rollback script: "+err.Error())
		return
	}

	h.logger.Info("config rollback initiated")
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":    true,
		"message":    "Config rollback initiated. Gateway will restart.",
		"ocBackup":   filepath.Base(ocBak),
		"authBackup": filepath.Base(authBak),
	})
}

// findLatestPreRollback returns the most recent pre-rollback snapshot for a given config path
func findLatestPreRollback(base string) (string, time.Time) {
	pattern := base + ".pre-rollback-*"
	matches, _ := filepath.Glob(pattern)

	var newest string
	var newestMod time.Time
	for _, m := range matches {
		info, err := os.Stat(m)
		if err != nil {
			continue
		}
		if info.ModTime().After(newestMod) {
			newestMod = info.ModTime()
			newest = m
		}
	}
	return newest, newestMod
}

// ConfigRollForwardAvailable checks whether a pre-rollback snapshot exists
func (h *SystemHandler) ConfigRollForwardAvailable(w http.ResponseWriter, r *http.Request) {
	configDir := os.ExpandEnv("$HOME/.openclaw")
	ocSnap, ocMod := findLatestPreRollback(filepath.Join(configDir, "openclaw.json"))
	authSnap, authMod := findLatestPreRollback(filepath.Join(configDir, "agents", "main", "agent", "auth-profiles.json"))

	var latestPath string
	var latestMod time.Time
	if ocMod.After(authMod) {
		latestPath, latestMod = ocSnap, ocMod
	} else if !authMod.IsZero() {
		latestPath, latestMod = authSnap, authMod
	}

	resp := map[string]interface{}{
		"available": latestPath != "",
	}

	if latestPath != "" {
		resp["latestSnapshot"] = filepath.Base(latestPath)
		age := time.Since(latestMod)
		switch {
		case age < time.Minute:
			resp["snapshotAge"] = "just now"
		case age < time.Hour:
			resp["snapshotAge"] = fmt.Sprintf("%dm ago", int(age.Minutes()))
		case age < 24*time.Hour:
			resp["snapshotAge"] = fmt.Sprintf("%dh ago", int(age.Hours()))
		default:
			resp["snapshotAge"] = fmt.Sprintf("%dd ago", int(age.Hours()/24))
		}
	}

	writeJSON(w, http.StatusOK, resp)
}

// ConfigRollForward runs the rollforward-config.sh script (fire-and-forget — restarts gateway)
func (h *SystemHandler) ConfigRollForward(w http.ResponseWriter, r *http.Request) {
	h.logger.Info("config roll forward requested", zap.String("remote", r.RemoteAddr))

	// Verify at least one pre-rollback snapshot exists
	configDir := os.ExpandEnv("$HOME/.openclaw")
	ocSnap, _ := findLatestPreRollback(filepath.Join(configDir, "openclaw.json"))
	authSnap, _ := findLatestPreRollback(filepath.Join(configDir, "agents", "main", "agent", "auth-profiles.json"))
	if ocSnap == "" && authSnap == "" {
		writeError(w, http.StatusBadRequest, "No pre-rollback snapshots found")
		return
	}

	// Fire-and-forget — gateway will restart mid-execution
	cmd := exec.Command("/home/ubuntu/clawd/scripts/rollforward-config.sh")
	if err := cmd.Start(); err != nil {
		h.logger.Error("failed to launch rollforward-config.sh", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "Failed to launch roll forward script: "+err.Error())
		return
	}

	h.logger.Info("config roll forward initiated")
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":      true,
		"message":      "Config roll forward initiated. Gateway will restart.",
		"ocSnapshot":   filepath.Base(ocSnap),
		"authSnapshot": filepath.Base(authSnap),
	})
}

// DomainSSL returns SSL certificate and domain information
func (h *SystemHandler) DomainSSL(w http.ResponseWriter, r *http.Request) {
	response := DomainSSLInfo{
		Timestamp: time.Now().UTC(),
	}

	// Default domain for agent dashboard
	domain := "YOUR_DOMAIN"
	response.Domain = domain

	// Create context with timeout for SSL/domain checks
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Check SSL certificate status using openssl s_client
	cmd := exec.CommandContext(ctx, "bash", "-c", fmt.Sprintf("echo | openssl s_client -servername %s -connect %s:443 2>/dev/null | openssl x509 -noout -dates", domain, domain))
	if out, err := cmd.Output(); err == nil {
		output := string(out)

		// Parse SSL expiry date
		for _, line := range strings.Split(output, "\n") {
			if strings.HasPrefix(line, "notAfter=") {
				expiryStr := strings.TrimPrefix(line, "notAfter=")
				// Parse the date format: "Jan 30 23:59:59 2026 GMT"
				if expiry, err := time.Parse("Jan 2 15:04:05 2006 MST", expiryStr); err == nil {
					response.SSLExpiry = expiry.Format("2006-01-02 15:04:05 MST")
					daysRemaining := int(time.Until(expiry).Hours() / 24)
					response.SSLDaysRemaining = daysRemaining
				}
				break
			}
		}
	} else {
		h.logger.Warn("SSL certificate check failed", zap.String("domain", domain), zap.Error(err))
		response.SSLExpiry = "Unknown"
		response.SSLDaysRemaining = -1
	}

	// Check Cloudflare status using dig (simplified)
	cmd = exec.CommandContext(ctx, "dig", "+short", domain)
	if out, err := cmd.Output(); err == nil {
		output := strings.TrimSpace(string(out))
		if output != "" {
			// Simple check: if we get an IP address response, DNS is working
			response.DNSStatus = "✓ Resolving"

			// Check if IP suggests Cloudflare (simplified check)
			lines := strings.Split(output, "\n")
			if len(lines) > 0 {
				ip := strings.TrimSpace(lines[0])
				// Cloudflare uses various IP ranges, this is a simplified check
				if strings.HasPrefix(ip, "104.") || strings.HasPrefix(ip, "172.") {
					response.CloudflareStatus = "✓ Active"
				} else {
					response.CloudflareStatus = "• Direct"
				}
			}
		} else {
			response.DNSStatus = "✗ Failed"
			response.CloudflareStatus = "✗ Unknown"
		}
	} else {
		h.logger.Warn("DNS check failed", zap.String("domain", domain), zap.Error(err))
		response.DNSStatus = "✗ Failed"
		response.CloudflareStatus = "✗ Unknown"
	}

	// Check Cloudflare Tunnel status
	cmd = exec.CommandContext(ctx, "cloudflared", "tunnel", "info", "agent-dashboard", "--output", "json")
	if out, err := cmd.Output(); err == nil {
		var tunnelInfo struct {
			Connections []struct{} `json:"connections"`
		}
		if json.Unmarshal(out, &tunnelInfo) == nil {
			response.TunnelStatus = "✓ Running"
			response.TunnelConnections = len(tunnelInfo.Connections)
		} else {
			// Fallback: check if cloudflared process is running
			checkCmd := exec.CommandContext(ctx, "pgrep", "-c", "cloudflared")
			if checkOut, err := checkCmd.Output(); err == nil {
				count := strings.TrimSpace(string(checkOut))
				if count != "0" {
					response.TunnelStatus = "✓ Running"
					response.TunnelConnections = 4 // Default assumption
				}
			}
		}
	} else {
		// Check if cloudflared process is running as fallback
		checkCmd := exec.CommandContext(ctx, "pgrep", "-c", "cloudflared")
		if checkOut, err := checkCmd.Output(); err == nil {
			count := strings.TrimSpace(string(checkOut))
			if count != "0" {
				response.TunnelStatus = "✓ Running"
				// Parse connection count from tunnel list
				listCmd := exec.CommandContext(ctx, "bash", "-c", "cloudflared tunnel list 2>/dev/null | grep agent-dashboard | grep -oP '\\d+x\\w+' | wc -l")
				if listOut, _ := listCmd.Output(); len(listOut) > 0 {
					if n, err := strconv.Atoi(strings.TrimSpace(string(listOut))); err == nil && n > 0 {
						response.TunnelConnections = n * 2 // Each entry is 2 connections
					} else {
						response.TunnelConnections = 4
					}
				}
			} else {
				response.TunnelStatus = "✗ Stopped"
				response.TunnelConnections = 0
			}
		} else {
			response.TunnelStatus = "✗ Unknown"
			response.TunnelConnections = 0
		}
	}

	// Default fallbacks for failed checks
	if response.SSLExpiry == "" {
		response.SSLExpiry = "Check failed"
	}
	if response.DNSStatus == "" {
		response.DNSStatus = "✗ Unknown"
	}
	if response.CloudflareStatus == "" {
		response.CloudflareStatus = "✗ Unknown"
	}
	if response.TunnelStatus == "" {
		response.TunnelStatus = "✗ Unknown"
	}

	writeJSON(w, http.StatusOK, response)
}

// --- OAuth Refresh Endpoints ---

func (h *SystemHandler) OAuthRefreshStart(w http.ResponseWriter, r *http.Request) {
	h.oauthRefreshMutex.Lock()
	defer h.oauthRefreshMutex.Unlock()

	if h.isOAuthRefreshActive {
		writeJSON(w, http.StatusConflict, map[string]string{
			"error": "OAuth refresh already in progress",
		})
		return
	}

	// Prepare dedicated working directory
	dir, err := h.oauthRefreshDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Cannot prepare oauth directory: "+err.Error())
		return
	}

	// Clean up stale files
	os.Remove(filepath.Join(dir, oauthStateFile))
	os.Remove(filepath.Join(dir, oauthCodeFile))

	// Verify script exists before attempting to run it
	scriptPath := h.oauthRefreshScript
	if scriptPath == "" {
		scriptPath = defaultOAuthRefreshScript
	}
	if _, err := os.Stat(scriptPath); os.IsNotExist(err) {
		h.logger.Error("oauth refresh script not found", zap.String("path", scriptPath))
		writeError(w, http.StatusInternalServerError,
			"OAuth refresh script not found at "+scriptPath+". Verify the script is deployed.")
		return
	}

	// Use timeout context parented to shutdown context
	cmdCtx, cmdCancel := context.WithTimeout(h.shutdownCtx, oauthRefreshTimeout)
	cmd := exec.CommandContext(cmdCtx, "python3", scriptPath)
	cmd.Env = append(os.Environ(), "HOME="+os.Getenv("HOME"), "OAUTH_REFRESH_DIR="+dir)

	if err := cmd.Start(); err != nil {
		cmdCancel()
		h.logger.Error("failed to start oauth refresh script", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "Failed to start refresh: "+err.Error())
		return
	}

	h.oauthRefreshCmd = cmd
	h.isOAuthRefreshActive = true

	// Background goroutine to track completion
	go func() {
		defer cmdCancel()
		cmd.Wait()
		h.oauthRefreshMutex.Lock()
		h.isOAuthRefreshActive = false
		h.oauthRefreshCmd = nil
		h.oauthRefreshMutex.Unlock()
		if cmd.ProcessState != nil {
			h.logger.Info("oauth refresh script exited", zap.Int("exitCode", cmd.ProcessState.ExitCode()))
		}
	}()

	h.logger.Info("oauth refresh started", zap.String("remote", r.RemoteAddr))
	writeJSON(w, http.StatusOK, map[string]string{
		"message": "OAuth refresh initiated",
	})
}

func (h *SystemHandler) OAuthRefreshStatus(w http.ResponseWriter, r *http.Request) {
	h.oauthRefreshMutex.Lock()
	active := h.isOAuthRefreshActive
	h.oauthRefreshMutex.Unlock()

	dir, err := h.oauthRefreshDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Cannot determine oauth directory: "+err.Error())
		return
	}

	data, err := os.ReadFile(filepath.Join(dir, oauthStateFile))
	if err != nil {
		writeJSON(w, http.StatusOK, OAuthRefreshStatus{
			State:   "idle",
			Message: "No OAuth refresh in progress",
			Active:  active,
		})
		return
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to parse state file")
		return
	}

	response := OAuthRefreshStatus{
		State:     jsonString(raw, "state"),
		AuthURL:   jsonString(raw, "auth_url"),
		Error:     jsonString(raw, "error"),
		Message:   jsonString(raw, "message"),
		StartedAt: jsonString(raw, "started_at"),
		UpdatedAt: jsonString(raw, "updated_at"),
		Active:    active,
	}

	writeJSON(w, http.StatusOK, response)
}

func (h *SystemHandler) OAuthRefreshCode(w http.ResponseWriter, r *http.Request) {
	h.oauthRefreshMutex.Lock()
	active := h.isOAuthRefreshActive
	h.oauthRefreshMutex.Unlock()

	if !active {
		writeError(w, http.StatusBadRequest, "No OAuth refresh in progress")
		return
	}

	var body struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Code) == "" {
		writeError(w, http.StatusBadRequest, "Missing or empty 'code' field")
		return
	}

	code := strings.TrimSpace(body.Code)

	dir, err := h.oauthRefreshDir()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Cannot determine oauth directory: "+err.Error())
		return
	}

	// Atomic write to temp file
	tmp := filepath.Join(dir, oauthCodeTmpFile)
	if err := os.WriteFile(tmp, []byte(code), 0600); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to write code: "+err.Error())
		return
	}
	if err := os.Rename(tmp, filepath.Join(dir, oauthCodeFile)); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to finalize code file: "+err.Error())
		return
	}

	h.logger.Info("oauth refresh code submitted", zap.String("remote", r.RemoteAddr))
	writeJSON(w, http.StatusOK, map[string]string{
		"message": "Code submitted successfully",
	})
}

func (h *SystemHandler) OAuthRefreshLog(w http.ResponseWriter, r *http.Request) {
	dir, err := h.oauthRefreshDir()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{
			"log": "Cannot determine oauth directory: " + err.Error(),
		})
		return
	}
	data, err := os.ReadFile(filepath.Join(dir, oauthLogFile))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{
			"log": "No log file available",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"log": string(data),
	})
}

func (h *SystemHandler) TokenStatus(w http.ResponseWriter, r *http.Request) {
	home, err := os.UserHomeDir()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "unknown",
			"message": "Cannot determine home directory. Check that the HOME environment variable is set.",
		})
		return
	}

	credsPath := filepath.Join(home, ".claude", ".credentials.json")
	data, err := os.ReadFile(credsPath)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "unknown",
			"message": "OAuth credentials file not accessible at ~/.claude/.credentials.json — run 'claude login' or use Refresh OAuth Token.",
		})
		return
	}

	var creds map[string]interface{}
	if err := json.Unmarshal(data, &creds); err != nil {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "unknown",
			"message": "Credentials file is corrupted. Back up and delete ~/.claude/.credentials.json, then run 'claude login'.",
		})
		return
	}

	oauth, ok := creds["claudeAiOauth"].(map[string]interface{})
	if !ok {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "unknown",
			"message": "No OAuth credentials in credentials file. Run 'claude login' or use Refresh OAuth Token.",
		})
		return
	}

	expiresAt, ok := oauth["expiresAt"].(float64)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":  "unknown",
			"message": "Credentials missing expiration data. Try refreshing the OAuth token.",
		})
		return
	}

	expiresTime := time.UnixMilli(int64(expiresAt))
	remaining := time.Until(expiresTime)

	status := "healthy"
	if remaining <= 0 {
		status = "expired"
	} else if remaining < 2*time.Hour {
		status = "warning"
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":    status,
		"expiresAt": expiresTime.Format(time.RFC3339),
	})
}

// jsonString safely extracts a string value from a map.
func jsonString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
