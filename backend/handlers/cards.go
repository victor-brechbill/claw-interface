package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.uber.org/zap"

	"agent-dashboard/models"
)

type CardHandler struct {
	col    *mongo.Collection
	db     *mongo.Database
	logger *zap.Logger
}

func NewCardHandler(col *mongo.Collection, db *mongo.Database, logger *zap.Logger) *CardHandler {
	return &CardHandler{col: col, db: db, logger: logger}
}

func (h *CardHandler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/cards", h.ListCards)
	mux.HandleFunc("POST /api/cards", h.CreateCard)
	mux.HandleFunc("PUT /api/cards/reorder", h.ReorderCards)
	mux.HandleFunc("GET /api/cards/number/{number}", h.GetCardByNumber)
	mux.HandleFunc("GET /api/cards/{id}", h.GetCard)
	mux.HandleFunc("PUT /api/cards/{id}", h.UpdateCard)
	mux.HandleFunc("DELETE /api/cards/{id}", h.DeleteCard)
	mux.HandleFunc("POST /api/cards/{id}/comments", h.AddComment)
	mux.HandleFunc("POST /api/cards/{id}/attachments", h.UploadAttachment)
	mux.HandleFunc("GET /api/cards/{id}/attachments/{filename}", h.DownloadAttachment)
	mux.HandleFunc("DELETE /api/cards/{id}/attachments/{filename}", h.DeleteAttachment)
}

