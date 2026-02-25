package models

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type DoctorReport struct {
	ID         bson.ObjectID `bson:"_id,omitempty" json:"id"`
	RunAt      time.Time     `bson:"runAt" json:"runAt"`
	Result     string        `bson:"result" json:"result"`         // "healthy" | "repaired" | "broken"
	Output     string        `bson:"output" json:"output"`         // Full doctor output
	DurationMs int64         `bson:"durationMs" json:"durationMs"` // How long the doctor run took
}

type DoctorStatus struct {
	Status               string    `json:"status"`               // "standby" | "working"
	LastRunAt            time.Time `json:"lastRunAt"`            // Last time doctor was run
	LastResult           string    `json:"lastResult"`           // "healthy" | "repaired" | "broken" | "unknown"
	IsRunning            bool      `json:"isRunning"`            // Whether doctor is currently running
	LastReportPath       string    `json:"lastReportPath"`       // Path to last report (unused for now)
	GatewayProcessCount  int       `json:"gatewayProcessCount"`  // Number of openclaw-gateway processes
	ClawdbotProcessCount int       `json:"clawdbotProcessCount"` // Number of clawdbot processes total
	LastRestart          time.Time `json:"lastRestart"`          // When gateway was last restarted (process start time)
	GatewayUptime        string    `json:"gatewayUptime"`        // Human-readable uptime
}
