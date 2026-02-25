package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.uber.org/zap"
)

type StocksHandler struct {
	logger       *zap.Logger
	cache        *StockPricesResponse
	cacheExpiry  time.Time
	cacheTTL     time.Duration
	watchlist    []string          // In-memory cache of watchlist symbols
	watchlistCol *mongo.Collection // MongoDB collection for persistence
	calendar     *TradingCalendar  // NYSE trading calendar
}

type WatchlistEntry struct {
	Symbol  string    `bson:"symbol" json:"symbol"`
	AddedAt time.Time `bson:"added_at" json:"added_at"`
}

type StockPrice struct {
	Symbol            string    `json:"symbol"`
	Price             float64   `json:"price"`
	Change            float64   `json:"change"`
	ChangePercent     float64   `json:"changePercent"`
	WeekChangePercent float64   `json:"weekChangePercent"`
	FiftyTwoWeekHigh  float64   `json:"fiftyTwoWeekHigh"`
	FiftyTwoWeekLow   float64   `json:"fiftyTwoWeekLow"`
	Volume            int64     `json:"volume"`
	PreviousClose     float64   `json:"previousClose"`
	DaySparkline      []float64 `json:"daySparkline"`
	WeekSparkline     []float64 `json:"weekSparkline"`
	LastUpdate        time.Time `json:"lastUpdate"`
	Currency          string    `json:"currency"`
	MarketCap         *float64  `json:"marketCap,omitempty"`
}

type MarketStatus struct {
	State         string     `json:"state"` // "pre", "regular", "post", "closed"
	IsOpen        bool       `json:"isOpen"`
	NextOpenTime  *time.Time `json:"nextOpenTime,omitempty"`
	NextCloseTime *time.Time `json:"nextCloseTime,omitempty"`
	CurrentTimeET string     `json:"currentTimeET"`
}

type StockPricesResponse struct {
	Stocks       []StockPrice `json:"stocks"`
	MarketStatus MarketStatus `json:"marketStatus"`
	Timestamp    time.Time    `json:"timestamp"`
	Source       string       `json:"source"`
}

type ChartMeta struct {
	Symbol               string   `json:"symbol"`
	RegularMarketPrice   float64  `json:"regularMarketPrice"`
	PreviousClose        float64  `json:"chartPreviousClose"` // Note: chart API uses chartPreviousClose, not previousClose
	Currency             string   `json:"currency"`
	MarketCap            *float64 `json:"marketCap"`
	FiftyTwoWeekHigh     float64  `json:"fiftyTwoWeekHigh"`
	FiftyTwoWeekLow      float64  `json:"fiftyTwoWeekLow"`
	Volume               int64    `json:"regularMarketVolume"`
	CurrentTradingPeriod struct {
		Pre struct {
			Start int64 `json:"start"`
			End   int64 `json:"end"`
		} `json:"pre"`
		Regular struct {
			Start int64 `json:"start"`
			End   int64 `json:"end"`
		} `json:"regular"`
		Post struct {
			Start int64 `json:"start"`
			End   int64 `json:"end"`
		} `json:"post"`
	} `json:"currentTradingPeriod"`
}

type ChartData struct {
	Meta   ChartMeta `json:"meta"`
	Closes []float64 `json:"closes"`
	Opens  []float64 `json:"opens"`
}

type QuoteResponse struct {
	QuoteResponse struct {
		Result []struct {
			Symbol                     string  `json:"symbol"`
			RegularMarketChangePercent float64 `json:"regularMarketChangePercent"`
			RegularMarketChange        float64 `json:"regularMarketChange"`
		} `json:"result"`
	} `json:"quoteResponse"`
}

func NewStocksHandler(watchlistCol *mongo.Collection, logger *zap.Logger) *StocksHandler {
	h := &StocksHandler{
		logger:       logger,
		cacheTTL:     60 * time.Second, // Cache for 60 seconds as specified in PRD
		watchlist:    []string{},       // Will be loaded from MongoDB
		watchlistCol: watchlistCol,
		calendar:     NewTradingCalendar(), // Initialize NYSE trading calendar
	}

	// Load watchlist from MongoDB on startup
	if err := h.loadWatchlistFromDB(); err != nil {
		logger.Warn("failed to load watchlist from MongoDB, using defaults", zap.Error(err))
		// Fall back to default watchlist if MongoDB load fails
		h.watchlist = []string{"TSLA", "AAPL", "GOOGL", "AMZN", "NVDA"}
	}

	return h
}

