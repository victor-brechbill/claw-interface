package migrations

import (
	"context"
	"fmt"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"agent-dashboard/db"
	"agent-dashboard/models"
)

// AddCardNumbers assigns sequential numbers to existing cards that don't have them
func AddCardNumbers(client *mongo.Client) error {
	ctx := context.Background()
	cardsCol := db.CardsCollection(client)
	database := db.Database(client)

	// First, check total cards
	totalCards, err := cardsCol.CountDocuments(ctx, bson.M{})
	if err != nil {
		return fmt.Errorf("failed to count cards: %w", err)
	}
	fmt.Printf("Total cards in database: %d\n", totalCards)

	// Find all cards that don't have a number field or have number=0
	filter := bson.M{
		"$or": []bson.M{
			{"number": bson.M{"$exists": false}},
			{"number": 0},
		},
	}

	// Sort by created_at to assign numbers in chronological order
	opts := options.Find().SetSort(bson.M{"created_at": 1})
	cursor, err := cardsCol.Find(ctx, filter, opts)
	if err != nil {
		return fmt.Errorf("failed to find cards without numbers: %w", err)
	}
	defer cursor.Close(ctx)

	var cards []models.Card
	if err := cursor.All(ctx, &cards); err != nil {
		return fmt.Errorf("failed to decode cards: %w", err)
	}

	fmt.Printf("Cards matching filter (no number or number=0): %d\n", len(cards))

	if len(cards) == 0 {
		// Check if there are cards with positive numbers
		positiveCards, err := cardsCol.CountDocuments(ctx, bson.M{"number": bson.M{"$gt": 0}})
		if err == nil {
			fmt.Printf("Cards with positive numbers: %d\n", positiveCards)
		}
		fmt.Println("No cards need number assignment")
		return nil
	}

	fmt.Printf("Found %d cards that need numbers\n", len(cards))

	// Update each card with a sequential number
	for _, card := range cards {
		// Get next card number using the counter
		cardNumber, err := models.GetNextCardNumber(ctx, database)
		if err != nil {
			return fmt.Errorf("failed to get next card number for card %s: %w", card.ID.Hex(), err)
		}

		// Update the card
		_, err = cardsCol.UpdateOne(ctx,
			bson.M{"_id": card.ID},
			bson.M{"$set": bson.M{"number": cardNumber}},
		)
		if err != nil {
			return fmt.Errorf("failed to update card %s with number %d: %w", card.ID.Hex(), cardNumber, err)
		}

		fmt.Printf("Assigned number %d to card: %s\n", cardNumber, card.Title)
	}

	fmt.Printf("Successfully assigned numbers to %d cards\n", len(cards))
	return nil
}
