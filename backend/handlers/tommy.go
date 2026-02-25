package handlers

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.uber.org/zap"
)

type TommyHandler struct {
	logger             *zap.Logger
	digestsDir         string
	findsCollection    *mongo.Collection
	sessionsCollection *mongo.Collection
	postsCollection    *mongo.Collection
}

type TommyPost struct {
	ID              bson.ObjectID          `json:"id" bson:"_id,omitempty"`
	PostID          string                 `json:"postId" bson:"postId"`
	PostURL         string                 `json:"postUrl" bson:"postUrl"`
	Text            string                 `json:"text" bson:"text"`
	Type            string                 `json:"type" bson:"type"`
	QuotedPostID    string                 `json:"quotedPostId,omitempty" bson:"quotedPostId,omitempty"`
	QuotedPostURL   string                 `json:"quotedPostUrl,omitempty" bson:"quotedPostUrl,omitempty"`
	QuotedAuthor    string                 `json:"quotedAuthor,omitempty" bson:"quotedAuthor,omitempty"`
	SocialImagePath string                 `json:"socialImagePath,omitempty" bson:"socialImagePath,omitempty"`
	Ticker          string                 `json:"ticker,omitempty" bson:"ticker,omitempty"`
	Engagement      map[string]interface{} `json:"engagementSnapshot,omitempty" bson:"engagementSnapshot,omitempty"`
	PostedAt        time.Time              `json:"postedAt" bson:"postedAt"`
	CreatedAt       time.Time              `json:"createdAt" bson:"createdAt"`
}

type PostsResponse struct {
	Posts []TommyPost `json:"posts"`
	Total int64       `json:"total"`
}

type DigestEntry struct {
	Date    string `json:"date"`
	Content string `json:"content"`
}

type DigestsResponse struct {
	Digests []DigestEntry `json:"digests"`
}

type TweetEntry struct {
	Username string `json:"username"`
	Text     string `json:"text"`
	URL      string `json:"url"`
	Why      string `json:"why"`
	Date     string `json:"date"`
}

type FeedResponse struct {
	Tweets []TweetEntry `json:"tweets"`
}

// MongoDB-based types for X browsing sessions
type TommyFind struct {
	ID               bson.ObjectID `json:"id" bson:"_id,omitempty"`
	PostID           string        `json:"postId" bson:"postId"`
	PostURL          string        `json:"postUrl" bson:"postUrl"`
	PostText         string        `json:"postText" bson:"postText"`
	AuthorHandle     string        `json:"authorHandle" bson:"authorHandle"`
	AuthorName       string        `json:"authorName" bson:"authorName"`
	AuthorVerified   bool          `json:"authorVerified" bson:"authorVerified"`
	HasMedia         bool          `json:"hasMedia" bson:"hasMedia"`
	MediaType        string        `json:"mediaType" bson:"mediaType"`
	MatchedInterests []string      `json:"matchedInterests" bson:"matchedInterests"`
	MatchedTickers   []string      `json:"matchedTickers" bson:"matchedTickers"`
	RelevanceNote    string        `json:"relevanceNote" bson:"relevanceNote"`
	SessionID        string        `json:"sessionId" bson:"sessionId"`
	FoundAt          time.Time     `json:"foundAt" bson:"foundAt"`
	FoundIn          string        `json:"foundIn" bson:"foundIn"`
	SearchQuery      string        `json:"searchQuery,omitempty" bson:"searchQuery,omitempty"`
	Liked            bool          `json:"liked" bson:"liked"`
	Followed         bool          `json:"followed" bson:"followed"`
	Score            float64       `json:"score" bson:"score"`
	SessionType      string        `json:"sessionType" bson:"sessionType"`
	QuotedRt         bool          `json:"quotedRt" bson:"quotedRt"`
	CreatedAt        time.Time     `json:"createdAt" bson:"createdAt"`
}

type TommySession struct {
	ID                 bson.ObjectID `json:"id" bson:"_id,omitempty"`
	SessionID          string        `json:"sessionId" bson:"sessionId"`
	StartedAt          time.Time     `json:"startedAt" bson:"startedAt"`
	EndedAt            time.Time     `json:"endedAt" bson:"endedAt"`
	Duration           int           `json:"duration" bson:"duration"`
	PostsViewed        int           `json:"postsViewed" bson:"postsViewed"`
	Likes              int           `json:"likes" bson:"likes"`
	Follows            int           `json:"follows" bson:"follows"`
	FindsCount         int           `json:"findsCount" bson:"findsCount"`
	StealthCheckPassed bool          `json:"stealthCheckPassed" bson:"stealthCheckPassed"`
	IPVerified         string        `json:"ipVerified" bson:"ipVerified"`
	Errors             []string      `json:"errors" bson:"errors"`
	CreatedAt          time.Time     `json:"createdAt" bson:"createdAt"`
}

