package db

import (
	"context"
	"os"
	"time"

	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

func Connect(ctx context.Context) (*mongo.Client, error) {
	uri := os.Getenv("MONGO_URI")
	if uri == "" {
		uri = "mongodb://localhost:27017"
	}

	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(options.Client().ApplyURI(uri))
	if err != nil {
		return nil, err
	}

	if err := client.Ping(ctx, nil); err != nil {
		return nil, err
	}

	return client, nil
}

func Disconnect(ctx context.Context, client *mongo.Client) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return client.Disconnect(ctx)
}

func CardsCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard" // backward compatibility
	}
	return client.Database(database).Collection("cards")
}

func StockWatchlistCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("stock_watchlist")
}

func DoctorReportsCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("doctor_reports")
}

func MorningBriefsCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("morning_briefs")
}

func Database(client *mongo.Client) *mongo.Database {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database)
}

func TommyFindsCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("tommy_finds")
}

func TommySessionsCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("tommy_sessions")
}

func NSTestRunsCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("ns_test_runs")
}

func NSTestCoverageCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("ns_test_coverage")
}

func TommyPostsCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("tommy_posts")
}

func AutonomousLogCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("autonomous_log")
}

func TommyConfigCollection(client *mongo.Client) *mongo.Collection {
	database := os.Getenv("MONGO_DATABASE")
	if database == "" {
		database = "nova-dashboard"
	}
	return client.Database(database).Collection("tommy_config")
}
