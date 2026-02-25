#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# Install systemd services
install_services() {
    log "Installing systemd services..."
    
    # Create systemd user directory
    mkdir -p ~/.config/systemd/user
    
    # Check if services already exist
    if [[ -f ~/.config/systemd/user/nova-dashboard.service ]]; then
        warning "nova-dashboard.service already exists, backing up..."
        cp ~/.config/systemd/user/nova-dashboard.service ~/.config/systemd/user/nova-dashboard.service.bak
    fi
    
    if [[ -f ~/.config/systemd/user/nova-mongo.service ]]; then
        warning "nova-mongo.service already exists, backing up..."
        cp ~/.config/systemd/user/nova-mongo.service ~/.config/systemd/user/nova-mongo.service.bak
    fi
    
    # Copy service files (they're already created by the deployment setup)
    if [[ -f ~/.config/systemd/user/nova-mongo.service ]] && [[ -f ~/.config/systemd/user/nova-dashboard.service ]]; then
        log "Service files already installed"
    else
        error "Service files not found. Please run the deployment setup first."
    fi
    
    # Reload systemd
    systemctl --user daemon-reload
    
    success "Systemd services installed"
}

# Enable services
enable_services() {
    log "Enabling systemd services..."
    
    # Enable services (they will start automatically on login)
    systemctl --user enable nova-mongo.service
    systemctl --user enable nova-dashboard.service
    
    success "Services enabled"
}

# Show service status
show_status() {
    log "Service status:"
    echo ""
    
    echo "MongoDB service:"
    systemctl --user status nova-mongo.service --no-pager -l || true
    echo ""
    
    echo "Dashboard service:"
    systemctl --user status nova-dashboard.service --no-pager -l || true
    echo ""
    
    echo "Cloudflare tunnel service:"
    systemctl --user status cloudflared.service --no-pager -l || true
}

# Main function
main() {
    log "Installing Nova Dashboard systemd services..."
    
    install_services
    enable_services
    
    success "Installation complete!"
    
    log "Services installed and enabled:"
    log "- nova-mongo.service (MongoDB production container)"
    log "- nova-dashboard.service (Go backend)"
    log ""
    log "To start the services manually:"
    log "  systemctl --user start nova-mongo.service"
    log "  systemctl --user start nova-dashboard.service"
    log ""
    log "To check status:"
    log "  systemctl --user status nova-dashboard.service"
    log ""
    
    show_status
}

# Run main function
main "$@"