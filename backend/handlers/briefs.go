package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.uber.org/zap"

	"nova-dashboard/models"
)

type BriefsHandler struct {
	col    *mongo.Collection
	db     *mongo.Database
	logger *zap.Logger
}

func NewBriefsHandler(col *mongo.Collection, db *mongo.Database, logger *zap.Logger) *BriefsHandler {
	return &BriefsHandler{col: col, db: db, logger: logger}
}

func (h *BriefsHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/briefs", h.CreateBrief)
	mux.HandleFunc("GET /api/briefs", h.ListBriefs)
	mux.HandleFunc("GET /api/briefs/{date}", h.GetBriefByDate)
	mux.HandleFunc("GET /api/briefs/search", h.SearchBriefs)
}

// CreateBrief saves a new morning brief
func (h *BriefsHandler) CreateBrief(w http.ResponseWriter, r *http.Request) {
	var brief models.MorningBrief
	if err := json.NewDecoder(r.Body).Decode(&brief); err != nil {
		h.logger.Error("failed to decode brief request", zap.Error(err))
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	brief.ApplyDefaults()
	if err := brief.Validate(); err != nil {
		h.logger.Error("brief validation failed", zap.Error(err))
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Check if brief for this date already exists
	filter := bson.M{"date": brief.Date}
	var existing models.MorningBrief
	err := h.col.FindOne(r.Context(), filter).Decode(&existing)
	if err == nil {
		// Update existing brief instead of creating new one
		update := bson.M{
			"$set": bson.M{
				"content":  brief.Content,
				"headline": brief.Headline,
			},
		}
		result, err := h.col.UpdateOne(r.Context(), filter, update)
		if err != nil {
			h.logger.Error("failed to update brief", zap.Error(err))
			http.Error(w, "Failed to update brief", http.StatusInternalServerError)
			return
		}
		h.logger.Info("brief updated", zap.String("date", brief.Date), zap.Int64("modified", result.ModifiedCount))

		// Return updated brief
		err = h.col.FindOne(r.Context(), filter).Decode(&existing)
		if err != nil {
			h.logger.Error("failed to fetch updated brief", zap.Error(err))
			http.Error(w, "Failed to fetch updated brief", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(existing)
		return
	} else if err != mongo.ErrNoDocuments {
		h.logger.Error("failed to check existing brief", zap.Error(err))
		http.Error(w, "Failed to check existing brief", http.StatusInternalServerError)
		return
	}

	// Create new brief
	result, err := h.col.InsertOne(r.Context(), brief)
	if err != nil {
		h.logger.Error("failed to insert brief", zap.Error(err))
		http.Error(w, "Failed to save brief", http.StatusInternalServerError)
		return
	}

	brief.ID = result.InsertedID.(bson.ObjectID)
	h.logger.Info("brief created", zap.String("id", brief.ID.Hex()), zap.String("date", brief.Date))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(brief)
}

// ListBriefs returns paginated list of briefs, newest first
func (h *BriefsHandler) ListBriefs(w http.ResponseWriter, r *http.Request) {
	// Parse pagination parameters
	page := 1
	limit := 10

	if p := r.URL.Query().Get("page"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
			page = parsed
		}
	}

	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	skip := (page - 1) * limit

	// Sort by date descending (newest first)
	opts := options.Find().
		SetSort(bson.M{"date": -1}).
		SetLimit(int64(limit)).
		SetSkip(int64(skip))

	cursor, err := h.col.Find(r.Context(), bson.M{}, opts)
	if err != nil {
		h.logger.Error("failed to find briefs", zap.Error(err))
		http.Error(w, "Failed to fetch briefs", http.StatusInternalServerError)
		return
	}
	defer cursor.Close(r.Context())

	briefs := []models.MorningBrief{}
	if err := cursor.All(r.Context(), &briefs); err != nil {
		h.logger.Error("failed to decode briefs", zap.Error(err))
		http.Error(w, "Failed to decode briefs", http.StatusInternalServerError)
		return
	}

	// Get total count for pagination metadata
	total, err := h.col.CountDocuments(r.Context(), bson.M{})
	if err != nil {
		h.logger.Error("failed to count briefs", zap.Error(err))
		total = 0 // Don't fail the request, just set count to 0
	}

	response := map[string]interface{}{
		"briefs": briefs,
		"pagination": map[string]interface{}{
			"page":       page,
			"limit":      limit,
			"total":      total,
			"totalPages": (total + int64(limit) - 1) / int64(limit), // Ceiling division
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// GetBriefByDate returns a specific brief by date
func (h *BriefsHandler) GetBriefByDate(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	if date == "" {
		http.Error(w, "Date parameter is required", http.StatusBadRequest)
		return
	}

	var brief models.MorningBrief
	err := h.col.FindOne(r.Context(), bson.M{"date": date}).Decode(&brief)
	if err == mongo.ErrNoDocuments {
		http.Error(w, "Brief not found", http.StatusNotFound)
		return
	}
	if err != nil {
		h.logger.Error("failed to find brief by date", zap.Error(err), zap.String("date", date))
		http.Error(w, "Failed to fetch brief", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(brief)
}

// SearchBriefs performs full-text search on briefs
func (h *BriefsHandler) SearchBriefs(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		http.Error(w, "Query parameter 'q' is required", http.StatusBadRequest)
		return
	}

	// Parse pagination parameters
	page := 1
	limit := 10

	if p := r.URL.Query().Get("page"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
			page = parsed
		}
	}

	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := strconv.Atoi(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}

	skip := (page - 1) * limit

	// Create text search filter - searches in content and headline
	filter := bson.M{
		"$or": []bson.M{
			{"content": bson.M{"$regex": query, "$options": "i"}},
			{"headline": bson.M{"$regex": query, "$options": "i"}},
		},
	}

	// Sort by date descending (newest first)
	opts := options.Find().
		SetSort(bson.M{"date": -1}).
		SetLimit(int64(limit)).
		SetSkip(int64(skip))

	cursor, err := h.col.Find(r.Context(), filter, opts)
	if err != nil {
		h.logger.Error("failed to search briefs", zap.Error(err), zap.String("query", query))
		http.Error(w, "Failed to search briefs", http.StatusInternalServerError)
		return
	}
	defer cursor.Close(r.Context())

	briefs := []models.MorningBrief{}
	if err := cursor.All(r.Context(), &briefs); err != nil {
		h.logger.Error("failed to decode search results", zap.Error(err))
		http.Error(w, "Failed to decode search results", http.StatusInternalServerError)
		return
	}

	// Get total count for the search
	total, err := h.col.CountDocuments(r.Context(), filter)
	if err != nil {
		h.logger.Error("failed to count search results", zap.Error(err))
		total = 0
	}

	response := map[string]interface{}{
		"briefs": briefs,
		"query":  query,
		"pagination": map[string]interface{}{
			"page":       page,
			"limit":      limit,
			"total":      total,
			"totalPages": (total + int64(limit) - 1) / int64(limit),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