func (h *CardHandler) ListCards(w http.ResponseWriter, r *http.Request) {
	filter := bson.M{}
	if col := r.URL.Query().Get("column"); col != "" {
		filter["column"] = col
	}

	cursor, err := h.col.Find(r.Context(), filter)
	if err != nil {
		h.logger.Error("failed to list cards", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to list cards")
		return
	}

	var cards []models.Card
	if err := cursor.All(r.Context(), &cards); err != nil {
		h.logger.Error("failed to decode cards", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to decode cards")
		return
	}
	if cards == nil {
		cards = []models.Card{}
	}

	writeJSON(w, http.StatusOK, cards)
}

func (h *CardHandler) CreateCard(w http.ResponseWriter, r *http.Request) {
	var card models.Card
	if err := json.NewDecoder(r.Body).Decode(&card); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	if err := card.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	card.ApplyDefaults()
	now := time.Now().UTC()
	card.CreatedAt = now
	card.UpdatedAt = now

	// Get next card number
	cardNumber, err := models.GetNextCardNumber(r.Context(), h.db)
	if err != nil {
		h.logger.Error("failed to get next card number", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to assign card number")
		return
	}
	card.Number = cardNumber

	// Set position to max+1 in the column
	var maxCard models.Card
	opts := options.FindOne().SetSort(bson.M{"position": -1})
	err = h.col.FindOne(r.Context(), bson.M{"column": card.Column}, opts).Decode(&maxCard)
	if err == nil {
		card.Position = maxCard.Position + 1
	}
	// if no docs found, position stays 0

	result, err := h.col.InsertOne(r.Context(), card)
	if err != nil {
		h.logger.Error("failed to insert card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to create card")
		return
	}

	card.ID = result.InsertedID.(bson.ObjectID)
	writeJSON(w, http.StatusCreated, card)
}

func (h *CardHandler) GetCard(w http.ResponseWriter, r *http.Request) {
	id, err := bson.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var card models.Card
	if err := h.col.FindOne(r.Context(), bson.M{"_id": id}).Decode(&card); err != nil {
		if err == mongo.ErrNoDocuments {
			writeError(w, http.StatusNotFound, "card not found")
			return
		}
		h.logger.Error("failed to get card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to get card")
		return
	}

	writeJSON(w, http.StatusOK, card)
}

func (h *CardHandler) GetCardByNumber(w http.ResponseWriter, r *http.Request) {
	num, err := strconv.Atoi(r.PathValue("number"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid card number")
		return
	}

	var card models.Card
	if err := h.col.FindOne(r.Context(), bson.M{"number": num}).Decode(&card); err != nil {
		if err == mongo.ErrNoDocuments {
			writeError(w, http.StatusNotFound, "card not found")
			return
		}
		h.logger.Error("failed to get card by number", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to get card")
		return
	}

	writeJSON(w, http.StatusOK, card)
}

func (h *CardHandler) UpdateCard(w http.ResponseWriter, r *http.Request) {
	id, err := bson.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var updates map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&updates); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	updates["updated_at"] = time.Now().UTC()
	delete(updates, "id")
	delete(updates, "_id")
	delete(updates, "created_at")

	// Normalize column name if present
	if col, ok := updates["column"].(string); ok {
		updates["column"] = normalizeColumn(col)
	}

	// Auto-clear flag when owner approves a card
	if approved, ok := updates["approved"].(bool); ok && approved {
		updates["flagged"] = false
	}

	result, err := h.col.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{"$set": updates})
	if err != nil {
		h.logger.Error("failed to update card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to update card")
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "card not found")
		return
	}

	var card models.Card
	if err := h.col.FindOne(r.Context(), bson.M{"_id": id}).Decode(&card); err != nil {
		h.logger.Error("failed to fetch updated card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "card updated but failed to fetch")
		return
	}
	writeJSON(w, http.StatusOK, card)
}

func (h *CardHandler) DeleteCard(w http.ResponseWriter, r *http.Request) {
	id, err := bson.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	result, err := h.col.DeleteOne(r.Context(), bson.M{"_id": id})
	if err != nil {
		h.logger.Error("failed to delete card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to delete card")
		return
	}
	if result.DeletedCount == 0 {
		writeError(w, http.StatusNotFound, "card not found")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *CardHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	id, err := bson.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	var comment models.Comment
	if err := json.NewDecoder(r.Body).Decode(&comment); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	comment.CreatedAt = time.Now().UTC()

	// Build update operation
	setFields := bson.M{"updated_at": time.Now().UTC()}

	// Auto-clear flag when owner adds a comment
	if comment.Author == "Owner" {
		setFields["flagged"] = false
	}

	result, err := h.col.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{
		"$push": bson.M{"comments": comment},
		"$set":  setFields,
	})
	if err != nil {
		h.logger.Error("failed to add comment", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to add comment")
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "card not found")
		return
	}

	var card models.Card
	if err := h.col.FindOne(r.Context(), bson.M{"_id": id}).Decode(&card); err != nil {
		h.logger.Error("failed to fetch updated card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "comment added but failed to fetch card")
		return
	}
	writeJSON(w, http.StatusOK, card)
}

type reorderItem struct {
	ID       string `json:"id"`
	Column   string `json:"column"`
	Position int    `json:"position"`
}

// normalizeColumn converts hyphenated column names to underscore format
func normalizeColumn(col string) string {
	if col == "in-progress" {
		return "in_progress"
	}
	return col
}

func (h *CardHandler) ReorderCards(w http.ResponseWriter, r *http.Request) {
	// Accept both raw array and { updates: [...] } wrapper
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	var items []reorderItem
	if err := json.Unmarshal(raw, &items); err != nil {
		// Try wrapped format: { "updates": [...] }
		var wrapped struct {
			Updates []reorderItem `json:"updates"`
		}
		if err2 := json.Unmarshal(raw, &wrapped); err2 != nil {
			writeError(w, http.StatusBadRequest, "invalid JSON: expected array or {updates: [...]}")
			return
		}
		items = wrapped.Updates
	}

	var writes []mongo.WriteModel
	for _, item := range items {
		id, err := bson.ObjectIDFromHex(item.ID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid id: "+item.ID)
			return
		}
		writes = append(writes, mongo.NewUpdateOneModel().
			SetFilter(bson.M{"_id": id}).
			SetUpdate(bson.M{"$set": bson.M{
				"column":     normalizeColumn(item.Column),
				"position":   item.Position,
				"updated_at": time.Now().UTC(),
			}}))
	}

	if len(writes) > 0 {
		if _, err := h.col.BulkWrite(r.Context(), writes); err != nil {
			h.logger.Error("failed to reorder cards", zap.Error(err))
			writeError(w, http.StatusInternalServerError, "failed to reorder cards")
			return
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *CardHandler) UploadAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := bson.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	// Parse multipart form
	err = r.ParseMultipartForm(10 << 20) // 10MB
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to parse form")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "no file provided")
		return
	}
	defer file.Close()

	// Check file size (10MB limit)
	if header.Size > 10<<20 {
		writeError(w, http.StatusBadRequest, "file size must be less than 10MB")
		return
	}

	// Get existing card to check total attachment size
	var card models.Card
	if err := h.col.FindOne(r.Context(), bson.M{"_id": id}).Decode(&card); err != nil {
		if err == mongo.ErrNoDocuments {
			writeError(w, http.StatusNotFound, "card not found")
			return
		}
		h.logger.Error("failed to get card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to get card")
		return
	}

	// Check total size limit (50MB per card)
	totalSize := int64(0)
	for _, att := range card.Attachments {
		totalSize += att.Size
	}
	if totalSize+header.Size > 50<<20 {
		writeError(w, http.StatusBadRequest, "total attachments per card cannot exceed 50MB")
		return
	}

	// Create attachment directory
	attachmentDir := filepath.Join("/home/ubuntu/agent-dashboard/attachments", id.Hex())
	if err := os.MkdirAll(attachmentDir, 0755); err != nil {
		h.logger.Error("failed to create attachment directory", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to create directory")
		return
	}

	// Save file to disk
	filename := header.Filename
	filePath := filepath.Join(attachmentDir, filename)

	// Check if file already exists (replace mode)
	replacing := false
	if _, err := os.Stat(filePath); err == nil {
		replacing = true
	}

	outFile, err := os.Create(filePath)
	if err != nil {
		h.logger.Error("failed to create file", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to save file")
		return
	}
	defer outFile.Close()

	if _, err := io.Copy(outFile, file); err != nil {
		h.logger.Error("failed to write file", zap.Error(err))
		os.Remove(filePath) // Clean up on error
		writeError(w, http.StatusInternalServerError, "failed to save file")
		return
	}

	// Create attachment record
	attachment := models.Attachment{
		Filename:    filename,
		Size:        header.Size,
		ContentType: header.Header.Get("Content-Type"),
		UploadedAt:  time.Now().UTC(),
		UploadedBy:  "Owner", // Auto-set for now
	}

	var result *mongo.UpdateResult
	if replacing {
		// Replace existing attachment record with same filename
		result, err = h.col.UpdateOne(r.Context(), bson.M{"_id": id, "attachments.filename": filename}, bson.M{
			"$set": bson.M{
				"attachments.$": attachment,
				"updated_at":    time.Now().UTC(),
			},
		})
	} else {
		// Add new attachment
		result, err = h.col.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{
			"$push": bson.M{"attachments": attachment},
			"$set":  bson.M{"updated_at": time.Now().UTC()},
		})
	}
	if err != nil {
		h.logger.Error("failed to add attachment", zap.Error(err))
		os.Remove(filePath) // Clean up on error
		writeError(w, http.StatusInternalServerError, "failed to add attachment")
		return
	}
	if result.MatchedCount == 0 {
		os.Remove(filePath) // Clean up on error
		writeError(w, http.StatusNotFound, "card not found")
		return
	}

	// Return updated card
	var updatedCard models.Card
	if err := h.col.FindOne(r.Context(), bson.M{"_id": id}).Decode(&updatedCard); err != nil {
		h.logger.Error("failed to fetch updated card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "attachment added but failed to fetch card")
		return
	}
	writeJSON(w, http.StatusOK, updatedCard)
}

func (h *CardHandler) DownloadAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := bson.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	filename, err := url.QueryUnescape(r.PathValue("filename"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	// Verify card exists and has this attachment
	var card models.Card
	if err := h.col.FindOne(r.Context(), bson.M{"_id": id}).Decode(&card); err != nil {
		if err == mongo.ErrNoDocuments {
			writeError(w, http.StatusNotFound, "card not found")
			return
		}
		h.logger.Error("failed to get card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to get card")
		return
	}

	var attachment *models.Attachment
	for _, att := range card.Attachments {
		if att.Filename == filename {
			attachment = &att
			break
		}
	}
	if attachment == nil {
		writeError(w, http.StatusNotFound, "attachment not found")
		return
	}

	// Serve file
	filePath := filepath.Join("/home/ubuntu/agent-dashboard/attachments", id.Hex(), filename)

	// Check if file exists
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		writeError(w, http.StatusNotFound, "file not found on disk")
		return
	}

	// Set headers
	w.Header().Set("Content-Type", attachment.ContentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", attachment.Filename))

	http.ServeFile(w, r, filePath)
}

func (h *CardHandler) DeleteAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := bson.ObjectIDFromHex(r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}

	filename, err := url.QueryUnescape(r.PathValue("filename"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid filename")
		return
	}

	// Remove attachment from database
	result, err := h.col.UpdateOne(r.Context(), bson.M{"_id": id}, bson.M{
		"$pull": bson.M{"attachments": bson.M{"filename": filename}},
		"$set":  bson.M{"updated_at": time.Now().UTC()},
	})
	if err != nil {
		h.logger.Error("failed to remove attachment", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "failed to remove attachment")
		return
	}
	if result.MatchedCount == 0 {
		writeError(w, http.StatusNotFound, "card not found")
		return
	}

	// Delete file from disk
	filePath := filepath.Join("/home/ubuntu/agent-dashboard/attachments", id.Hex(), filename)
	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		h.logger.Error("failed to delete file", zap.Error(err))
		// Don't return error - database was updated successfully
	}

	// Return updated card
	var updatedCard models.Card
	if err := h.col.FindOne(r.Context(), bson.M{"_id": id}).Decode(&updatedCard); err != nil {
		h.logger.Error("failed to fetch updated card", zap.Error(err))
		writeError(w, http.StatusInternalServerError, "attachment deleted but failed to fetch card")
		return
	}
	writeJSON(w, http.StatusOK, updatedCard)
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
