package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// newOAuthTestHandler creates a SystemHandler with oauthDir set to a temp directory.
func newOAuthTestHandler(t *testing.T) (*SystemHandler, string) {
	t.Helper()
	dir := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	h := &SystemHandler{
		logger:         newTestLogger(),
		shutdownCtx:    ctx,
		shutdownCancel: cancel,
		oauthDir:       dir,
	}
	return h, dir
}

// writeTestCredentials writes a credentials JSON file into tmpHome/.claude/.credentials.json.
func writeTestCredentials(t *testing.T, homeDir string, creds map[string]interface{}) {
	t.Helper()
	credsDir := filepath.Join(homeDir, ".claude")
	if err := os.MkdirAll(credsDir, 0755); err != nil {
		t.Fatalf("failed to create .claude dir: %v", err)
	}
	data, err := json.Marshal(creds)
	if err != nil {
		t.Fatalf("failed to marshal creds: %v", err)
	}
	if err := os.WriteFile(filepath.Join(credsDir, ".credentials.json"), data, 0644); err != nil {
		t.Fatalf("failed to write credentials: %v", err)
	}
}

// --- OAuthRefreshStatus tests ---

func TestOAuthRefreshStatus_Idle(t *testing.T) {
	h, _ := newOAuthTestHandler(t)

	req := httptest.NewRequest("GET", "/api/system/oauth-refresh/status", nil)
	w := httptest.NewRecorder()
	h.OAuthRefreshStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp OAuthRefreshStatus
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.State != "idle" {
		t.Errorf("expected state 'idle', got %q", resp.State)
	}
	if resp.Active {
		t.Error("expected active=false")
	}
}

func TestOAuthRefreshStatus_Active(t *testing.T) {
	h, dir := newOAuthTestHandler(t)
	h.isOAuthRefreshActive = true

	stateData := `{"state":"url_ready","auth_url":"https://example.com/auth","message":"Authorize"}`
	os.WriteFile(filepath.Join(dir, oauthStateFile), []byte(stateData), 0644)

	req := httptest.NewRequest("GET", "/api/system/oauth-refresh/status", nil)
	w := httptest.NewRecorder()
	h.OAuthRefreshStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp OAuthRefreshStatus
	json.NewDecoder(w.Body).Decode(&resp)
	if resp.State != "url_ready" {
		t.Errorf("expected state 'url_ready', got %q", resp.State)
	}
	if resp.AuthURL != "https://example.com/auth" {
		t.Errorf("expected authUrl 'https://example.com/auth', got %q", resp.AuthURL)
	}
	if !resp.Active {
		t.Error("expected active=true")
	}
}

