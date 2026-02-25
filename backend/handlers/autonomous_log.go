package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.uber.org/zap"

	"nova-dashboard/models"
)

// AutonomousLogHandler manages the autonomous improvement log
type AutonomousLogHandler struct {
	col    *mongo.Collection
	logger *zap.Logger
}

// NewAutonomousLogHandler creates a new handler
func NewAutonomousLogHandler(col *mongo.Collection, logger *zap.Logger) *AutonomousLogHandler {
	return &AutonomousLogHandler{col: col, logger: logger}
}

// RegisterRoutes registers the autonomous log API routes
func (h *AutonomousLogHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/autonomous-log", h.CreateEntry)
	mux.HandleFunc("GET /api/autonomous-log", h.ListEntries)
	mux.HandleFunc("PUT /api/autonomous-log/{id}", h.UpdateEntry)
}

// CreateEntry adds a new autonomous improvement log entry
func (h *AutonomousLogHandler) CreateEntry(w http.ResponseWriter, r *http.Request) {
	var entry models.AutonomousLogEntry
	if err := json.NewDecoder(r.Body).Decode(&entry); err != nil {
		h.logger.Error("failed to decode autonomous log entry", zap.Error(err))
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if entry.CardTitle == "" || entry.Reasoning == "" {
		http.Error(w, "cardTitle and reasoning are required", http.StatusBadRequest)
		return
	}

	now := time.Now()
	entry.CreatedAt = now
	entry.UpdatedAt = now
	if entry.Date == "" {
		entry.Date = now.Format("2006-01-02")
	}
	if entry.Outcome == "" {
		entry.Outcome = "pending"
	}

	result, err := h.col.InsertOne(r.Context(), entry)
	if err != nil {
		h.logger.Error("failed to insert autonomous log entry", zap.Error(err))
		http.Error(w, "Failed to save entry", http.StatusInternalServerError)
		return
	}

	entry.ID = result.InsertedID.(bson.ObjectID).Hex()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(entry)
}

// ListEntries returns autonomous log entries, newest first. Optional ?date=YYYY-MM-DD filter.
func (h *AutonomousLogHandler) ListEntries(w http.ResponseWriter, r *http.Request) {
	filter := bson.M{}
	if date := r.URL.Query().Get("date"); date != "" {
		filter["date"] = date
	}

	limit := int64(50)
	opts := options.Find().SetSort(bson.D{{Key: "createdAt", Value: -1}}).SetLimit(limit)

	cursor, err := h.col.Find(r.Context(), filter, opts)
	if err != nil {
		h.logger.Error("failed to query autonomous log", zap.Error(err))
		http.Error(w, "Failed to query entries", http.StatusInternalServerError)
		return
	}
	defer cursor.Close(r.Context())

	var entries []models.AutonomousLogEntry
	if err := cursor.All(r.Context(), &entries); err != nil {
		h.logger.Error("failed to decode autonomous log entries", zap.Error(err))
		http.Error(w, "Failed to decode entries", http.StatusInternalServerError)
		return
	}

	if entries == nil {
		entries = []models.AutonomousLogEntry{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entries)
}

// UpdateEntry updates an existing entry (e.g., to set outcome after completion)
func (h *AutonomousLogHandler) UpdateEntry(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.Error(w, "Missing id", http.StatusBadRequest)
		return
	}

	objID, err := bson.ObjectIDFromHex(id)
	if err != nil {
		http.Error(w, "Invalid id", http.StatusBadRequest)
		return
	}

	var update map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	update["updatedAt"] = time.Now()
	result, err := h.col.UpdateOne(r.Context(), bson.M{"_id": objID}, bson.M{"$set": update})
	if err != nil {
		h.logger.Error("failed to update autonomous log entry", zap.Error(err))
		http.Error(w, "Failed to update entry", http.StatusInternalServerError)
		return
	}

	if result.MatchedCount == 0 {
		http.Error(w, "Entry not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "updated"})
}
