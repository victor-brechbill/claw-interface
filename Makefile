.PHONY: dev-backend dev-frontend build clean install

# Run Go backend in development mode
dev-backend:
	cd backend && go run main.go

# Run Go backend serving built frontend
run:
	FRONTEND_DIR=./frontend/build ./nova-dashboard

# Run React frontend dev server
dev-frontend:
	cd frontend && npm run dev

# Build frontend and run backend serving static files
build:
	cd frontend && npm run build
	cd backend && go build -o ../nova-dashboard .

# Install all dependencies
install:
	cd backend && go mod tidy
	cd frontend && npm install

# Clean build artifacts
clean:
	rm -rf frontend/build
	rm -f nova-dashboard