type FindsResponse struct {
	Finds []TommyFind `json:"finds"`
	Total int64       `json:"total"`
}

type SessionsResponse struct {
	Sessions []TommySession `json:"sessions"`
	Total    int64          `json:"total"`
}

type TommyStatsResponse struct {
	TodayFinds    int64 `json:"todayFinds"`
	TodayLikes    int64 `json:"todayLikes"`
	TodayFollows  int64 `json:"todayFollows"`
	TodaySessions int64 `json:"todaySessions"`
	WeekFinds     int64 `json:"weekFinds"`
	TotalFinds    int64 `json:"totalFinds"`
	TotalSessions int64 `json:"totalSessions"`
}

func NewTommyHandler(logger *zap.Logger, findsCol, sessionsCol, postsCol *mongo.Collection) *TommyHandler {
	homeDir, _ := os.UserHomeDir()
	return &TommyHandler{
		logger:             logger,
		digestsDir:         filepath.Join(homeDir, "clawd-tommy", "digests"),
		findsCollection:    findsCol,
		sessionsCollection: sessionsCol,
		postsCollection:    postsCol,
	}
}

func (h *TommyHandler) RegisterRoutes(mux *http.ServeMux) {
	// Legacy digest endpoints (markdown-based)
	mux.HandleFunc("GET /api/tommy/digests", h.GetDigests)
	mux.HandleFunc("GET /api/tommy/digests/{date}", h.GetDigest)
	mux.HandleFunc("GET /api/tommy/feed", h.GetFeed)

	// New MongoDB-based endpoints for X browsing
	mux.HandleFunc("GET /api/tommy/finds", h.GetFinds)
	mux.HandleFunc("GET /api/tommy/sessions", h.GetSessions)
	mux.HandleFunc("GET /api/tommy/stats", h.GetStats)
	mux.HandleFunc("GET /api/tommy/posts", h.GetPosts)
}

// GetFinds returns Tommy's X finds from MongoDB
func (h *TommyHandler) GetFinds(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Parse query params
	limitStr := r.URL.Query().Get("limit")
	limit := int64(50)
	if limitStr != "" {
		if parsed, err := strconv.ParseInt(limitStr, 10, 64); err == nil && parsed > 0 {
			limit = parsed
			if limit > 100 {
				limit = 100
			}
		}
	}

	dateFilter := r.URL.Query().Get("date")
	daysStr := r.URL.Query().Get("days")
	foundIn := r.URL.Query().Get("foundIn")
	sessionType := r.URL.Query().Get("sessionType")
	minScoreStr := r.URL.Query().Get("minScore")

	// Build filter
	filter := bson.M{}
	if dateFilter != "" {
		startOfDay, err := time.Parse("2006-01-02", dateFilter)
		if err == nil {
			endOfDay := startOfDay.Add(24 * time.Hour)
			filter["foundAt"] = bson.M{
				"$gte": startOfDay,
				"$lt":  endOfDay,
			}
		}
	} else if daysStr != "" {
		if days, err := strconv.Atoi(daysStr); err == nil && days > 0 && days <= 365 {
			cutoff := time.Now().AddDate(0, 0, -days)
			filter["foundAt"] = bson.M{"$gte": cutoff}
		}
	}
	if foundIn != "" {
		filter["foundIn"] = foundIn
	}
	if sessionType != "" {
		filter["sessionType"] = sessionType
	}
	if minScoreStr != "" {
		if minScore, err := strconv.ParseFloat(minScoreStr, 64); err == nil {
			filter["score"] = bson.M{"$gte": minScore}
		}
	}

	// Count total
	total, err := h.findsCollection.CountDocuments(ctx, filter)
	if err != nil {
		h.logger.Error("failed to count finds", zap.Error(err))
		total = 0
	}

	// Get finds, sorted by score descending (highest first), then foundAt descending (newest first)
	opts := options.Find().
		SetSort(bson.D{{Key: "score", Value: -1}, {Key: "foundAt", Value: -1}}).
		SetLimit(limit)

	cursor, err := h.findsCollection.Find(ctx, filter, opts)
	if err != nil {
		h.logger.Error("failed to query finds", zap.Error(err))
		writeJSON(w, http.StatusOK, FindsResponse{Finds: []TommyFind{}, Total: 0})
		return
	}
	defer cursor.Close(ctx)

	var finds []TommyFind
	if err := cursor.All(ctx, &finds); err != nil {
		h.logger.Error("failed to decode finds", zap.Error(err))
		writeJSON(w, http.StatusOK, FindsResponse{Finds: []TommyFind{}, Total: 0})
		return
	}

	if finds == nil {
		finds = []TommyFind{}
	}

	h.logger.Info("fetched tommy finds", zap.Int("count", len(finds)), zap.Int64("total", total))
	writeJSON(w, http.StatusOK, FindsResponse{Finds: finds, Total: total})
}