func (h *StocksHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/stocks/prices", h.GetPrices)
	mux.HandleFunc("GET /api/stocks/watchlist", h.GetWatchlist)
	mux.HandleFunc("POST /api/stocks/watchlist", h.AddToWatchlist)
	mux.HandleFunc("DELETE /api/stocks/watchlist/{symbol}", h.RemoveFromWatchlist)
}

func (h *StocksHandler) GetPrices(w http.ResponseWriter, r *http.Request) {
	// Get symbols from query param, default to watchlist
	symbols := r.URL.Query().Get("symbols")
	if symbols == "" {
		symbols = strings.Join(h.watchlist, ",")
	}

	symbolList := strings.Split(strings.ToUpper(symbols), ",")
	for i, symbol := range symbolList {
		symbolList[i] = strings.TrimSpace(symbol)
	}

	// Check cache first
	if h.cache != nil && time.Now().Before(h.cacheExpiry) {
		h.logger.Debug("returning cached stock prices", zap.Int("count", len(h.cache.Stocks)))
		writeJSON(w, http.StatusOK, h.cache)
		return
	}

	h.logger.Info("fetching stock prices", zap.Strings("symbols", symbolList))

	// Fetch stocks with enhanced data
	stocks, err := h.fetchStocksWithSparklines(symbolList)
	if err != nil {
		h.logger.Error("failed to fetch stock prices", zap.Error(err))
		// Return cached data if available, even if expired
		if h.cache != nil {
			h.logger.Warn("returning stale cached data due to API error")
			writeJSON(w, http.StatusOK, h.cache)
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{
			"error":   "Failed to fetch stock prices",
			"details": err.Error(),
		})
		return
	}

	// Calculate market status
	marketStatus := h.calculateMarketStatus()

	response := StockPricesResponse{
		Stocks:       stocks,
		MarketStatus: marketStatus,
		Timestamp:    time.Now().UTC(),
		Source:       "yahoo",
	}

	// Update cache
	h.cache = &response
	h.cacheExpiry = time.Now().Add(h.cacheTTL)

	h.logger.Info("returning stock prices", zap.Int("count", len(stocks)))
	writeJSON(w, http.StatusOK, response)
}

func (h *StocksHandler) fetchStocksWithSparklines(symbols []string) ([]StockPrice, error) {
	if len(symbols) == 0 {
		return []StockPrice{}, nil
	}

	// Fetch quote data for all symbols at once (batch request)
	quoteData, err := h.fetchQuoteData(symbols)
	if err != nil {
		h.logger.Warn("failed to fetch quote data, falling back to calculated day changes", zap.Error(err))
		quoteData = map[string]float64{} // Empty map, will fallback to calculated values
	}

	var allStocks []StockPrice
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	for _, symbol := range symbols {
		dayChangePercent, hasQuoteData := quoteData[symbol]
		stock, err := h.fetchSingleStock(client, symbol, dayChangePercent, hasQuoteData)
		if err != nil {
			h.logger.Warn("failed to fetch stock", zap.String("symbol", symbol), zap.Error(err))
			continue
		}
		allStocks = append(allStocks, *stock)
	}

	return allStocks, nil
}

