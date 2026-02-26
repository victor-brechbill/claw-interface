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
}

# Check service status
check_service() {
    local service_name="$1"
    local description="$2"
    
    echo -e "\n${BLUE}=== $description ===${NC}"
    
    if systemctl --user is-active --quiet "$service_name"; then
        success "$service_name is running"
        systemctl --user status "$service_name" --no-pager -l | head -10
    else
        error "$service_name is not running"
        systemctl --user status "$service_name" --no-pager -l | head -10 || true
    fi
}

# Check port connectivity
check_port() {
    local port="$1"
    local description="$2"
    
    if nc -z localhost "$port" 2>/dev/null; then
        success "$description (localhost:$port) is accessible"
    else
        error "$description (localhost:$port) is not accessible"
    fi
}

# Check health endpoint
check_health() {
    local port="$1"
    local description="$2"
    
    if curl -f -s "http://localhost:$port/api/health" >/dev/null 2>&1; then
        success "$description health check passed"
        curl -s "http://localhost:$port/api/health" | jq . || curl -s "http://localhost:$port/api/health"
    else
        error "$description health check failed"
    fi
}

# Check Docker containers
check_docker() {
    echo -e "\n${BLUE}=== Docker Containers ===${NC}"
    
    if sg docker -c "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep agent" 2>/dev/null; then
        success "Agent containers found"
    else
        warning "No Agent containers found"
    fi
}

# Check file structure
check_files() {
    echo -e "\n${BLUE}=== File Structure ===${NC}"
    
    if [[ -f ~/agent-dashboard/agent-dashboard ]]; then
        success "Production binary exists"
    else
        error "Production binary not found at ~/agent-dashboard/agent-dashboard"
    fi
    
    if [[ -d ~/agent-dashboard/frontend ]]; then
        success "Production frontend exists"
    else
        error "Production frontend not found at ~/agent-dashboard/frontend"
    fi
    
    if [[ -f ~/agent-dashboard/config/prod.env ]]; then
        success "Production config exists"
        echo "Config contents:"
        cat ~/agent-dashboard/config/prod.env | sed 's/^/  /'
    else
        error "Production config not found at ~/agent-dashboard/config/prod.env"
    fi
}

# Main status check
main() {
    log "Agent Dashboard System Status Check"
    
    # Check systemd services
    check_service "agent-mongo.service" "MongoDB Service"
    check_service "agent-dashboard.service" "Dashboard Service"
    check_service "cloudflared.service" "Cloudflare Tunnel"
    
    # Check Docker containers
    check_docker
    
    # Check file structure
    check_files
    
    # Check ports
    echo -e "\n${BLUE}=== Port Connectivity ===${NC}"
    check_port 27018 "MongoDB Production"
    check_port 3080 "Dashboard Production"
    
    # Check health endpoints
    echo -e "\n${BLUE}=== Health Checks ===${NC}"
    check_health 3080 "Dashboard Production"
    
    # Check tunnel endpoint if possible
    echo -e "\n${BLUE}=== External Connectivity ===${NC}"
    if curl -f -s -k "https://YOUR_DOMAIN/api/health" >/dev/null 2>&1; then
        success "External tunnel health check passed"
        curl -s -k "https://YOUR_DOMAIN/api/health" | jq . 2>/dev/null || curl -s -k "https://YOUR_DOMAIN/api/health"
    else
        warning "External tunnel health check failed (may be normal if tunnel is down)"
    fi
    
    echo -e "\n${GREEN}Status check complete!${NC}"
}

# Run with different options
case "${1:-status}" in
    status|"")
        main
        ;;
    services)
        check_service "agent-mongo.service" "MongoDB Service"
        check_service "agent-dashboard.service" "Dashboard Service"
        check_service "cloudflared.service" "Cloudflare Tunnel"
        ;;
    docker)
        check_docker
        ;;
    files)
        check_files
        ;;
    health)
        check_health 3080 "Dashboard Production"
        ;;
    logs)
        echo "Recent logs:"
        journalctl --user -u agent-dashboard.service --since "10 minutes ago" --no-pager -l
        ;;
    help)
        echo "Usage: $0 [option]"
        echo ""
        echo "Options:"
        echo "  status    Full status check (default)"
        echo "  services  Check systemd services only"
        echo "  docker    Check Docker containers only"
        echo "  files     Check file structure only"
        echo "  health    Check health endpoint only"
        echo "  logs      Show recent application logs"
        echo "  help      Show this help"
        ;;
    *)
        echo "Unknown option: $1"
        echo "Run '$0 help' for usage information"
        exit 1
        ;;
esac