// GetSessions returns Tommy's X browsing sessions from MongoDB
func (h *TommyHandler) GetSessions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	limitStr := r.URL.Query().Get("limit")
	limit := int64(50)
	if limitStr != "" {
		if parsed, err := strconv.ParseInt(limitStr, 10, 64); err == nil && parsed > 0 {
			limit = parsed
			if limit > 100 {
				limit = 100
			}
		}
	}

	// Count total
	total, err := h.sessionsCollection.CountDocuments(ctx, bson.M{})
	if err != nil {
		h.logger.Error("failed to count sessions", zap.Error(err))
		total = 0
	}

	// Get sessions, sorted by startedAt descending
	opts := options.Find().
		SetSort(bson.D{{Key: "startedAt", Value: -1}}).
		SetLimit(limit)

	cursor, err := h.sessionsCollection.Find(ctx, bson.M{}, opts)
	if err != nil {
		h.logger.Error("failed to query sessions", zap.Error(err))
		writeJSON(w, http.StatusOK, SessionsResponse{Sessions: []TommySession{}, Total: 0})
		return
	}
	defer cursor.Close(ctx)

	var sessions []TommySession
	if err := cursor.All(ctx, &sessions); err != nil {
		h.logger.Error("failed to decode sessions", zap.Error(err))
		writeJSON(w, http.StatusOK, SessionsResponse{Sessions: []TommySession{}, Total: 0})
		return
	}

	if sessions == nil {
		sessions = []TommySession{}
	}

	h.logger.Info("fetched tommy sessions", zap.Int("count", len(sessions)), zap.Int64("total", total))
	writeJSON(w, http.StatusOK, SessionsResponse{Sessions: sessions, Total: total})
}

// GetStats returns aggregated stats for Tommy's X activity
func (h *TommyHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	now := time.Now()
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	startOfWeek := startOfToday.AddDate(0, 0, -7)

	// Today's finds
	todayFinds, _ := h.findsCollection.CountDocuments(ctx, bson.M{
		"foundAt": bson.M{"$gte": startOfToday},
	})

	// Today's likes (from finds)
	todayLikes, _ := h.findsCollection.CountDocuments(ctx, bson.M{
		"foundAt": bson.M{"$gte": startOfToday},
		"liked":   true,
	})

	// Today's follows (from finds)
	todayFollows, _ := h.findsCollection.CountDocuments(ctx, bson.M{
		"foundAt":  bson.M{"$gte": startOfToday},
		"followed": true,
	})

	// Today's sessions
	todaySessions, _ := h.sessionsCollection.CountDocuments(ctx, bson.M{
		"startedAt": bson.M{"$gte": startOfToday},
	})

	// Week's finds
	weekFinds, _ := h.findsCollection.CountDocuments(ctx, bson.M{
		"foundAt": bson.M{"$gte": startOfWeek},
	})

	// Total finds
	totalFinds, _ := h.findsCollection.CountDocuments(ctx, bson.M{})

	// Total sessions
	totalSessions, _ := h.sessionsCollection.CountDocuments(ctx, bson.M{})

	writeJSON(w, http.StatusOK, TommyStatsResponse{
		TodayFinds:    todayFinds,
		TodayLikes:    todayLikes,
		TodayFollows:  todayFollows,
		TodaySessions: todaySessions,
		WeekFinds:     weekFinds,
		TotalFinds:    totalFinds,
		TotalSessions: totalSessions,
	})
}

// GetPosts returns Tommy's own posts from MongoDB
func (h *TommyHandler) GetPosts(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	limitStr := r.URL.Query().Get("limit")
	limit := int64(20)
	if limitStr != "" {
		if parsed, err := strconv.ParseInt(limitStr, 10, 64); err == nil && parsed > 0 {
			limit = parsed
			if limit > 100 {
				limit = 100
			}
		}
	}

	postType := r.URL.Query().Get("type")

	filter := bson.M{}
	if postType != "" {
		filter["type"] = postType
	}

	total, err := h.postsCollection.CountDocuments(ctx, filter)
	if err != nil {
		h.logger.Error("failed to count posts", zap.Error(err))
		total = 0
	}

	opts := options.Find().
		SetSort(bson.D{{Key: "postedAt", Value: -1}}).
		SetLimit(limit)

	cursor, err := h.postsCollection.Find(ctx, filter, opts)
	if err != nil {
		h.logger.Error("failed to query posts", zap.Error(err))
		writeJSON(w, http.StatusOK, PostsResponse{Posts: []TommyPost{}, Total: 0})
		return
	}
	defer cursor.Close(ctx)

	var posts []TommyPost
	if err := cursor.All(ctx, &posts); err != nil {
		h.logger.Error("failed to decode posts", zap.Error(err))
		writeJSON(w, http.StatusOK, PostsResponse{Posts: []TommyPost{}, Total: 0})
		return
	}

	if posts == nil {
		posts = []TommyPost{}
	}

	writeJSON(w, http.StatusOK, PostsResponse{Posts: posts, Total: total})
}

