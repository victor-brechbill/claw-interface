package models

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// NSTestRun represents a single daily test session
type NSTestRun struct {
	ID           bson.ObjectID `bson:"_id,omitempty" json:"id"`
	Date         string        `bson:"date" json:"date"`                 // YYYY-MM-DD
	ScenarioName string        `bson:"scenarioName" json:"scenarioName"` // e.g. "The Community Event"
	Description  string        `bson:"description" json:"description"`   // What was tested
	Personas     []string      `bson:"personas" json:"personas"`         // ["tom", "wilma", "reggie"]
	BugsFound    []NSTestBug   `bson:"bugsFound" json:"bugsFound"`       // Bugs discovered
	FeaturesOK   []string      `bson:"featuresOK" json:"featuresOK"`     // Features verified working
	CoverageNew  []string      `bson:"coverageNew" json:"coverageNew"`   // New areas covered
	Summary      string        `bson:"summary" json:"summary"`           // Overall summary
	Status       string        `bson:"status" json:"status"`             // "pass", "fail", "partial"
	DurationSec  int           `bson:"durationSec" json:"durationSec"`   // Total runtime
	CreatedAt    time.Time     `bson:"createdAt" json:"createdAt"`
}

// NSTestBug represents a bug found during testing
type NSTestBug struct {
	Title       string `bson:"title" json:"title"`
	Severity    string `bson:"severity" json:"severity"`                         // "high", "medium", "low"
	Page        string `bson:"page" json:"page"`                                 // URL path where found
	Description string `bson:"description" json:"description"`                   // What happened
	Steps       string `bson:"steps" json:"steps"`                               // Steps to reproduce
	CardID      string `bson:"cardId,omitempty" json:"cardId,omitempty"`         // Kanban card if created
	Screenshot  string `bson:"screenshot,omitempty" json:"screenshot,omitempty"` // Path to screenshot
}

// NSTestCoverage tracks overall testing coverage
type NSTestCoverage struct {
	ID         bson.ObjectID `bson:"_id,omitempty" json:"id"`
	Feature    string        `bson:"feature" json:"feature"`       // Feature name
	Category   string        `bson:"category" json:"category"`     // auth, discovery, member, host, permissions, ui
	LastTested string        `bson:"lastTested" json:"lastTested"` // YYYY-MM-DD
	Status     string        `bson:"status" json:"status"`         // "pass", "fail", "not_tested"
	Notes      string        `bson:"notes" json:"notes"`
	UpdatedAt  time.Time     `bson:"updatedAt" json:"updatedAt"`
}
