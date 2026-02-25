package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"nova-dashboard/models"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.uber.org/zap"
)

type NSTestHandler struct {
	runsCol     *mongo.Collection
	coverageCol *mongo.Collection
	logger      *zap.Logger
}

func NewNSTestHandler(runsCol, coverageCol *mongo.Collection, logger *zap.Logger) *NSTestHandler {
	return &NSTestHandler{runsCol: runsCol, coverageCol: coverageCol, logger: logger}
}

func (h *NSTestHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/ns-tests/runs", h.CreateRun)
	mux.HandleFunc("GET /api/ns-tests/runs", h.ListRuns)
	mux.HandleFunc("GET /api/ns-tests/runs/{date}", h.GetRunByDate)
	mux.HandleFunc("GET /api/ns-tests/coverage", h.GetCoverage)
	mux.HandleFunc("PUT /api/ns-tests/coverage", h.UpdateCoverage)
	mux.HandleFunc("GET /api/ns-tests/summary", h.GetSummary)
}

// CreateRun saves a new test run
func (h *NSTestHandler) CreateRun(w http.ResponseWriter, r *http.Request) {
	var run models.NSTestRun
	if err := json.NewDecoder(r.Body).Decode(&run); err != nil {
		http.Error(w, `{"error": "invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if run.Date == "" || run.ScenarioName == "" {
		http.Error(w, `{"error": "date and scenarioName are required"}`, http.StatusBadRequest)
		return
	}

	run.CreatedAt = time.Now()

	_, err := h.runsCol.InsertOne(r.Context(), run)
	if err != nil {
		h.logger.Error("failed to insert test run", zap.Error(err))
		http.Error(w, `{"error": "failed to save"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(run)
}

// ListRuns returns test runs, newest first
func (h *NSTestHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
	opts := options.Find().SetSort(bson.D{{Key: "date", Value: -1}}).SetLimit(30)
	cursor, err := h.runsCol.Find(r.Context(), bson.M{}, opts)
	if err != nil {
		h.logger.Error("failed to list test runs", zap.Error(err))
		http.Error(w, `{"error": "query failed"}`, http.StatusInternalServerError)
		return
	}
	defer cursor.Close(r.Context())

	var runs []models.NSTestRun
	if err := cursor.All(r.Context(), &runs); err != nil {
		h.logger.Error("failed to decode test runs", zap.Error(err))
		http.Error(w, `{"error": "decode failed"}`, http.StatusInternalServerError)
		return
	}

	if runs == nil {
		runs = []models.NSTestRun{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(runs)
}

// GetRunByDate returns the test run for a specific date
func (h *NSTestHandler) GetRunByDate(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	var run models.NSTestRun
	err := h.runsCol.FindOne(r.Context(), bson.M{"date": date}).Decode(&run)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			http.Error(w, `{"error": "not found"}`, http.StatusNotFound)
			return
		}
		h.logger.Error("failed to get test run", zap.Error(err))
		http.Error(w, `{"error": "query failed"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(run)
}

// GetCoverage returns all coverage entries
func (h *NSTestHandler) GetCoverage(w http.ResponseWriter, r *http.Request) {
	opts := options.Find().SetSort(bson.D{{Key: "category", Value: 1}, {Key: "feature", Value: 1}})
	cursor, err := h.coverageCol.Find(r.Context(), bson.M{}, opts)
	if err != nil {
		h.logger.Error("failed to list coverage", zap.Error(err))
		http.Error(w, `{"error": "query failed"}`, http.StatusInternalServerError)
		return
	}
	defer cursor.Close(r.Context())

	var items []models.NSTestCoverage
	if err := cursor.All(r.Context(), &items); err != nil {
		h.logger.Error("failed to decode coverage", zap.Error(err))
		http.Error(w, `{"error": "decode failed"}`, http.StatusInternalServerError)
		return
	}

	if items == nil {
		items = []models.NSTestCoverage{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// UpdateCoverage upserts a coverage entry by feature name
func (h *NSTestHandler) UpdateCoverage(w http.ResponseWriter, r *http.Request) {
	var item models.NSTestCoverage
	if err := json.NewDecoder(r.Body).Decode(&item); err != nil {
		http.Error(w, `{"error": "invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if item.Feature == "" || item.Category == "" {
		http.Error(w, `{"error": "feature and category are required"}`, http.StatusBadRequest)
		return
	}

	item.UpdatedAt = time.Now()

	_, err := h.coverageCol.UpdateOne(
		r.Context(),
		bson.M{"feature": item.Feature, "category": item.Category},
		bson.M{"$set": item},
		options.UpdateOne().SetUpsert(true),
	)
	if err != nil {
		h.logger.Error("failed to upsert coverage", zap.Error(err))
		http.Error(w, `{"error": "update failed"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(item)
}

// GetSummary returns a quick summary of testing health
func (h *NSTestHandler) GetSummary(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Count total runs
	totalRuns, _ := h.runsCol.CountDocuments(ctx, bson.M{})

	// Get latest run
	var latestRun models.NSTestRun
	opts := options.FindOne().SetSort(bson.D{{Key: "date", Value: -1}})
	h.runsCol.FindOne(ctx, bson.M{}, opts).Decode(&latestRun)

	// Count coverage stats
	totalFeatures, _ := h.coverageCol.CountDocuments(ctx, bson.M{})
	passedFeatures, _ := h.coverageCol.CountDocuments(ctx, bson.M{"status": "pass"})
	failedFeatures, _ := h.coverageCol.CountDocuments(ctx, bson.M{"status": "fail"})
	notTested, _ := h.coverageCol.CountDocuments(ctx, bson.M{"status": "not_tested"})

	// Count total bugs across all runs
	// Simple approach: count from latest run
	bugCount := len(latestRun.BugsFound)

	summary := map[string]interface{}{
		"totalRuns":      totalRuns,
		"latestDate":     latestRun.Date,
		"latestScenario": latestRun.ScenarioName,
		"latestStatus":   latestRun.Status,
		"latestBugs":     bugCount,
		"coverage": map[string]int64{
			"total":     totalFeatures,
			"passed":    passedFeatures,
			"failed":    failedFeatures,
			"notTested": notTested,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(summary)
}
