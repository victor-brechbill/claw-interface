package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"

	"agent-dashboard/db"
	"agent-dashboard/handlers"
)

type HealthResponse struct {
	Status    string `json:"status"`
	Timestamp string `json:"timestamp"`
}

func main() {
	// Initialize Zap logger (structured JSON)
	config := zap.Config{
		Level:       zap.NewAtomicLevelAt(zapcore.InfoLevel),
		Development: false,
		Encoding:    "json",
		EncoderConfig: zapcore.EncoderConfig{
			TimeKey:        "ts",
			LevelKey:       "level",
			NameKey:        "logger",
			CallerKey:      "caller",
			MessageKey:     "msg",
			StacktraceKey:  "stacktrace",
			LineEnding:     zapcore.DefaultLineEnding,
			EncodeLevel:    zapcore.LowercaseLevelEncoder,
			EncodeTime:     zapcore.ISO8601TimeEncoder,
			EncodeDuration: zapcore.SecondsDurationEncoder,
			EncodeCaller:   zapcore.ShortCallerEncoder,
		},
		OutputPaths:      []string{"stdout"},
		ErrorOutputPaths: []string{"stderr"},
	}

	logger, err := config.Build()
	if err != nil {
		panic("failed to initialize logger: " + err.Error())
	}
	defer logger.Sync()

	// Connect to MongoDB
	ctx := context.Background()
	mongoClient, err := db.Connect(ctx)
	if err != nil {
		logger.Fatal("failed to connect to MongoDB", zap.Error(err))
	}
	logger.Info("connected to MongoDB")

	port := os.Getenv("DASHBOARD_PORT")
	if port == "" {
		port = "3080"
	}

	mux := http.NewServeMux()

	// Serve static frontend files
	frontendDir := filepath.Join("..", "frontend", "build")
	if envDir := os.Getenv("FRONTEND_DIR"); envDir != "" {
		frontendDir = envDir
	}

	// Check if frontend build exists
	frontendExists := true
	if _, err := os.Stat(frontendDir); os.IsNotExist(err) {
		frontendExists = false
		logger.Warn("frontend build directory not found, serving API only",
			zap.String("path", frontendDir),
		)
	}

	// Health check endpoint
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		logger.Info("health check",
			zap.String("method", r.Method),
			zap.String("path", r.URL.Path),
			zap.String("remote", r.RemoteAddr),
		)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(HealthResponse{
			Status:    "ok",
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		})
	})

	// Card API routes
	cardHandler := handlers.NewCardHandler(db.CardsCollection(mongoClient), db.Database(mongoClient), logger)
	cardHandler.RegisterRoutes(mux)

	// System API routes
	systemHandler := handlers.NewSystemHandler(logger, db.DoctorReportsCollection(mongoClient))
	systemHandler.RegisterRoutes(mux)

	// Tommy API routes
	tommyHandler := handlers.NewTommyHandler(logger, db.TommyFindsCollection(mongoClient), db.TommySessionsCollection(mongoClient), db.TommyPostsCollection(mongoClient))
	tommyHandler.RegisterRoutes(mux)

	// Tommy Config API routes
	tommyConfigHandler := handlers.NewTommyConfigHandler(logger, db.TommyConfigCollection(mongoClient))
	tommyConfigHandler.RegisterRoutes(mux)

	// Tommy Cron API routes
	tommyCronHandler := handlers.NewTommyCronHandler(logger)
	tommyCronHandler.RegisterRoutes(mux)

	// Stocks API routes
	stocksHandler := handlers.NewStocksHandler(db.StockWatchlistCollection(mongoClient), logger)
	stocksHandler.RegisterRoutes(mux)

	// Sessions API routes
	sessionsHandler := handlers.NewSessionsHandler(logger)
	sessionsHandler.RegisterRoutes(mux)

	// Morning Briefs API routes
	briefsHandler := handlers.NewBriefsHandler(db.MorningBriefsCollection(mongoClient), db.Database(mongoClient), logger)
	briefsHandler.RegisterRoutes(mux)

	// Inspect API routes
	inspectHandler := handlers.NewInspectHandler(logger)
	inspectHandler.RegisterRoutes(mux)

	// NS Testing API routes
	nsTestHandler := handlers.NewNSTestHandler(db.NSTestRunsCollection(mongoClient), db.NSTestCoverageCollection(mongoClient), logger)
	nsTestHandler.RegisterRoutes(mux)
	autonomousLogHandler := handlers.NewAutonomousLogHandler(db.AutonomousLogCollection(mongoClient), logger)
	autonomousLogHandler.RegisterRoutes(mux)

	// Logs API routes
	logsHandler := handlers.NewLogsHandler(logger)
	logsHandler.RegisterRoutes(mux)

	// Static file server with SPA fallback and PWA MIME types
	fileServer := http.FileServer(http.Dir(frontendDir))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if !frontendExists {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "frontend not built"})
			return
		}
		// Try to serve the file directly
		path := filepath.Join(frontendDir, r.URL.Path)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			// SPA fallback: serve index.html for client-side routing
			logger.Debug("SPA fallback",
				zap.String("requested", r.URL.Path),
				zap.String("serving", "index.html"),
			)
			http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
			return
		}
		// Set correct MIME type for PWA manifest
		if filepath.Ext(r.URL.Path) == ".webmanifest" {
			w.Header().Set("Content-Type", "application/manifest+json")
		}
		fileServer.ServeHTTP(w, r)
	})

	// Request logging middleware
	handler := loggingMiddleware(logger, mux)

	logger.Info("Agent Dashboard starting",
		zap.String("port", port),
		zap.String("frontend_dir", frontendDir),
	)

	server := &http.Server{
		Addr:         "127.0.0.1:" + port,
		Handler:      handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		logger.Info("shutdown signal received", zap.String("signal", sig.String()))

		systemHandler.Shutdown()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			logger.Error("server shutdown error", zap.Error(err))
		}
		if err := db.Disconnect(shutdownCtx, mongoClient); err != nil {
			logger.Error("MongoDB disconnect error", zap.Error(err))
		}
	}()

	logger.Info("listening", zap.String("addr", server.Addr))
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Fatal("server failed", zap.Error(err))
	}
	logger.Info("server stopped")
}

// loggingMiddleware logs every HTTP request
func loggingMiddleware(logger *zap.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap response writer to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r)

		logger.Info("request",
			zap.String("method", r.Method),
			zap.String("path", r.URL.Path),
			zap.Int("status", wrapped.statusCode),
			zap.Duration("duration", time.Since(start)),
			zap.String("remote", r.RemoteAddr),
			zap.String("user_agent", r.UserAgent()),
		)
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}