func (h *StocksHandler) fetchSingleStock(client *http.Client, symbol string, dayChangePercent float64, hasQuoteData bool) (*StockPrice, error) {
	// Fetch week data + metadata (range=5d&interval=1d)
	weekData, err := h.fetchChartData(client, symbol, "5d", "1d")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch week data: %w", err)
	}

	// Fetch intraday data for day sparkline (range=1d&interval=5m)
	dayData, err := h.fetchChartData(client, symbol, "1d", "5m")
	if err != nil {
		h.logger.Warn("failed to fetch day data, continuing without sparkline", zap.String("symbol", symbol), zap.Error(err))
		dayData = &ChartData{} // Empty day data
	}

	// Calculate changes and build response
	meta := weekData.Meta

	// Day change: Use Yahoo's pre-calculated value if available, otherwise use proper trading day logic
	var change, changePercent float64
	if hasQuoteData {
		// Use Yahoo's authoritative pre-calculated day change percentage
		changePercent = dayChangePercent
		// Calculate the absolute change based on the percentage
		change = (changePercent / 100) * meta.RegularMarketPrice
	} else {
		// Calculate using proper trading day logic
		changePercent = h.calculateDayChange(symbol, meta.RegularMarketPrice)
		change = (changePercent / 100) * meta.RegularMarketPrice
	}

	// Week change: Calculate using proper trading day logic (FIXED!)
	weekChangePercent := h.calculateWeekChange(symbol, meta.RegularMarketPrice)

	return &StockPrice{
		Symbol:            meta.Symbol,
		Price:             meta.RegularMarketPrice,
		Change:            change,
		ChangePercent:     changePercent,
		WeekChangePercent: weekChangePercent,
		FiftyTwoWeekHigh:  meta.FiftyTwoWeekHigh,
		FiftyTwoWeekLow:   meta.FiftyTwoWeekLow,
		Volume:            meta.Volume,
		PreviousClose:     meta.PreviousClose,
		DaySparkline:      dayData.Closes,
		WeekSparkline:     weekData.Closes,
		Currency:          meta.Currency,
		MarketCap:         meta.MarketCap,
		LastUpdate:        time.Now().UTC(),
	}, nil
}

func (h *StocksHandler) fetchQuoteData(symbols []string) (map[string]float64, error) {
	if len(symbols) == 0 {
		return map[string]float64{}, nil
	}

	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	url := fmt.Sprintf("https://query1.finance.yahoo.com/v7/finance/quote?symbols=%s",
		strings.Join(symbols, ","))

	h.logger.Debug("calling Yahoo Quote API", zap.String("url", url), zap.Strings("symbols", symbols))

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create quote request: %w", err)
	}

	// Add headers to avoid rate limiting
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("quote API request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("quote API returned status %d", resp.StatusCode)
	}

	var apiResponse QuoteResponse
	if err := json.NewDecoder(resp.Body).Decode(&apiResponse); err != nil {
		return nil, fmt.Errorf("failed to decode quote response: %w", err)
	}

	// Build map of symbol -> day change percent
	result := make(map[string]float64)
	for _, quote := range apiResponse.QuoteResponse.Result {
		result[quote.Symbol] = quote.RegularMarketChangePercent
		h.logger.Debug("got quote data",
			zap.String("symbol", quote.Symbol),
			zap.Float64("changePercent", quote.RegularMarketChangePercent))
	}

	return result, nil
}

