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

# Export development environment variables
export_dev_env() {
    log "Setting up development environment..."
    
    export DASHBOARD_ENV=development
    export DASHBOARD_PORT=3081
    export MONGO_URI=mongodb://localhost:27017
    export MONGO_DATABASE=agent_dashboard_dev
    export FRONTEND_DIR="$REPO_DIR/frontend/dist"
    export LOG_DIR="$REPO_DIR/logs"
    
    # Create logs directory if it doesn't exist
    mkdir -p "$LOG_DIR"
    
    success "Development environment configured"
}

# Check if MongoDB is running on default port
ensure_dev_mongo() {
    log "Checking MongoDB on localhost:27017..."
    
    if ! nc -z localhost 27017 2>/dev/null; then
        warning "MongoDB is not running on localhost:27017"
        log "Please start MongoDB manually or install it:"
        log "  sudo apt install mongodb-server"
        log "  sudo systemctl start mongodb"
        log ""
        log "Or use Docker:"
        log "  docker run -d --name mongo-dev -p 27017:27017 mongo:7"
        exit 1
    fi
    
    success "MongoDB is running"
}

# Build and run backend
run_backend() {
    log "Building and starting backend on port $DASHBOARD_PORT..."
    
    cd "$REPO_DIR/backend"
    
    # Ensure Go is in PATH
    export PATH="$PATH:/snap/bin"
    
    # Build and run
    go build -o agent-dashboard-dev .
    
    log "Starting Agent Dashboard backend..."
    log "Backend will be available at: http://localhost:$DASHBOARD_PORT"
    log "API health check: http://localhost:$DASHBOARD_PORT/api/health"
    log ""
    log "Press Ctrl+C to stop"
    
    exec ./agent-dashboard-dev
}

# Run frontend in development mode (separate terminal)
run_frontend() {
    log "Setting up frontend development server..."
    
    cd "$REPO_DIR/frontend"
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]]; then
        log "Installing npm dependencies..."
        npm ci
    fi
    
    log "Starting Vite development server..."
    log "Frontend will be available at: http://localhost:5173"
    log "It will proxy API requests to the backend at localhost:$DASHBOARD_PORT"
    log ""
    log "Press Ctrl+C to stop"
    
    exec npm run dev
}

# Show usage information
show_usage() {
    echo "Usage: $0 [option]"
    echo ""
    echo "Options:"
    echo "  backend    Build and run backend only (port 3081)"
    echo "  frontend   Run frontend development server only (port 5173)"
    echo "  full       Run backend, then optionally frontend in same terminal"
    echo ""
    echo "Examples:"
    echo "  $0 backend                    # Run backend only"
    echo "  $0 frontend                   # Run frontend only"
    echo "  $0 full                       # Run backend, prompt for frontend"
    echo "  $0                            # Same as 'full'"
}

# Full development setup
run_full() {
    export_dev_env
    ensure_dev_mongo
    
    log "Development setup complete!"
    log ""
    log "Starting backend..."
    
    # Build backend first
    cd "$REPO_DIR/backend"
    export PATH="$PATH:/snap/bin"
    go build -o agent-dashboard-dev .
    
    # Start backend in background
    log "Backend starting on port $DASHBOARD_PORT..."
    ./agent-dashboard-dev &
    BACKEND_PID=$!
    
    # Wait a moment for backend to start
    sleep 2
    
    # Check if backend is running
    if ! kill -0 $BACKEND_PID 2>/dev/null; then
        error "Backend failed to start"
    fi
    
    success "Backend is running (PID: $BACKEND_PID)"
    log "API health check: http://localhost:$DASHBOARD_PORT/api/health"
    
    # Ask about frontend
    echo ""
    read -p "Start frontend development server? (y/n): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        log "Starting frontend..."
        cd "$REPO_DIR/frontend"
        
        # Install dependencies if needed
        if [[ ! -d "node_modules" ]]; then
            npm ci
        fi
        
        # Start frontend (this will block)
        npm run dev &
        FRONTEND_PID=$!
        
        log "Frontend starting..."
        sleep 2
        
        if kill -0 $FRONTEND_PID 2>/dev/null; then
            success "Frontend is running (PID: $FRONTEND_PID)"
            log "Frontend URL: http://localhost:5173"
        else
            warning "Frontend may have failed to start"
        fi
    fi
    
    # Cleanup function
    cleanup() {
        log "Shutting down..."
        if [[ -n "${BACKEND_PID:-}" ]] && kill -0 $BACKEND_PID 2>/dev/null; then
            kill $BACKEND_PID
            log "Backend stopped"
        fi
        if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 $FRONTEND_PID 2>/dev/null; then
            kill $FRONTEND_PID
            log "Frontend stopped"
        fi
        exit 0
    }
    
    # Handle Ctrl+C
    trap cleanup SIGINT SIGTERM
    
    log "Development servers running. Press Ctrl+C to stop."
    
    # Wait for background processes
    wait
}

# Main function
main() {
    case "${1:-full}" in
        backend)
            export_dev_env
            ensure_dev_mongo
            run_backend
            ;;
        frontend)
            export_dev_env
            run_frontend
            ;;
        full)
            run_full
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            show_usage
            exit 1
            ;;
    esac
}

# Run main function
main "$@"