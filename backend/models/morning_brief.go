package models

import (
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type MorningBrief struct {
	ID        bson.ObjectID `bson:"_id,omitempty" json:"id"`
	Date      string        `bson:"date"          json:"date"`     // YYYY-MM-DD format
	Content   string        `bson:"content"       json:"content"`  // Full markdown content
	Headline  string        `bson:"headline"      json:"headline"` // First line summary
	CreatedAt time.Time     `bson:"created_at"    json:"created_at"`
}

func (mb *MorningBrief) Validate() error {
	if mb.Date == "" {
		return fmt.Errorf("date is required")
	}
	if mb.Content == "" {
		return fmt.Errorf("content is required")
	}
	if mb.Headline == "" {
		return fmt.Errorf("headline is required")
	}

	// Validate date format (YYYY-MM-DD)
	if len(mb.Date) != 10 {
		return fmt.Errorf("date must be in YYYY-MM-DD format")
	}

	// Try to parse the date to ensure it's valid
	if _, err := time.Parse("2006-01-02", mb.Date); err != nil {
		return fmt.Errorf("invalid date format, must be YYYY-MM-DD")
	}

	return nil
}

func (mb *MorningBrief) ApplyDefaults() {
	if mb.CreatedAt.IsZero() {
		mb.CreatedAt = time.Now().UTC()
	}
}