func TestOAuthRefreshStatus_CorruptState(t *testing.T) {
	h, dir := newOAuthTestHandler(t)

	os.WriteFile(filepath.Join(dir, oauthStateFile), []byte("not-json{"), 0644)

	req := httptest.NewRequest("GET", "/api/system/oauth-refresh/status", nil)
	w := httptest.NewRecorder()
	h.OAuthRefreshStatus(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if !strings.Contains(resp["error"], "parse") {
		t.Errorf("expected error about parsing, got %q", resp["error"])
	}
}

// --- OAuthRefreshCode tests ---

func TestOAuthRefreshCode_Success(t *testing.T) {
	h, dir := newOAuthTestHandler(t)
	h.isOAuthRefreshActive = true

	body := strings.NewReader(`{"code":"abc123"}`)
	req := httptest.NewRequest("POST", "/api/system/oauth-refresh/code", body)
	w := httptest.NewRecorder()
	h.OAuthRefreshCode(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	data, err := os.ReadFile(filepath.Join(dir, oauthCodeFile))
	if err != nil {
		t.Fatalf("failed to read code file: %v", err)
	}
	if string(data) != "abc123" {
		t.Errorf("expected code 'abc123', got %q", string(data))
	}
}

func TestOAuthRefreshCode_NotActive(t *testing.T) {
	h, _ := newOAuthTestHandler(t)
	h.isOAuthRefreshActive = false

	body := strings.NewReader(`{"code":"abc123"}`)
	req := httptest.NewRequest("POST", "/api/system/oauth-refresh/code", body)
	w := httptest.NewRecorder()
	h.OAuthRefreshCode(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestOAuthRefreshCode_EmptyCode(t *testing.T) {
	h, _ := newOAuthTestHandler(t)
	h.isOAuthRefreshActive = true

	body := strings.NewReader(`{"code":"   "}`)
	req := httptest.NewRequest("POST", "/api/system/oauth-refresh/code", body)
	w := httptest.NewRecorder()
	h.OAuthRefreshCode(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestOAuthRefreshCode_InvalidJSON(t *testing.T) {
	h, _ := newOAuthTestHandler(t)
	h.isOAuthRefreshActive = true

	body := strings.NewReader(`not-json`)
	req := httptest.NewRequest("POST", "/api/system/oauth-refresh/code", body)
	w := httptest.NewRecorder()
	h.OAuthRefreshCode(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// --- OAuthRefreshLog tests ---

func TestOAuthRefreshLog_NoFile(t *testing.T) {
	h, _ := newOAuthTestHandler(t)

	req := httptest.NewRequest("GET", "/api/system/oauth-refresh/log", nil)
	w := httptest.NewRecorder()
	h.OAuthRefreshLog(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["log"] != "No log file available" {
		t.Errorf("expected placeholder log, got %q", resp["log"])
	}
}

func TestOAuthRefreshLog_WithContent(t *testing.T) {
	h, dir := newOAuthTestHandler(t)

	logContent := "line1\nline2\nline3"
	os.WriteFile(filepath.Join(dir, oauthLogFile), []byte(logContent), 0644)

	req := httptest.NewRequest("GET", "/api/system/oauth-refresh/log", nil)
	w := httptest.NewRecorder()
	h.OAuthRefreshLog(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["log"] != logContent {
		t.Errorf("expected %q, got %q", logContent, resp["log"])
	}
}

// --- OAuthRefreshStart tests ---

func TestOAuthRefreshStart_AlreadyActive(t *testing.T) {
	h, _ := newOAuthTestHandler(t)
	h.isOAuthRefreshActive = true

	req := httptest.NewRequest("POST", "/api/system/oauth-refresh/start", nil)
	w := httptest.NewRecorder()
	h.OAuthRefreshStart(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", w.Code)
	}
}

func TestOAuthRefreshStart_ScriptNotFound(t *testing.T) {
	h, _ := newOAuthTestHandler(t)
	h.oauthRefreshScript = "/nonexistent/path/oauth-refresh-interactive.py"

	req := httptest.NewRequest("POST", "/api/system/oauth-refresh/start", nil)
	w := httptest.NewRecorder()
	h.OAuthRefreshStart(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if !strings.Contains(resp["error"], "not found") {
		t.Errorf("expected error about script not found, got %q", resp["error"])
	}
}

// --- TokenStatus tests ---

func TestTokenStatus_Healthy(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	expiresAt := float64(time.Now().Add(24 * time.Hour).UnixMilli())
	writeTestCredentials(t, tmpHome, map[string]interface{}{
		"claudeAiOauth": map[string]interface{}{
			"expiresAt": expiresAt,
		},
	})

	h, _ := newOAuthTestHandler(t)
	req := httptest.NewRequest("GET", "/api/system/token-status", nil)
	w := httptest.NewRecorder()
	h.TokenStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "healthy" {
		t.Errorf("expected status 'healthy', got %q", resp["status"])
	}
}

func TestTokenStatus_Expired(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	expiresAt := float64(time.Now().Add(-1 * time.Hour).UnixMilli())
	writeTestCredentials(t, tmpHome, map[string]interface{}{
		"claudeAiOauth": map[string]interface{}{
			"expiresAt": expiresAt,
		},
	})

	h, _ := newOAuthTestHandler(t)
	req := httptest.NewRequest("GET", "/api/system/token-status", nil)
	w := httptest.NewRecorder()
	h.TokenStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "expired" {
		t.Errorf("expected status 'expired', got %q", resp["status"])
	}
}

func TestTokenStatus_Warning(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	expiresAt := float64(time.Now().Add(30 * time.Minute).UnixMilli())
	writeTestCredentials(t, tmpHome, map[string]interface{}{
		"claudeAiOauth": map[string]interface{}{
			"expiresAt": expiresAt,
		},
	})

	h, _ := newOAuthTestHandler(t)
	req := httptest.NewRequest("GET", "/api/system/token-status", nil)
	w := httptest.NewRecorder()
	h.TokenStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "warning" {
		t.Errorf("expected status 'warning', got %q", resp["status"])
	}
}

func TestTokenStatus_MissingFile(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	h, _ := newOAuthTestHandler(t)
	req := httptest.NewRequest("GET", "/api/system/token-status", nil)
	w := httptest.NewRecorder()
	h.TokenStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "unknown" {
		t.Errorf("expected status 'unknown', got %q", resp["status"])
	}
	if !strings.Contains(resp["message"], "not accessible") {
		t.Errorf("expected actionable message about credentials, got %q", resp["message"])
	}
}

func TestTokenStatus_NoOAuthKey(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("HOME", tmpHome)

	writeTestCredentials(t, tmpHome, map[string]interface{}{
		"someOtherField": true,
	})

	h, _ := newOAuthTestHandler(t)
	req := httptest.NewRequest("GET", "/api/system/token-status", nil)
	w := httptest.NewRecorder()
	h.TokenStatus(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]string
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["status"] != "unknown" {
		t.Errorf("expected status 'unknown', got %q", resp["status"])
	}
	if !strings.Contains(resp["message"], "No OAuth credentials") {
		t.Errorf("expected message about missing OAuth, got %q", resp["message"])
	}
}
