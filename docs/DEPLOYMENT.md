# Wasender API Migration - Deployment Guide

This document provides comprehensive instructions for deploying the Wasender API Migration system to production environments.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Production Deployment](#production-deployment)
4. [Configuration](#configuration)
5. [SSL/TLS Setup](#ssltls-setup)
6. [Monitoring Setup](#monitoring-setup)
7. [Backup and Recovery](#backup-and-recovery)
8. [Scaling Considerations](#scaling-considerations)

## Prerequisites

### System Requirements

- **Operating System**: Ubuntu 20.04 LTS or CentOS 8+ (recommended)
- **Node.js**: Version 18.x or higher
- **MySQL**: Version 8.0 or higher
- **Memory**: Minimum 2GB RAM (4GB+ recommended for production)
- **Storage**: Minimum 20GB free space (more for media attachments)
- **Network**: Stable internet connection with public IP or domain

### Required Software

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2 globally
sudo npm install -g pm2

# Install Nginx (optional, for reverse proxy)
sudo apt install -y nginx

# Install MySQL (if not using external database)
sudo apt install -y mysql-server

# Install Git
sudo apt install -y git

# Install other utilities
sudo apt install -y curl wget unzip htop
```

### User Setup

```bash
# Create deployment user
sudo useradd -m -s /bin/bash deploy
sudo usermod -aG sudo deploy

# Switch to deployment user
sudo su - deploy

# Generate SSH key for deployment
ssh-keygen -t rsa -b 4096 -C "deploy@your-domain.com"
```

## Environment Setup

### 1. Clone Repository

```bash
# Clone the repository
git clone https://github.com/your-username/wasender-migration.git
cd wasender-migration

# Install dependencies
npm ci --production
```

### 2. Environment Configuration

```bash
# Copy production environment template
cp .env.production.example .env.production

# Edit production environment file
nano .env.production
```

**Required Environment Variables:**

```bash
# Server Configuration
NODE_ENV=production
PORT=3000

# Database Configuration
DB_HOST=your-database-host
DB_USER=your-database-user
DB_PASSWORD=your-secure-password
DB_NAME=twitter_scrapper
DB_PORT=3306

# Wasender API Configuration
WASENDER_API_KEY=your-production-api-key
WASENDER_PERSONAL_ACCESS_TOKEN=your-production-token
WASENDER_WEBHOOK_SECRET=your-webhook-secret
WASENDER_BASE_URL=https://wasenderapi.com
WASENDER_SESSION_NAME=production_group_monitor

# Webhook Configuration
WEBHOOK_URL=https://your-domain.com/webhook/wasender

# File Storage
ATTACHMENT_PATH=/var/app/attachments/

# Logging
LOG_LEVEL=warn
LOG_FILE_PATH=/var/log/wasender-migration/wasender-migration.log

# Security
CORS_ORIGIN=https://your-domain.com
```

### 3. Directory Structure Setup

```bash
# Create application directories
sudo mkdir -p /var/www/wasender-migration
sudo mkdir -p /var/log/wasender-migration
sudo mkdir -p /var/app/attachments
sudo mkdir -p /var/app/attachments/backup

# Set ownership
sudo chown -R deploy:deploy /var/www/wasender-migration
sudo chown -R deploy:deploy /var/log/wasender-migration
sudo chown -R deploy:deploy /var/app/attachments

# Set permissions
chmod 755 /var/www/wasender-migration
chmod 755 /var/log/wasender-migration
chmod 755 /var/app/attachments
```

## Production Deployment

### Automated Deployment

Use the provided deployment script:

```bash
# Make deployment script executable
chmod +x scripts/deploy-production.sh

# Run deployment script
./scripts/deploy-production.sh
```

### Manual Deployment

If you prefer manual deployment:

```bash
# 1. Copy application files
sudo cp -r . /var/www/wasender-migration/current/
sudo chown -R deploy:deploy /var/www/wasender-migration/current

# 2. Install dependencies
cd /var/www/wasender-migration/current
npm ci --production

# 3. Set up environment
cp .env.production /var/www/wasender-migration/current/.env

# 4. Start with PM2
pm2 start ecosystem.config.js --env production

# 5. Save PM2 configuration
pm2 save

# 6. Set up PM2 startup
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

### Database Setup

```bash
# Connect to MySQL
mysql -u root -p

# Create database and user (if not exists)
CREATE DATABASE IF NOT EXISTS twitter_scrapper;
CREATE USER IF NOT EXISTS 'wasender_user'@'%' IDENTIFIED BY 'secure_password';
GRANT ALL PRIVILEGES ON twitter_scrapper.* TO 'wasender_user'@'%';
FLUSH PRIVILEGES;
EXIT;

# Run database migrations (if any)
cd /var/www/wasender-migration/current
npm run migrate # If you have migrations
```

## Configuration

### Nginx Reverse Proxy

Create Nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/wasender-migration
```

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    
    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
    
    # Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied expired no-cache no-store private must-revalidate auth;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/javascript;
    
    # Main application
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
    
    # Webhook endpoint (critical for Wasender API)
    location /webhook/wasender {
        proxy_pass http://localhost:3000/webhook/wasender;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        
        # Increase body size for webhook payloads
        client_max_body_size 10M;
    }
    
    # Health check endpoints
    location /health {
        proxy_pass http://localhost:3000/health;
        access_log off;
    }
    
    location /ready {
        proxy_pass http://localhost:3000/ready;
        access_log off;
    }
    
    # Static files
    location /attachments/ {
        alias /var/app/attachments/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Logs location
    access_log /var/log/nginx/wasender-migration.access.log;
    error_log /var/log/nginx/wasender-migration.error.log;
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/wasender-migration /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Firewall Configuration

```bash
# Enable UFW firewall
sudo ufw enable

# Allow SSH
sudo ufw allow ssh

# Allow HTTP and HTTPS
sudo ufw allow 80
sudo ufw allow 443

# Allow application port (if not using Nginx)
sudo ufw allow 3000

# Check status
sudo ufw status
```

## SSL/TLS Setup

### Using Let's Encrypt (Recommended)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Test automatic renewal
sudo certbot renew --dry-run

# Set up automatic renewal
echo "0 12 * * * /usr/bin/certbot renew --quiet" | sudo crontab -
```

### Using Custom SSL Certificate

```bash
# Copy your certificate files
sudo cp your-certificate.crt /etc/ssl/certs/
sudo cp your-private-key.key /etc/ssl/private/

# Set proper permissions
sudo chmod 644 /etc/ssl/certs/your-certificate.crt
sudo chmod 600 /etc/ssl/private/your-private-key.key

# Update Nginx configuration with your certificate paths
```

## Monitoring Setup

### Log Rotation

```bash
sudo nano /etc/logrotate.d/wasender-migration
```

```
/var/log/wasender-migration/*.log {
    daily
    missingok
    rotate 90
    compress
    delaycompress
    notifempty
    create 644 deploy deploy
    postrotate
        pm2 reloadLogs
    endscript
}
```

### System Monitoring

```bash
# Install monitoring tools
sudo apt install -y htop iotop nethogs

# Set up basic monitoring script
sudo nano /usr/local/bin/wasender-monitor.sh
```

```bash
#!/bin/bash
# Basic monitoring script for Wasender Migration

LOG_FILE="/var/log/wasender-migration/monitor.log"
APP_NAME="wasender-migration"

# Check if PM2 process is running
if ! pm2 list | grep -q "$APP_NAME.*online"; then
    echo "$(date): $APP_NAME is not running, attempting restart..." >> $LOG_FILE
    pm2 restart $APP_NAME
fi

# Check application health
if ! curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "$(date): Health check failed for $APP_NAME" >> $LOG_FILE
fi

# Check disk space
DISK_USAGE=$(df /var/app/attachments | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 85 ]; then
    echo "$(date): High disk usage: ${DISK_USAGE}%" >> $LOG_FILE
fi

# Check memory usage
MEMORY_USAGE=$(free | grep Mem | awk '{printf("%.2f", $3/$2 * 100.0)}')
if (( $(echo "$MEMORY_USAGE > 90" | bc -l) )); then
    echo "$(date): High memory usage: ${MEMORY_USAGE}%" >> $LOG_FILE
fi
```

```bash
# Make script executable
sudo chmod +x /usr/local/bin/wasender-monitor.sh

# Add to crontab
(crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/wasender-monitor.sh") | crontab -
```

## Backup and Recovery

### Database Backup

```bash
# Create backup script
sudo nano /usr/local/bin/backup-database.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/wasender-migration"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="twitter_scrapper"
DB_USER="your-db-user"
DB_PASSWORD="your-db-password"

mkdir -p $BACKUP_DIR

# Create database backup
mysqldump -u $DB_USER -p$DB_PASSWORD $DB_NAME > $BACKUP_DIR/db_backup_$DATE.sql

# Compress backup
gzip $BACKUP_DIR/db_backup_$DATE.sql

# Remove backups older than 30 days
find $BACKUP_DIR -name "db_backup_*.sql.gz" -mtime +30 -delete

echo "Database backup completed: db_backup_$DATE.sql.gz"
```

```bash
# Make script executable
sudo chmod +x /usr/local/bin/backup-database.sh

# Schedule daily backups
(crontab -l 2>/dev/null; echo "0 2 * * * /usr/local/bin/backup-database.sh") | crontab -
```

### Application Backup

```bash
# Create application backup script
sudo nano /usr/local/bin/backup-application.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/wasender-migration"
DATE=$(date +%Y%m%d_%H%M%S)
APP_DIR="/var/www/wasender-migration/current"

mkdir -p $BACKUP_DIR

# Create application backup (excluding node_modules)
tar -czf $BACKUP_DIR/app_backup_$DATE.tar.gz \
    --exclude='node_modules' \
    --exclude='logs' \
    --exclude='.git' \
    -C /var/www/wasender-migration current

# Remove backups older than 7 days
find $BACKUP_DIR -name "app_backup_*.tar.gz" -mtime +7 -delete

echo "Application backup completed: app_backup_$DATE.tar.gz"
```

### Recovery Procedures

```bash
# Database recovery
gunzip /var/backups/wasender-migration/db_backup_YYYYMMDD_HHMMSS.sql.gz
mysql -u your-db-user -p twitter_scrapper < /var/backups/wasender-migration/db_backup_YYYYMMDD_HHMMSS.sql

# Application recovery
cd /var/www/wasender-migration
tar -xzf /var/backups/wasender-migration/app_backup_YYYYMMDD_HHMMSS.tar.gz
pm2 restart wasender-migration
```

## Scaling Considerations

### Horizontal Scaling

For high-traffic environments:

```bash
# Update PM2 configuration for multiple instances
pm2 start ecosystem.config.js --env production -i max

# Use load balancer (Nginx upstream)
upstream wasender_backend {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}

server {
    location / {
        proxy_pass http://wasender_backend;
    }
}
```

### Database Optimization

```sql
-- Add indexes for better performance
CREATE INDEX idx_post_timestamp ON PostBank(postTimestamp);
CREATE INDEX idx_channel_id ON PostBank(channelId);
CREATE INDEX idx_source ON PostBank(source);
CREATE INDEX idx_attachment_post_id ON CommonAttachment(post_bank_id);

-- Optimize MySQL configuration
-- Add to /etc/mysql/mysql.conf.d/mysqld.cnf
[mysqld]
innodb_buffer_pool_size = 1G
innodb_log_file_size = 256M
max_connections = 200
query_cache_size = 64M
```

### Storage Optimization

```bash
# Set up attachment cleanup job
sudo nano /usr/local/bin/cleanup-attachments.sh
```

```bash
#!/bin/bash
ATTACHMENT_DIR="/var/app/attachments"
RETENTION_DAYS=180

# Remove attachments older than retention period
find $ATTACHMENT_DIR -type f -mtime +$RETENTION_DAYS -delete

# Remove empty directories
find $ATTACHMENT_DIR -type d -empty -delete

echo "Attachment cleanup completed"
```

## Troubleshooting

### Common Issues

1. **Application won't start**
   ```bash
   # Check PM2 logs
   pm2 logs wasender-migration
   
   # Check system logs
   sudo journalctl -u nginx
   ```

2. **Database connection issues**
   ```bash
   # Test database connection
   mysql -u your-user -p -h your-host twitter_scrapper
   
   # Check database service
   sudo systemctl status mysql
   ```

3. **Webhook not receiving data**
   ```bash
   # Check Nginx logs
   sudo tail -f /var/log/nginx/wasender-migration.error.log
   
   # Test webhook endpoint
   curl -X POST https://your-domain.com/webhook/wasender
   ```

4. **High memory usage**
   ```bash
   # Check memory usage
   pm2 monit
   
   # Restart application
   pm2 restart wasender-migration
   ```

### Performance Monitoring

```bash
# Monitor application performance
pm2 monit

# Check system resources
htop

# Monitor network connections
netstat -tulpn | grep :3000

# Check disk I/O
iotop

# Monitor logs in real-time
tail -f /var/log/wasender-migration/wasender-migration.log
```

This deployment guide provides a comprehensive foundation for deploying the Wasender API Migration system to production. Adjust configurations based on your specific requirements and infrastructure setup.