// Legacy handlers for markdown-based digests

func (h *TommyHandler) GetDigests(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(h.digestsDir)
	if err != nil {
		h.logger.Warn("failed to read digests directory", zap.Error(err))
		writeJSON(w, http.StatusOK, DigestsResponse{Digests: []DigestEntry{}})
		return
	}

	var digests []DigestEntry
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		if entry.Name() == "README.md" {
			continue
		}

		date := strings.TrimSuffix(entry.Name(), ".md")
		content, err := os.ReadFile(filepath.Join(h.digestsDir, entry.Name()))
		if err != nil {
			h.logger.Warn("failed to read digest file", zap.String("file", entry.Name()), zap.Error(err))
			continue
		}

		digests = append(digests, DigestEntry{
			Date:    date,
			Content: string(content),
		})
	}

	// Sort by date descending (newest first)
	sort.Slice(digests, func(i, j int) bool {
		return digests[i].Date > digests[j].Date
	})

	writeJSON(w, http.StatusOK, DigestsResponse{Digests: digests})
}

func (h *TommyHandler) GetDigest(w http.ResponseWriter, r *http.Request) {
	date := r.PathValue("date")
	if date == "" {
		writeError(w, http.StatusBadRequest, "date parameter required")
		return
	}

	// Sanitize date to prevent path traversal
	date = filepath.Base(date)
	if !strings.HasSuffix(date, ".md") {
		date = date + ".md"
	}

	filePath := filepath.Join(h.digestsDir, date)
	content, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "digest not found")
		} else {
			writeError(w, http.StatusInternalServerError, "failed to read digest")
		}
		return
	}

	writeJSON(w, http.StatusOK, DigestEntry{
		Date:    strings.TrimSuffix(filepath.Base(date), ".md"),
		Content: string(content),
	})
}

func (h *TommyHandler) GetFeed(w http.ResponseWriter, r *http.Request) {
	daysStr := r.URL.Query().Get("days")
	days := 3 // default to 3 days
	if daysStr != "" {
		if parsed, err := strconv.Atoi(daysStr); err == nil && parsed > 0 {
			days = parsed
		}
	}

	h.logger.Info("fetching tommy feed", zap.Int("days", days))

	entries, err := os.ReadDir(h.digestsDir)
	if err != nil {
		h.logger.Warn("failed to read digests directory", zap.Error(err))
		writeJSON(w, http.StatusOK, FeedResponse{Tweets: []TweetEntry{}})
		return
	}

	// Get digest files and sort by date (newest first)
	var digestFiles []string
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") || entry.Name() == "README.md" {
			continue
		}
		digestFiles = append(digestFiles, entry.Name())
	}

	sort.Slice(digestFiles, func(i, j int) bool {
		return digestFiles[i] > digestFiles[j] // newest first
	})

	// Limit to requested number of days
	if len(digestFiles) > days {
		digestFiles = digestFiles[:days]
	}

	var allTweets []TweetEntry

	// Parse each digest file
	for _, filename := range digestFiles {
		content, err := os.ReadFile(filepath.Join(h.digestsDir, filename))
		if err != nil {
			h.logger.Warn("failed to read digest file", zap.String("file", filename), zap.Error(err))
			continue
		}

		date := strings.TrimSuffix(filename, ".md")
		tweets := h.parseTweets(string(content), date)
		allTweets = append(allTweets, tweets...)
	}

	h.logger.Info("parsed tweets", zap.Int("count", len(allTweets)))
	writeJSON(w, http.StatusOK, FeedResponse{Tweets: allTweets})
}

func (h *TommyHandler) parseTweets(content, date string) []TweetEntry {
	var tweets []TweetEntry

	// Regex to match the tweet pattern:
	// ### @username
	// > tweet text
	// 🔗 url
	// 💡 Why: explanation
	tweetRegex := regexp.MustCompile(`### @([^\n]+)\n> ([^🔗]+)🔗 ([^\n]+)\n💡 Why: ([^\n]+)`)

	matches := tweetRegex.FindAllStringSubmatch(content, -1)

	for _, match := range matches {
		if len(match) >= 5 {
			tweet := TweetEntry{
				Username: strings.TrimSpace(match[1]),
				Text:     strings.TrimSpace(match[2]),
				URL:      strings.TrimSpace(match[3]),
				Why:      strings.TrimSpace(match[4]),
				Date:     date,
			}
			tweets = append(tweets, tweet)
		}
	}

	h.logger.Debug("parsed tweets from digest", zap.String("date", date), zap.Int("count", len(tweets)))
	return tweets
}