func (h *StocksHandler) fetchChartData(client *http.Client, symbol, timeRange, interval string) (*ChartData, error) {
	// Yahoo Finance Chart API endpoint
	apiURL := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=%s&interval=%s",
		url.QueryEscape(symbol), timeRange, interval)

	h.logger.Debug("calling Yahoo Chart API", zap.String("url", apiURL), zap.String("symbol", symbol))

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Add headers to avoid rate limiting
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var apiResponse struct {
		Chart struct {
			Result []struct {
				Meta       ChartMeta `json:"meta"`
				Indicators struct {
					Quote []struct {
						Close []float64 `json:"close"`
						Open  []float64 `json:"open"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
		} `json:"chart"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResponse); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	if len(apiResponse.Chart.Result) == 0 {
		return nil, fmt.Errorf("no data returned for symbol")
	}

	result := apiResponse.Chart.Result[0]
	closes := []float64{}
	opens := []float64{}

	if len(result.Indicators.Quote) > 0 {
		closes = result.Indicators.Quote[0].Close
		opens = result.Indicators.Quote[0].Open

		// Filter out null values for closes
		validCloses := []float64{}
		for _, close := range closes {
			if close > 0 { // Filter out invalid/null data points
				validCloses = append(validCloses, close)
			}
		}
		closes = validCloses

		// Filter out null values for opens
		validOpens := []float64{}
		for _, open := range opens {
			if open > 0 { // Filter out invalid/null data points
				validOpens = append(validOpens, open)
			}
		}
		opens = validOpens
	}

	return &ChartData{
		Meta:   result.Meta,
		Closes: closes,
		Opens:  opens,
	}, nil
}

// getClosePrice fetches the historical close price for a specific date
func (h *StocksHandler) getClosePrice(symbol string, targetDate time.Time) float64 {
	client := &http.Client{
		Timeout: 15 * time.Second,
	}

	// Get timestamp array from the API
	apiURL := fmt.Sprintf("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=1mo&interval=1d", symbol)

	req, err := http.NewRequest("GET", apiURL, nil)
	if err != nil {
		h.logger.Error("failed to create historical request", zap.Error(err))
		return 0
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		h.logger.Error("historical price request failed", zap.Error(err))
		return 0
	}
	defer resp.Body.Close()

	var apiResponse struct {
		Chart struct {
			Result []struct {
				Timestamp  []int64 `json:"timestamp"`
				Indicators struct {
					Quote []struct {
						Close []float64 `json:"close"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
		} `json:"chart"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiResponse); err != nil {
		h.logger.Error("failed to decode historical response", zap.Error(err))
		return 0
	}

	if len(apiResponse.Chart.Result) == 0 {
		return 0
	}

	result := apiResponse.Chart.Result[0]
	if len(result.Indicators.Quote) == 0 || len(result.Timestamp) == 0 {
		return 0
	}

	timestamps := result.Timestamp
	closes := result.Indicators.Quote[0].Close

	if len(timestamps) != len(closes) {
		h.logger.Warn("timestamp and close arrays length mismatch",
			zap.Int("timestamps", len(timestamps)),
			zap.Int("closes", len(closes)))
		return 0
	}

	// Convert target date to Unix timestamp (start of day)
	targetUnix := time.Date(targetDate.Year(), targetDate.Month(), targetDate.Day(), 0, 0, 0, 0, time.UTC).Unix()

	// Find the closest date
	bestIndex := -1
	minDiff := int64(24 * 60 * 60) // 1 day in seconds

	for i, ts := range timestamps {
		// Convert timestamp to start of day for comparison
		tsDate := time.Unix(ts, 0).UTC()
		tsDayStart := time.Date(tsDate.Year(), tsDate.Month(), tsDate.Day(), 0, 0, 0, 0, time.UTC).Unix()

		diff := targetUnix - tsDayStart
		if diff < 0 {
			diff = -diff
		}

		if diff < minDiff {
			minDiff = diff
			bestIndex = i
		}
	}

	if bestIndex == -1 || bestIndex >= len(closes) {
		h.logger.Warn("no historical price found for date",
			zap.String("symbol", symbol),
			zap.String("targetDate", targetDate.Format("2006-01-02")))
		return 0
	}

	closePrice := closes[bestIndex]
	if closePrice <= 0 {
		h.logger.Warn("invalid close price found",
			zap.String("symbol", symbol),
			zap.Float64("price", closePrice))
		return 0
	}

	h.logger.Debug("found historical close price",
		zap.String("symbol", symbol),
		zap.String("targetDate", targetDate.Format("2006-01-02")),
		zap.String("foundDate", time.Unix(timestamps[bestIndex], 0).Format("2006-01-02")),
		zap.Float64("closePrice", closePrice))

	return closePrice
}

// calculateDayChange calculates day % change using proper trading day logic
func (h *StocksHandler) calculateDayChange(symbol string, currentPrice float64) float64 {
	now := time.Now()
	calculationDate := h.calendar.GetCalculationDate(now)
	previousDayCloseDate := h.calendar.PreviousTradingDay(calculationDate)

	previousDayClose := h.getClosePrice(symbol, previousDayCloseDate)
	if previousDayClose <= 0 {
		h.logger.Warn("invalid previous day close price",
			zap.String("symbol", symbol),
			zap.String("previousDayCloseDate", previousDayCloseDate.Format("2006-01-02")),
			zap.Float64("previousDayClose", previousDayClose))
		return 0
	}

	// Day % = (current_price / previous_day_close) - 1
	dayChangePercent := (currentPrice / previousDayClose) - 1

	h.logger.Debug("calculated day change using trading calendar",
		zap.String("symbol", symbol),
		zap.String("calculationDate", calculationDate.Format("2006-01-02")),
		zap.String("previousDayCloseDate", previousDayCloseDate.Format("2006-01-02")),
		zap.Float64("currentPrice", currentPrice),
		zap.Float64("previousDayClose", previousDayClose),
		zap.Float64("dayChangePercent", dayChangePercent*100))

	return dayChangePercent * 100 // Convert to percentage
}

// calculateWeekChange calculates week % change using proper trading day logic
func (h *StocksHandler) calculateWeekChange(symbol string, currentPrice float64) float64 {
	now := time.Now()
	previousWeekCloseDate := h.calendar.PreviousWeekClose(now)

	previousWeekClose := h.getClosePrice(symbol, previousWeekCloseDate)
	if previousWeekClose <= 0 {
		h.logger.Warn("invalid previous week close price",
			zap.String("symbol", symbol),
			zap.String("previousWeekCloseDate", previousWeekCloseDate.Format("2006-01-02")),
			zap.Float64("previousWeekClose", previousWeekClose))
		return 0
	}

	// Week % = (current_price / previous_week_close) - 1
	weekChangePercent := (currentPrice / previousWeekClose) - 1

	h.logger.Debug("calculated week change using trading calendar",
		zap.String("symbol", symbol),
		zap.String("previousWeekCloseDate", previousWeekCloseDate.Format("2006-01-02")),
		zap.Float64("currentPrice", currentPrice),
		zap.Float64("previousWeekClose", previousWeekClose),
		zap.Float64("weekChangePercent", weekChangePercent*100),
		zap.Bool("isWeekend", h.calendar.IsWeekend(now)))

	return weekChangePercent * 100 // Convert to percentage
}

func (h *StocksHandler) calculateMarketStatus() MarketStatus {
	// Eastern Time (market timezone)
	et, _ := time.LoadLocation("America/New_York")
	now := time.Now().In(et)

	// Market hours: 9:30 AM - 4:00 PM ET, Monday-Friday
	preMarketStart := time.Date(now.Year(), now.Month(), now.Day(), 4, 0, 0, 0, et) // 4:00 AM
	marketOpen := time.Date(now.Year(), now.Month(), now.Day(), 9, 30, 0, 0, et)    // 9:30 AM
	marketClose := time.Date(now.Year(), now.Month(), now.Day(), 16, 0, 0, 0, et)   // 4:00 PM
	afterHoursEnd := time.Date(now.Year(), now.Month(), now.Day(), 20, 0, 0, 0, et) // 8:00 PM

	// Skip weekends
	if now.Weekday() == time.Saturday || now.Weekday() == time.Sunday {
		// Find next Monday
		daysUntilMonday := (8 - int(now.Weekday())) % 7
		if daysUntilMonday == 0 {
			daysUntilMonday = 1 // If it's Sunday, next Monday is in 1 day
		}
		nextOpen := marketOpen.AddDate(0, 0, daysUntilMonday)

		return MarketStatus{
			State:         "closed",
			IsOpen:        false,
			NextOpenTime:  &nextOpen,
			CurrentTimeET: now.Format("3:04 PM"),
		}
	}

	var state string
	var isOpen bool
	var nextOpenTime *time.Time
	var nextCloseTime *time.Time

	if now.Before(preMarketStart) {
		// Before pre-market
		state = "closed"
		isOpen = false
		nextOpenTime = &marketOpen
	} else if now.Before(marketOpen) {
		// Pre-market hours
		state = "pre"
		isOpen = false
		nextOpenTime = &marketOpen
	} else if now.Before(marketClose) {
		// Regular market hours
		state = "regular"
		isOpen = true
		nextCloseTime = &marketClose
	} else if now.Before(afterHoursEnd) {
		// After-hours trading
		state = "post"
		isOpen = false
		// Next open is tomorrow (or Monday if Friday)
		nextDay := 1
		if now.Weekday() == time.Friday {
			nextDay = 3 // Friday to Monday
		}
		nextOpen := marketOpen.AddDate(0, 0, nextDay)
		nextOpenTime = &nextOpen
	} else {
		// Market closed for the day
		state = "closed"
		isOpen = false
		nextDay := 1
		if now.Weekday() == time.Friday {
			nextDay = 3 // Friday to Monday
		}
		nextOpen := marketOpen.AddDate(0, 0, nextDay)
		nextOpenTime = &nextOpen
	}

	return MarketStatus{
		State:         state,
		IsOpen:        isOpen,
		NextOpenTime:  nextOpenTime,
		NextCloseTime: nextCloseTime,
		CurrentTimeET: now.Format("3:04 PM"),
	}
}

// loadWatchlistFromDB loads the watchlist symbols from MongoDB into memory
func (h *StocksHandler) loadWatchlistFromDB() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cursor, err := h.watchlistCol.Find(ctx, bson.M{})
	if err != nil {
		return fmt.Errorf("failed to query watchlist: %w", err)
	}
	defer cursor.Close(ctx)

	var entries []WatchlistEntry
	if err := cursor.All(ctx, &entries); err != nil {
		return fmt.Errorf("failed to decode watchlist entries: %w", err)
	}

	// Extract symbols and update in-memory cache
	symbols := make([]string, 0, len(entries))
	for _, entry := range entries {
		symbols = append(symbols, entry.Symbol)
	}

	h.watchlist = symbols
	h.logger.Info("loaded watchlist from MongoDB", zap.Int("count", len(symbols)))
	return nil
}

// Watchlist management endpoints
func (h *StocksHandler) GetWatchlist(w http.ResponseWriter, r *http.Request) {
	// Return entries with added_at timestamps instead of just symbols
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cursor, err := h.watchlistCol.Find(ctx, bson.M{})
	if err != nil {
		h.logger.Error("failed to get watchlist from MongoDB", zap.Error(err))
		// Fall back to in-memory watchlist
		writeJSON(w, http.StatusOK, map[string][]string{
			"symbols": h.watchlist,
		})
		return
	}
	defer cursor.Close(ctx)

	var entries []WatchlistEntry
	if err := cursor.All(ctx, &entries); err != nil {
		h.logger.Error("failed to decode watchlist entries", zap.Error(err))
		// Fall back to in-memory watchlist
		writeJSON(w, http.StatusOK, map[string][]string{
			"symbols": h.watchlist,
		})
		return
	}

	if entries == nil {
		entries = []WatchlistEntry{}
	}

	writeJSON(w, http.StatusOK, entries)
}

func (h *StocksHandler) AddToWatchlist(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Symbol string `json:"symbol"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
		return
	}

	symbol := strings.ToUpper(strings.TrimSpace(req.Symbol))
	if symbol == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Symbol is required"})
		return
	}

	// Check if already in watchlist
	for _, s := range h.watchlist {
		if s == symbol {
			writeJSON(w, http.StatusOK, map[string]string{
				"message": fmt.Sprintf("%s is already in watchlist", symbol),
			})
			return
		}
	}

	// Create watchlist entry
	entry := WatchlistEntry{
		Symbol:  symbol,
		AddedAt: time.Now().UTC(),
	}

	// Add to MongoDB
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := h.watchlistCol.InsertOne(ctx, entry)
	if err != nil {
		h.logger.Error("failed to add stock to watchlist in MongoDB", zap.String("symbol", symbol), zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to add stock to watchlist"})
		return
	}

	// Update in-memory watchlist
	h.watchlist = append(h.watchlist, symbol)

	// Clear cache so next GetPrices fetches the new stock
	h.cache = nil
	h.cacheExpiry = time.Time{}

	h.logger.Info("added stock to watchlist", zap.String("symbol", symbol), zap.Int("watchlistSize", len(h.watchlist)))

	writeJSON(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Added %s to watchlist", symbol),
		"symbol":  symbol,
	})
}

func (h *StocksHandler) RemoveFromWatchlist(w http.ResponseWriter, r *http.Request) {
	symbol := strings.ToUpper(r.PathValue("symbol"))

	// Find and remove from watchlist
	found := false
	newWatchlist := []string{}
	for _, s := range h.watchlist {
		if s == symbol {
			found = true
		} else {
			newWatchlist = append(newWatchlist, s)
		}
	}

	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error": fmt.Sprintf("%s not found in watchlist", symbol),
		})
		return
	}

	// Remove from MongoDB
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	result, err := h.watchlistCol.DeleteOne(ctx, bson.M{"symbol": symbol})
	if err != nil {
		h.logger.Error("failed to remove stock from watchlist in MongoDB", zap.String("symbol", symbol), zap.Error(err))
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Failed to remove stock from watchlist"})
		return
	}

	if result.DeletedCount == 0 {
		h.logger.Warn("stock not found in MongoDB but was in memory", zap.String("symbol", symbol))
	}

	// Update in-memory watchlist
	h.watchlist = newWatchlist

	// Clear cache
	h.cache = nil
	h.cacheExpiry = time.Time{}

	h.logger.Info("removed stock from watchlist", zap.String("symbol", symbol), zap.Int("watchlistSize", len(h.watchlist)))

	writeJSON(w, http.StatusOK, map[string]string{
		"message": fmt.Sprintf("Removed %s from watchlist", symbol),
	})
}
