package models

import (
	"context"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

type Counter struct {
	ID       string `bson:"_id" json:"_id"`
	Sequence int    `bson:"seq" json:"seq"`
}

// GetNextCardNumber returns the next available card number using MongoDB's findOneAndUpdate
func GetNextCardNumber(ctx context.Context, db *mongo.Database) (int, error) {
	collection := db.Collection("counters")

	filter := bson.M{"_id": "cardNumber"}
	update := bson.M{"$inc": bson.M{"seq": 1}}
	options := options.FindOneAndUpdate().
		SetUpsert(true).
		SetReturnDocument(options.After)

	var counter Counter
	err := collection.FindOneAndUpdate(ctx, filter, update, options).Decode(&counter)
	if err != nil {
		return 0, err
	}

	return counter.Sequence, nil
}
