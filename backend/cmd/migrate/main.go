package main

import (
	"context"
	"log"

	"agent-dashboard/db"
	"agent-dashboard/migrations"
)

func main() {
	ctx := context.Background()

	// Connect to MongoDB
	client, err := db.Connect(ctx)
	if err != nil {
		log.Fatal("Failed to connect to MongoDB:", err)
	}
	defer func() {
		if err := db.Disconnect(ctx, client); err != nil {
			log.Printf("Failed to disconnect from MongoDB: %v", err)
		}
	}()

	// Run migration
	if err := migrations.AddCardNumbers(client); err != nil {
		log.Fatal("Migration failed:", err)
	}
}
