package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"
)

func newTestLogger() *zap.Logger {
	return zap.NewNop()
}

// withTestAllowedFiles temporarily replaces the package-level allowedFiles map
// and restores the original on test cleanup.
func withTestAllowedFiles(t *testing.T, files map[string]string) {
	t.Helper()
	original := allowedFiles
	allowedFiles = files
	t.Cleanup(func() { allowedFiles = original })
}

// --- GetFile tests ---

func TestGetFile_Success(t *testing.T) {
	dir := t.TempDir()
	testFile := filepath.Join(dir, "TEST.md")
	os.WriteFile(testFile, []byte("# Hello\nWorld"), 0644)

	withTestAllowedFiles(t, map[string]string{"test": testFile})
	h := NewInspectHandler(newTestLogger())

	req := httptest.NewRequest("GET", "/api/inspect/test", nil)
	req.SetPathValue("file", "test")
	w := httptest.NewRecorder()
	h.GetFile(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["content"] != "# Hello\nWorld" {
		t.Errorf("unexpected content: %q", resp["content"])
	}
	if resp["file"] != "test" {
		t.Errorf("unexpected file: %q", resp["file"])
	}
	if int(resp["size"].(float64)) != 13 {
		t.Errorf("unexpected size: %v", resp["size"])
	}
}

func TestGetFile_NotAllowed(t *testing.T) {
	withTestAllowedFiles(t, map[string]string{})
	h := NewInspectHandler(newTestLogger())

	req := httptest.NewRequest("GET", "/api/inspect/secret", nil)
	req.SetPathValue("file", "secret")
	w := httptest.NewRecorder()
	h.GetFile(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestGetFile_NotFound(t *testing.T) {
	withTestAllowedFiles(t, map[string]string{"missing": "/tmp/nonexistent-inspect-test-file.md"})
	h := NewInspectHandler(newTestLogger())

	req := httptest.NewRequest("GET", "/api/inspect/missing", nil)
	req.SetPathValue("file", "missing")
	w := httptest.NewRecorder()
	h.GetFile(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// --- SaveFile tests ---

func TestSaveFile_Success(t *testing.T) {
	dir := t.TempDir()
	testFile := filepath.Join(dir, "EDITABLE.md")
	os.WriteFile(testFile, []byte("original"), 0644)

	withTestAllowedFiles(t, map[string]string{"editable": testFile})
	h := NewInspectHandler(newTestLogger())

	body := `{"content": "updated content"}`
	req := httptest.NewRequest("PUT", "/api/inspect/editable", strings.NewReader(body))
	req.SetPathValue("file", "editable")
	w := httptest.NewRecorder()
	h.SaveFile(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.NewDecoder(w.Body).Decode(&resp)
	if resp["success"] != true {
		t.Errorf("expected success=true, got %v", resp["success"])
	}
	if int(resp["size"].(float64)) != 15 {
		t.Errorf("expected size 15, got %v", resp["size"])
	}

	// Verify file on disk
	data, err := os.ReadFile(testFile)
	if err != nil {
		t.Fatalf("failed to read file: %v", err)
	}
	if string(data) != "updated content" {
		t.Errorf("file content mismatch: %q", string(data))
	}
}

func TestSaveFile_NotAllowed(t *testing.T) {
	withTestAllowedFiles(t, map[string]string{})
	h := NewInspectHandler(newTestLogger())

	body := `{"content": "hacked"}`
	req := httptest.NewRequest("PUT", "/api/inspect/secret", strings.NewReader(body))
	req.SetPathValue("file", "secret")
	w := httptest.NewRecorder()
	h.SaveFile(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestSaveFile_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	testFile := filepath.Join(dir, "SAFE.md")
	os.WriteFile(testFile, []byte("original"), 0644)

	withTestAllowedFiles(t, map[string]string{"safe": testFile})
	h := NewInspectHandler(newTestLogger())

	req := httptest.NewRequest("PUT", "/api/inspect/safe", strings.NewReader("not json"))
	req.SetPathValue("file", "safe")
	w := httptest.NewRecorder()
	h.SaveFile(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}

	// Verify original file unchanged
	data, _ := os.ReadFile(testFile)
	if string(data) != "original" {
		t.Errorf("file should be unchanged, got: %q", string(data))
	}
}

func TestSaveFile_EmptyFileParam(t *testing.T) {
	h := NewInspectHandler(newTestLogger())

	body := `{"content": "test"}`
	req := httptest.NewRequest("PUT", "/api/inspect/", strings.NewReader(body))
	req.SetPathValue("file", "")
	w := httptest.NewRecorder()
	h.SaveFile(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestSaveFile_WriteFailure(t *testing.T) {
	// Point to a non-existent directory so WriteFile fails
	badPath := "/tmp/nonexistent-dir-inspect-test/sub/FILE.md"
	withTestAllowedFiles(t, map[string]string{"broken": badPath})
	h := NewInspectHandler(newTestLogger())

	body := `{"content": "test"}`
	req := httptest.NewRequest("PUT", "/api/inspect/broken", strings.NewReader(body))
	req.SetPathValue("file", "broken")
	w := httptest.NewRecorder()
	h.SaveFile(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}
