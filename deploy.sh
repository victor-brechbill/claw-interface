#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Directory paths
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="$HOME/agent-dashboard"
BINARY_NAME="agent-dashboard"

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

# Check required commands
check_requirements() {
    log "Checking requirements..."
    
    if ! command -v go >/dev/null 2>&1 && ! command -v /snap/bin/go >/dev/null 2>&1; then
        error "Go compiler not found"
    fi
    
    if ! command -v npm >/dev/null 2>&1; then
        error "npm not found"
    fi
    
    if ! command -v docker >/dev/null 2>&1; then
        error "Docker not found"
    fi
    
    success "Requirements check passed"
}

# Build Go binary
build_backend() {
    log "Building Go backend..."
    
    cd "$REPO_DIR/backend"
    
    # Ensure Go is in PATH
    export PATH="$PATH:/snap/bin"
    
    # Build the binary
    go build -o "$BINARY_NAME" .
    
    if [[ ! -f "$BINARY_NAME" ]]; then
        error "Failed to build Go binary"
    fi
    
    success "Backend built successfully"
}

# Build React frontend
build_frontend() {
    log "Building React frontend..."
    
    cd "$REPO_DIR/frontend"
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        log "Installing npm dependencies..."
        npm ci
    fi
    
    # Build the frontend
    npm run build
    
    if [[ ! -d "build" ]] && [[ ! -d "dist" ]]; then
        error "Frontend build failed - no build or dist directory found"
    fi
    
    success "Frontend built successfully"
}

# Kill processes on production port
kill_existing() {
    log "Checking for existing processes on port 3080..."
    
    # Kill any process using port 3080
    if fuser -k 3080/tcp 2>/dev/null; then
        warning "Killed existing process on port 3080"
        sleep 2
    else
        log "No process found on port 3080"
    fi
}

# Deploy files to production directory
deploy_files() {
    log "Deploying files to $DEPLOY_DIR..."
    
    # Create deployment directory structure
    mkdir -p "$DEPLOY_DIR/frontend"
    mkdir -p "$DEPLOY_DIR/config"
    
    # Preserve prod.env (critical — contains MONGO_URI and MONGO_DATABASE)
    if [[ ! -f "$DEPLOY_DIR/config/prod.env" ]]; then
        warn "prod.env missing! Creating default..."
        cat > "$DEPLOY_DIR/config/prod.env" << 'ENVEOF'
DASHBOARD_PORT=3080
FRONTEND_DIR=/home/ubuntu/agent-dashboard/frontend
MONGO_URI=mongodb://localhost:27018
MONGO_DATABASE=agent_dashboard_prod
ENVEOF
    fi
    
    # Copy binary
    cp "$REPO_DIR/backend/$BINARY_NAME" "$DEPLOY_DIR/"
    
    # Copy frontend build
    # Vite outputs to build/ (custom config) or dist/ (default)
    if [[ -d "$REPO_DIR/frontend/build" ]]; then
        cp -r "$REPO_DIR/frontend/build/"* "$DEPLOY_DIR/frontend/"
    else
        cp -r "$REPO_DIR/frontend/dist/"* "$DEPLOY_DIR/frontend/"
    fi
    
    # Set executable permissions
    chmod +x "$DEPLOY_DIR/$BINARY_NAME"
    
    success "Files deployed successfully"
}

# Ensure MongoDB container is running
ensure_mongo() {
    log "Ensuring production MongoDB is running..."
    
    cd "$REPO_DIR"
    
    # Check if container is running
    if ! sg docker -c "docker ps --format 'table {{.Names}}' | grep -q agent-mongo-prod"; then
        log "Starting MongoDB container..."
        sg docker -c "docker compose -f docker-compose.prod.yml up -d agent-mongo-prod"
        
        # Wait for MongoDB to be ready
        log "Waiting for MongoDB to be ready..."
        sleep 5
    else
        log "MongoDB container already running"
    fi
    
    success "MongoDB is ready"
}

# Restart systemd service
restart_service() {
    log "Restarting systemd service..."
    
    # Reload systemd to pick up any service file changes
    systemctl --user daemon-reload
    
    # Restart the service
    systemctl --user restart agent-dashboard.service
    
    success "Service restarted"
}

# Health check
health_check() {
    log "Performing health check..."
    
    # Wait a moment for service to start
    sleep 3
    
    # Try health check endpoint
    for i in {1..10}; do
        if curl -f -s http://localhost:3080/api/health >/dev/null; then
            success "Health check passed"
            return 0
        fi
        
        if [[ $i -eq 10 ]]; then
            error "Health check failed after 10 attempts"
        fi
        
        log "Health check attempt $i failed, retrying in 2 seconds..."
        sleep 2
    done
}

# Main deployment flow
main() {
    log "Starting Agent Dashboard deployment..."
    
    check_requirements
    build_backend
    build_frontend
    kill_existing
    deploy_files
    ensure_mongo
    restart_service
    health_check
    
    success "🚀 Deployment completed successfully!"
    log "Agent Dashboard is now running at: http://localhost:3080"
}

# Run main function
main "$@"