package models

import (
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type Comment struct {
	Author    string    `bson:"author"     json:"author"`
	Text      string    `bson:"text"       json:"text"`
	CreatedAt time.Time `bson:"created_at" json:"created_at"`
}

type Attachment struct {
	Filename    string    `json:"filename" bson:"filename"`
	Size        int64     `json:"size" bson:"size"`
	ContentType string    `json:"contentType" bson:"contentType"`
	UploadedAt  time.Time `json:"uploadedAt" bson:"uploadedAt"`
	UploadedBy  string    `json:"uploadedBy" bson:"uploadedBy"`
}

type Card struct {
	ID              bson.ObjectID `bson:"_id,omitempty" json:"id"`
	Number          int           `bson:"number"        json:"number"`
	Title           string        `bson:"title"         json:"title"`
	Description     string        `bson:"description"   json:"description"`
	Type            string        `bson:"type"          json:"type"`
	Project         string        `bson:"project"       json:"project"`
	Priority        string        `bson:"priority"      json:"priority"`
	Column          string        `bson:"column"        json:"column"`
	Position        int           `bson:"position"      json:"position"`
	Assignee        string        `bson:"assignee"      json:"assignee"`
	Comments        []Comment     `bson:"comments"      json:"comments"`
	Approved        bool          `json:"approved" bson:"approved"`
	Flagged         bool          `json:"flagged" bson:"flagged"`
	ApprovedBy      string        `json:"approvedBy,omitempty" bson:"approvedBy,omitempty"`
	ApprovedAt      time.Time     `json:"approvedAt,omitempty" bson:"approvedAt,omitempty"`
	DescriptionHash string        `json:"-" bson:"descriptionHash,omitempty"`
	Attachments     []Attachment  `json:"attachments,omitempty" bson:"attachments,omitempty"`
	CreatedAt       time.Time     `bson:"created_at"    json:"created_at"`
	UpdatedAt       time.Time     `bson:"updated_at"    json:"updated_at"`
}

var (
	validTypes      = map[string]bool{"bugfix": true, "refactor": true, "feature": true, "task": true, "infrastructure": true, "cron": true}
	validPriorities = map[string]bool{"low": true, "medium": true, "high": true, "critical": true}
	validColumns    = map[string]bool{"backlog": true, "in_progress": true, "review": true, "done": true}
)

func (c *Card) Validate() error {
	if c.Title == "" {
		return fmt.Errorf("title is required")
	}
	if !validTypes[c.Type] {
		return fmt.Errorf("type must be one of: bugfix, refactor, feature, task, infrastructure, cron")
	}
	if !validPriorities[c.Priority] {
		return fmt.Errorf("priority must be one of: low, medium, high, critical")
	}
	if c.Column != "" && !validColumns[c.Column] {
		return fmt.Errorf("column must be one of: backlog, in_progress, review, done")
	}
	return nil
}

func (c *Card) ApplyDefaults() {
	if c.Column == "" {
		c.Column = "backlog"
	}
	if c.Project == "" {
		c.Project = "none"
	}
	if c.Comments == nil {
		c.Comments = []Comment{}
	}
	if c.Attachments == nil {
		c.Attachments = []Attachment{}
	}
	c.UpdateDescriptionHash()
}

func (c *Card) UpdateDescriptionHash() {
	hasher := md5.New()
	hasher.Write([]byte(c.Description))
	c.DescriptionHash = hex.EncodeToString(hasher.Sum(nil))
}

func (c *Card) CheckDescriptionChanged() bool {
	hasher := md5.New()
	hasher.Write([]byte(c.Description))
	newHash := hex.EncodeToString(hasher.Sum(nil))
	return newHash != c.DescriptionHash
}

func (c *Card) ClearApprovalIfDescriptionChanged() {
	if c.CheckDescriptionChanged() {
		c.Approved = false
		c.ApprovedBy = ""
		c.ApprovedAt = time.Time{}
		c.UpdateDescriptionHash()
	}
}
