#!/bin/bash

# Production Deployment Script for Wasender API Migration
# This script sets up the production environment and deploys the application

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="wasender-migration"
APP_DIR="/var/www/${APP_NAME}"
LOG_DIR="/var/log/${APP_NAME}"
BACKUP_DIR="/var/backups/${APP_NAME}"
SERVICE_USER="deploy"

echo -e "${BLUE}Starting production deployment for ${APP_NAME}...${NC}"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root for security reasons"
   exit 1
fi

# Check if required tools are installed
check_dependencies() {
    print_status "Checking dependencies..."
    
    local deps=("node" "npm" "pm2" "git")
    for dep in "${deps[@]}"; do
        if ! command -v $dep &> /dev/null; then
            print_error "$dep is not installed. Please install it first."
            exit 1
        fi
    done
    
    print_status "All dependencies are installed"
}

# Create necessary directories
setup_directories() {
    print_status "Setting up directories..."
    
    sudo mkdir -p $APP_DIR
    sudo mkdir -p $LOG_DIR
    sudo mkdir -p $BACKUP_DIR
    sudo mkdir -p /var/app/attachments
    sudo mkdir -p /var/app/attachments/backup
    
    # Set proper ownership
    sudo chown -R $SERVICE_USER:$SERVICE_USER $APP_DIR
    sudo chown -R $SERVICE_USER:$SERVICE_USER $LOG_DIR
    sudo chown -R $SERVICE_USER:$SERVICE_USER $BACKUP_DIR
    sudo chown -R $SERVICE_USER:$SERVICE_USER /var/app/attachments
    
    print_status "Directories created and configured"
}

# Setup log rotation
setup_log_rotation() {
    print_status "Setting up log rotation..."
    
    sudo tee /etc/logrotate.d/${APP_NAME} > /dev/null <<EOF
${LOG_DIR}/*.log {
    daily
    missingok
    rotate 90
    compress
    delaycompress
    notifempty
    create 644 ${SERVICE_USER} ${SERVICE_USER}
    postrotate
        pm2 reloadLogs
    endscript
}
EOF
    
    print_status "Log rotation configured"
}

# Setup environment file
setup_environment() {
    print_status "Setting up production environment..."
    
    if [[ ! -f "${APP_DIR}/.env.production" ]]; then
        print_warning "Production environment file not found. Creating from template..."
        cp .env.production.example "${APP_DIR}/.env.production"
        print_warning "Please edit ${APP_DIR}/.env.production with your production values"
    fi
    
    # Set proper permissions for environment file
    chmod 600 "${APP_DIR}/.env.production"
    
    print_status "Environment configuration ready"
}

# Install application
install_application() {
    print_status "Installing application..."
    
    # Create backup of current deployment if exists
    if [[ -d "${APP_DIR}/current" ]]; then
        print_status "Creating backup of current deployment..."
        sudo cp -r "${APP_DIR}/current" "${BACKUP_DIR}/backup-$(date +%Y%m%d-%H%M%S)"
    fi
    
    # Copy application files
    print_status "Copying application files..."
    sudo cp -r . "${APP_DIR}/current/"
    sudo chown -R $SERVICE_USER:$SERVICE_USER "${APP_DIR}/current"
    
    # Install dependencies
    cd "${APP_DIR}/current"
    print_status "Installing Node.js dependencies..."
    npm ci --production
    
    print_status "Application installed successfully"
}

# Configure PM2
configure_pm2() {
    print_status "Configuring PM2..."
    
    # Stop existing PM2 processes
    pm2 stop $APP_NAME 2>/dev/null || true
    pm2 delete $APP_NAME 2>/dev/null || true
    
    # Start application with PM2
    pm2 start ecosystem.config.js --env production
    
    # Save PM2 configuration
    pm2 save
    
    # Setup PM2 startup script
    sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $SERVICE_USER --hp /home/$SERVICE_USER
    
    print_status "PM2 configured and application started"
}

# Setup nginx (optional)
setup_nginx() {
    if command -v nginx &> /dev/null; then
        print_status "Setting up Nginx reverse proxy..."
        
        sudo tee /etc/nginx/sites-available/${APP_NAME} > /dev/null <<EOF
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    location /webhook/wasender {
        proxy_pass http://localhost:3000/webhook/wasender;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
}
EOF
        
        # Enable site
        sudo ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/
        
        # Test nginx configuration
        sudo nginx -t && sudo systemctl reload nginx
        
        print_status "Nginx configured successfully"
    else
        print_warning "Nginx not found. Skipping reverse proxy setup."
    fi
}

# Setup monitoring
setup_monitoring() {
    print_status "Setting up monitoring..."
    
    # Create monitoring script
    sudo tee /usr/local/bin/${APP_NAME}-monitor.sh > /dev/null <<EOF
#!/bin/bash
# Simple monitoring script for ${APP_NAME}

APP_NAME="${APP_NAME}"
LOG_FILE="${LOG_DIR}/monitor.log"

# Check if PM2 process is running
if ! pm2 list | grep -q "\$APP_NAME.*online"; then
    echo "\$(date): \$APP_NAME is not running, attempting restart..." >> \$LOG_FILE
    pm2 restart \$APP_NAME
fi

# Check application health
if ! curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "\$(date): Health check failed for \$APP_NAME" >> \$LOG_FILE
fi
EOF
    
    sudo chmod +x /usr/local/bin/${APP_NAME}-monitor.sh
    
    # Add to crontab
    (crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/${APP_NAME}-monitor.sh") | crontab -
    
    print_status "Monitoring configured"
}

# Validate deployment
validate_deployment() {
    print_status "Validating deployment..."
    
    # Check if PM2 process is running
    if pm2 list | grep -q "${APP_NAME}.*online"; then
        print_status "PM2 process is running"
    else
        print_error "PM2 process is not running"
        return 1
    fi
    
    # Check if application responds
    sleep 5
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        print_status "Application health check passed"
    else
        print_warning "Application health check failed - this might be normal if health endpoint is not implemented yet"
    fi
    
    print_status "Deployment validation completed"
}

# Main deployment process
main() {
    print_status "Starting production deployment process..."
    
    check_dependencies
    setup_directories
    setup_log_rotation
    setup_environment
    install_application
    configure_pm2
    setup_nginx
    setup_monitoring
    validate_deployment
    
    print_status "Production deployment completed successfully!"
    print_status "Application is running on http://localhost:3000"
    print_status "Logs are available in: ${LOG_DIR}"
    print_status "PM2 status: pm2 status"
    print_status "PM2 logs: pm2 logs ${APP_NAME}"
    
    print_warning "Don't forget to:"
    print_warning "1. Update ${APP_DIR}/.env.production with your actual production values"
    print_warning "2. Configure your domain name in Nginx configuration"
    print_warning "3. Set up SSL certificates for HTTPS"
    print_warning "4. Configure your Wasender webhook URL to point to your production domain"
}

# Run main function
main "$@"