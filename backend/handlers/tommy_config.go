package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.uber.org/zap"
)

type TommyConfigHandler struct {
	logger           *zap.Logger
	configCollection *mongo.Collection
}

func NewTommyConfigHandler(logger *zap.Logger, configCol *mongo.Collection) *TommyConfigHandler {
	return &TommyConfigHandler{
		logger:           logger,
		configCollection: configCol,
	}
}

func (h *TommyConfigHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/tommy/config", h.GetConfig)
	mux.HandleFunc("PUT /api/tommy/config", h.SaveConfig)
}

func (h *TommyConfigHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var result bson.M
	err := h.configCollection.FindOne(ctx, bson.M{"_id": "tommy_config"}).Decode(&result)
	if err != nil {
		if err == mongo.ErrNoDocuments {
			// Return defaults
			writeJSON(w, http.StatusOK, defaultTommyConfig())
			return
		}
		h.logger.Error("failed to get config", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to get config")
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (h *TommyConfigHandler) SaveConfig(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to read body")
		return
	}

	var config bson.M
	if err := json.Unmarshal(body, &config); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	// Validate config fields
	if errs := validateTommyConfig(config); len(errs) > 0 {
		writeError(w, http.StatusBadRequest, "validation failed: "+strings.Join(errs, "; "))
		return
	}

	config["_id"] = "tommy_config"
	config["updatedAt"] = time.Now()

	opts := options.Replace().SetUpsert(true)
	_, err = h.configCollection.ReplaceOne(ctx, bson.M{"_id": "tommy_config"}, config, opts)
	if err != nil {
		h.logger.Error("failed to save config", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to save config")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// validateTommyConfig validates config fields and returns a list of errors.
func validateTommyConfig(config bson.M) []string {
	var errs []string

	// Helper to get a nested map
	getMap := func(key string) bson.M {
		if v, ok := config[key]; ok {
			if m, ok := v.(bson.M); ok {
				return m
			}
			if m, ok := v.(map[string]interface{}); ok {
				return bson.M(m)
			}
		}
		return nil
	}

	// Helper to validate a numeric field is within a range
	checkRange := func(section, field string, m bson.M, min, max float64) {
		if m == nil {
			return
		}
		v, ok := m[field]
		if !ok {
			return
		}
		var num float64
		switch n := v.(type) {
		case float64:
			num = n
		case int:
			num = float64(n)
		case int32:
			num = float64(n)
		case int64:
			num = float64(n)
		case json.Number:
			if f, err := n.Float64(); err == nil {
				num = f
			} else {
				errs = append(errs, fmt.Sprintf("%s.%s must be a number", section, field))
				return
			}
		default:
			errs = append(errs, fmt.Sprintf("%s.%s must be a number", section, field))
			return
		}
		if num < min || num > max {
			errs = append(errs, fmt.Sprintf("%s.%s must be between %.0f and %.0f", section, field, min, max))
		}
	}

	// Helper to validate numeric >= 0
	checkNonNeg := func(section, field string, m bson.M) {
		if m == nil {
			return
		}
		v, ok := m[field]
		if !ok {
			return
		}
		var num float64
		switch n := v.(type) {
		case float64:
			num = n
		case int:
			num = float64(n)
		case int32:
			num = float64(n)
		case int64:
			num = float64(n)
		case json.Number:
			if f, err := n.Float64(); err == nil {
				num = f
			} else {
				return
			}
		default:
			return
		}
		if num < 0 {
			errs = append(errs, fmt.Sprintf("%s.%s must be >= 0", section, field))
		}
	}

	// ai.model must be a non-empty string
	if aiMap := getMap("ai"); aiMap != nil {
		if model, ok := aiMap["model"]; ok {
			if s, ok := model.(string); ok {
				if strings.TrimSpace(s) == "" {
					errs = append(errs, "ai.model must be a non-empty string")
				}
			} else {
				errs = append(errs, "ai.model must be a non-empty string")
			}
		}
		checkNonNeg("ai", "minScoreToLike", aiMap)
		checkNonNeg("ai", "minScoreToFollow", aiMap)
		checkNonNeg("ai", "minScoreToPost", aiMap)
		checkNonNeg("ai", "minScoreToSave", aiMap)
	}

	// posting validation
	if postMap := getMap("posting"); postMap != nil {
		checkRange("posting", "maxQuoteRTsPerDay", postMap, 0, 10)
		checkRange("posting", "maxPickPostsPerDay", postMap, 0, 10)
		checkRange("posting", "maxWords", postMap, 5, 50)
	}

	// rateLimits validation
	if rlMap := getMap("rateLimits"); rlMap != nil {
		checkRange("rateLimits", "apiDelayMs", rlMap, 500, 30000)
		checkRange("rateLimits", "engagementDelayMs", rlMap, 500, 30000)
		checkRange("rateLimits", "searchDelayMs", rlMap, 500, 30000)
	}

	// budget validation
	if budgetMap := getMap("budget"); budgetMap != nil {
		checkRange("budget", "monthlyXBudget", budgetMap, 1, 100)
	}

	// Numeric fields in explore/market must be >= 0
	for _, section := range []string{"explore", "market"} {
		if m := getMap(section); m != nil {
			for field := range m {
				checkNonNeg(section, field, m)
			}
		}
	}

	return errs
}

func defaultTommyConfig() map[string]interface{} {
	return map[string]interface{}{
		"_id": "tommy_config",
		"explore": map[string]interface{}{
			"maxTimelinePosts": 25,
			"maxSearchResults": 10,
			"maxLikes":         3,
			"maxFollows":       1,
			"maxSearches":      1,
		},
		"market": map[string]interface{}{
			"watchlist":        []string{"RKLB", "TSLA"},
			"maxSearches":      8,
			"maxSearchResults": 15,
			"maxLikes":         5,
			"minScoreToLike":   7,
			"minScoreToDigest": 7,
		},
		"ai": map[string]interface{}{
			"model":            "gpt-5-mini",
			"minScoreToLike":   7,
			"minScoreToFollow": 8,
			"minScoreToPost":   8,
			"minScoreToSave":   5,
		},
		"posting": map[string]interface{}{
			"enabled":            true,
			"maxQuoteRTsPerDay":  2,
			"maxPickPostsPerDay": 1,
			"maxWords":           20,
		},
		"rateLimits": map[string]interface{}{
			"apiDelayMs":        2000,
			"engagementDelayMs": 5000,
			"searchDelayMs":     3000,
		},
		"budget": map[string]interface{}{
			"monthlyXBudget": 10.00,
		},
		"victorProfile": map[string]interface{}{
			"username":        "victor__vector",
			"maxLikesToScan":  20,
			"maxTweetsToScan": 10,
		},
		"maxLikesPerAuthor": 2,
	}
}
