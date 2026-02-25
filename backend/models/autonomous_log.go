package models

import "time"

// AutonomousLogEntry records a task Nova chose to work on without explicit approval
type AutonomousLogEntry struct {
	ID             string    `json:"id" bson:"_id,omitempty"`
	Date           string    `json:"date" bson:"date"`                     // YYYY-MM-DD
	CardID         string    `json:"cardId" bson:"cardId"`                 // Dashboard card ID
	CardTitle      string    `json:"cardTitle" bson:"cardTitle"`           // Card title for easy reading
	Project        string    `json:"project" bson:"project"`               // dashboard, neighborhood-share, daily-stock-pick
	Reasoning      string    `json:"reasoning" bson:"reasoning"`           // Why Nova chose this task
	ConfidenceIn   string    `json:"confidenceIn" bson:"confidenceIn"`     // Confidence going in: high, very-high
	Action         string    `json:"action" bson:"action"`                 // What was done (PR link, commit, etc.)
	Outcome        string    `json:"outcome" bson:"outcome"`               // success, partial, reverted, pending
	OutcomeNotes   string    `json:"outcomeNotes" bson:"outcomeNotes"`     // Details about the outcome
	LessonsLearned string    `json:"lessonsLearned" bson:"lessonsLearned"` // What was learned (if anything)
	CreatedAt      time.Time `json:"createdAt" bson:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt" bson:"updatedAt"`
}
