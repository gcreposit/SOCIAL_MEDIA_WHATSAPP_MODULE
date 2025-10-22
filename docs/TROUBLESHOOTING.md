# Wasender API Migration - Troubleshooting Guide

This document provides comprehensive troubleshooting procedures for common issues in the Wasender API Migration system.

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Application Issues](#application-issues)
3. [Database Issues](#database-issues)
4. [Webhook Issues](#webhook-issues)
5. [Session Management Issues](#session-management-issues)
6. [Media Processing Issues](#media-processing-issues)
7. [Performance Issues](#performance-issues)
8. [Network and Connectivity Issues](#network-and-connectivity-issues)
9. [Monitoring and Alerting Issues](#monitoring-and-alerting-issues)
10. [Emergency Procedures](#emergency-procedures)

## Quick Diagnostics

### Health Check Commands

```bash
# Check application health
curl -s http://localhost:3000/health | jq

# Check detailed health status
curl -s http://localhost:3000/health/detailed | jq

# Check specific service health
curl -s http://localhost:3000/health/service/database | jq
curl -s http://localhost:3000/health/service/wasender_api | jq
curl -s http://localhost:3000/health/service/whatsapp_session | jq

# Check system metrics
curl -s http://localhost:3000/metrics | jq

# Check active alerts
curl -s http://localhost:3000/alerts | jq
```

### System Status Commands

```bash
# Check PM2 processes
pm2 status
pm2 logs wasender-migration --lines 50

# Check system resources
htop
df -h
free -h

# Check network connections
netstat -tulpn | grep :3000
ss -tulpn | grep :3000

# Check Nginx status (if using reverse proxy)
sudo systemctl status nginx
sudo nginx -t
```

### Log Locations

```bash
# Application logs
tail -f /var/log/wasender-migration/wasender-migration.log
tail -f /var/log/wasender-migration/wasender-migration-error.log

# PM2 logs
pm2 logs wasender-migration

# Nginx logs (if applicable)
tail -f /var/log/nginx/wasender-migration.access.log
tail -f /var/log/nginx/wasender-migration.error.log

# System logs
sudo journalctl -u nginx -f
sudo journalctl -f
```

## Application Issues

### Issue: Application Won't Start

**Symptoms:**
- PM2 shows process as "errored" or "stopped"
- Cannot access web interface
- Health checks fail

**Diagnosis:**
```bash
# Check PM2 status
pm2 status

# Check application logs
pm2 logs wasender-migration --lines 100

# Check for port conflicts
sudo lsof -i :3000
```

**Solutions:**

1. **Port already in use:**
   ```bash
   # Kill process using port 3000
   sudo kill -9 $(sudo lsof -t -i:3000)
   
   # Or change port in environment
   export PORT=3001
   pm2 restart wasender-migration
   ```

2. **Missing environment variables:**
   ```bash
   # Check environment file
   cat .env.production
   
   # Verify required variables are set
   node -e "
   require('dotenv').config({path: '.env.production'});
   const required = ['WASENDER_API_KEY', 'WASENDER_PERSONAL_ACCESS_TOKEN', 'WASENDER_WEBHOOK_SECRET'];
   required.forEach(key => {
     if (!process.env[key]) console.log('Missing:', key);
   });
   "
   ```

3. **Database connection issues:**
   ```bash
   # Test database connection
   mysql -u $DB_USER -p$DB_PASSWORD -h $DB_HOST $DB_NAME -e "SELECT 1;"
   ```

4. **File permission issues:**
   ```bash
   # Fix ownership
   sudo chown -R deploy:deploy /var/www/wasender-migration
   sudo chown -R deploy:deploy /var/app/attachments
   
   # Fix permissions
   chmod -R 755 /var/www/wasender-migration
   chmod -R 755 /var/app/attachments
   ```

### Issue: High Memory Usage

**Symptoms:**
- PM2 shows high memory usage
- Application becomes slow or unresponsive
- System alerts for memory usage

**Diagnosis:**
```bash
# Check memory usage
pm2 monit
free -h
ps aux --sort=-%mem | head -10

# Check for memory leaks
node --inspect src/index.js
```

**Solutions:**

1. **Restart application:**
   ```bash
   pm2 restart wasender-migration
   ```

2. **Increase memory limit:**
   ```bash
   # Update ecosystem.config.js
   max_memory_restart: '2000M'
   pm2 reload ecosystem.config.js
   ```

3. **Optimize garbage collection:**
   ```bash
   # Add to ecosystem.config.js
   node_args: '--expose-gc --max-old-space-size=2048'
   ```

### Issue: Application Crashes Frequently

**Symptoms:**
- PM2 shows frequent restarts
- Error logs show uncaught exceptions
- Service becomes unreliable

**Diagnosis:**
```bash
# Check restart count
pm2 status

# Check error logs
pm2 logs wasender-migration --err --lines 200

# Check for core dumps
ls -la /var/crash/
```

**Solutions:**

1. **Fix uncaught exceptions:**
   ```bash
   # Add error handling to main process
   process.on('uncaughtException', (error) => {
     console.error('Uncaught Exception:', error);
     process.exit(1);
   });
   
   process.on('unhandledRejection', (reason, promise) => {
     console.error('Unhandled Rejection at:', promise, 'reason:', reason);
     process.exit(1);
   });
   ```

2. **Increase restart delay:**
   ```bash
   # Update ecosystem.config.js
   restart_delay: 4000,
   exponential_backoff_restart_delay: 100
   ```

## Database Issues

### Issue: Database Connection Failures

**Symptoms:**
- Database health check fails
- Cannot save messages or attachments
- Connection timeout errors

**Diagnosis:**
```bash
# Test database connection
mysql -u $DB_USER -p$DB_PASSWORD -h $DB_HOST $DB_NAME

# Check database service status
sudo systemctl status mysql

# Check database logs
sudo tail -f /var/log/mysql/error.log

# Check connection pool
curl -s http://localhost:3000/health/service/database | jq
```

**Solutions:**

1. **Database service down:**
   ```bash
   sudo systemctl start mysql
   sudo systemctl enable mysql
   ```

2. **Connection pool exhausted:**
   ```bash
   # Increase pool size in configuration
   DB_CONNECTION_LIMIT=50
   
   # Restart application
   pm2 restart wasender-migration
   ```

3. **Network connectivity:**
   ```bash
   # Test network connection to database
   telnet $DB_HOST $DB_PORT
   
   # Check firewall rules
   sudo ufw status
   ```

### Issue: Database Performance Problems

**Symptoms:**
- Slow query responses
- High database CPU usage
- Timeout errors

**Diagnosis:**
```bash
# Check slow queries
mysql -u root -p -e "SHOW PROCESSLIST;"
mysql -u root -p -e "SHOW FULL PROCESSLIST;"

# Check database performance
mysql -u root -p -e "SHOW STATUS LIKE 'Slow_queries';"
mysql -u root -p -e "SHOW STATUS LIKE 'Threads_%';"
```

**Solutions:**

1. **Add database indexes:**
   ```sql
   -- Connect to database
   mysql -u root -p twitter_scrapper
   
   -- Add performance indexes
   CREATE INDEX idx_post_timestamp ON PostBank(postTimestamp);
   CREATE INDEX idx_channel_id ON PostBank(channelId);
   CREATE INDEX idx_source ON PostBank(source);
   CREATE INDEX idx_attachment_post_id ON CommonAttachment(post_bank_id);
   ```

2. **Optimize database configuration:**
   ```bash
   # Edit MySQL configuration
   sudo nano /etc/mysql/mysql.conf.d/mysqld.cnf
   
   # Add optimizations
   [mysqld]
   innodb_buffer_pool_size = 1G
   innodb_log_file_size = 256M
   max_connections = 200
   query_cache_size = 64M
   
   # Restart MySQL
   sudo systemctl restart mysql
   ```

## Webhook Issues

### Issue: Webhooks Not Being Received

**Symptoms:**
- No new messages being processed
- Webhook endpoint returns errors
- Wasender API shows webhook failures

**Diagnosis:**
```bash
# Test webhook endpoint locally
curl -X POST http://localhost:3000/webhook/wasender \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# Check webhook endpoint externally
curl -X POST https://your-domain.com/webhook/wasender \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# Check Nginx logs
sudo tail -f /var/log/nginx/wasender-migration.access.log
sudo tail -f /var/log/nginx/wasender-migration.error.log

# Check webhook handler logs
grep "webhook" /var/log/wasender-migration/wasender-migration.log
```

**Solutions:**

1. **Webhook URL not accessible:**
   ```bash
   # Check if domain resolves
   nslookup your-domain.com
   
   # Check if port is open
   telnet your-domain.com 443
   
   # Update Wasender webhook URL
   curl -X POST https://wasenderapi.com/api/webhook/update \
     -H "Authorization: Bearer $WASENDER_PERSONAL_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://your-domain.com/webhook/wasender"}'
   ```

2. **SSL certificate issues:**
   ```bash
   # Check SSL certificate
   openssl s_client -connect your-domain.com:443 -servername your-domain.com
   
   # Renew Let's Encrypt certificate
   sudo certbot renew
   sudo systemctl reload nginx
   ```

3. **Firewall blocking requests:**
   ```bash
   # Check firewall rules
   sudo ufw status
   
   # Allow HTTPS traffic
   sudo ufw allow 443
   ```

### Issue: Webhook Signature Verification Fails

**Symptoms:**
- Webhook requests return 401 Unauthorized
- Signature verification errors in logs
- Valid webhooks being rejected

**Diagnosis:**
```bash
# Check webhook secret configuration
echo $WASENDER_WEBHOOK_SECRET

# Check signature verification logs
grep "signature" /var/log/wasender-migration/wasender-migration.log

# Test signature generation
node -e "
const crypto = require('crypto');
const payload = JSON.stringify({test: 'data'});
const secret = process.env.WASENDER_WEBHOOK_SECRET;
const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
console.log('Expected signature:', signature);
"
```

**Solutions:**

1. **Incorrect webhook secret:**
   ```bash
   # Verify webhook secret with Wasender API
   curl -X GET https://wasenderapi.com/api/webhook/config \
     -H "Authorization: Bearer $WASENDER_PERSONAL_ACCESS_TOKEN"
   
   # Update webhook secret in environment
   nano .env.production
   pm2 restart wasender-migration
   ```

2. **Signature algorithm mismatch:**
   ```bash
   # Check signature algorithm in webhook handler
   grep -n "createHmac" src/services/wasender/webhookHandler.js
   ```

## Session Management Issues

### Issue: WhatsApp Session Not Connecting

**Symptoms:**
- QR code not appearing
- Session status shows "disconnected"
- Cannot send or receive messages

**Diagnosis:**
```bash
# Check session status
curl -s http://localhost:3000/health/service/whatsapp_session | jq

# Check session manager logs
grep "session" /var/log/wasender-migration/wasender-migration.log

# Test Wasender API connection
curl -X GET https://wasenderapi.com/api/status \
  -H "Authorization: Bearer $WASENDER_PERSONAL_ACCESS_TOKEN"
```

**Solutions:**

1. **Session expired or invalid:**
   ```bash
   # Delete existing session
   curl -X DELETE https://wasenderapi.com/api/whatsapp-sessions/$WASENDER_SESSION_NAME \
     -H "Authorization: Bearer $WASENDER_PERSONAL_ACCESS_TOKEN"
   
   # Create new session
   curl -X POST https://wasenderapi.com/api/whatsapp-sessions \
     -H "Authorization: Bearer $WASENDER_PERSONAL_ACCESS_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"sessionName": "'$WASENDER_SESSION_NAME'"}'
   ```

2. **API credentials invalid:**
   ```bash
   # Test API credentials
   curl -X GET https://wasenderapi.com/api/profile \
     -H "Authorization: Bearer $WASENDER_PERSONAL_ACCESS_TOKEN"
   ```

3. **Network connectivity to Wasender API:**
   ```bash
   # Test connectivity
   curl -I https://wasenderapi.com
   
   # Check DNS resolution
   nslookup wasenderapi.com
   ```

### Issue: QR Code Not Loading

**Symptoms:**
- QR code endpoint returns errors
- QR code image not displaying
- Authentication page shows errors

**Diagnosis:**
```bash
# Test QR code endpoint
curl -s http://localhost:3000/api/wasender/qr-code

# Check session manager
curl -s http://localhost:3000/api/wasender/session-status | jq

# Check Wasender API QR endpoint
curl -X GET https://wasenderapi.com/api/whatsapp-sessions/$WASENDER_SESSION_NAME/qrcode \
  -H "Authorization: Bearer $WASENDER_PERSONAL_ACCESS_TOKEN"
```

**Solutions:**

1. **Session not in QR state:**
   ```bash
   # Restart session to get QR code
   curl -X POST http://localhost:3000/api/wasender/reconnect
   ```

2. **QR code expired:**
   ```bash
   # QR codes expire after 2 minutes, refresh the page
   # Or restart the session
   ```

## Media Processing Issues

### Issue: Media Files Not Downloading

**Symptoms:**
- Attachments show as failed in database
- Media decryption errors in logs
- Empty or corrupted media files

**Diagnosis:**
```bash
# Check media processing logs
grep "media" /var/log/wasender-migration/wasender-migration.log

# Check attachment directory
ls -la /var/app/attachments/

# Check disk space
df -h /var/app/attachments/

# Test media decryption service
curl -s http://localhost:3000/health/service/file_system | jq
```

**Solutions:**

1. **Insufficient disk space:**
   ```bash
   # Check disk usage
   df -h
   
   # Clean up old attachments
   find /var/app/attachments -type f -mtime +30 -delete
   ```

2. **Permission issues:**
   ```bash
   # Fix permissions
   sudo chown -R deploy:deploy /var/app/attachments
   chmod -R 755 /var/app/attachments
   ```

3. **Network issues downloading media:**
   ```bash
   # Test connectivity to Wasender media URLs
   curl -I https://media.wasenderapi.com
   ```

### Issue: Media Decryption Failures

**Symptoms:**
- Media files download but cannot be opened
- Decryption errors in logs
- Hash verification failures

**Diagnosis:**
```bash
# Check media decryption logs
grep "decrypt" /var/log/wasender-migration/wasender-migration.log

# Check media file integrity
file /var/app/attachments/path/to/media/file

# Test decryption service
node -e "
const MediaDecryptionService = require('./src/services/mediaDecryptionService');
const service = new MediaDecryptionService();
// Test with sample media
"
```

**Solutions:**

1. **Incorrect media keys:**
   ```bash
   # Check if media keys are being properly extracted from webhook data
   grep "mediaKey" /var/log/wasender-migration/wasender-migration.log
   ```

2. **Corrupted download:**
   ```bash
   # Re-download and decrypt media
   # This would require re-processing the webhook event
   ```

## Performance Issues

### Issue: Slow Response Times

**Symptoms:**
- Web interface loads slowly
- API endpoints have high latency
- Health checks timeout

**Diagnosis:**
```bash
# Check response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/health

# Create curl-format.txt
echo "     time_namelookup:  %{time_namelookup}\n
        time_connect:  %{time_connect}\n
     time_appconnect:  %{time_appconnect}\n
    time_pretransfer:  %{time_pretransfer}\n
       time_redirect:  %{time_redirect}\n
  time_starttransfer:  %{time_starttransfer}\n
                     ----------\n
          time_total:  %{time_total}\n" > curl-format.txt

# Check system resources
htop
iotop
```

**Solutions:**

1. **High CPU usage:**
   ```bash
   # Check what's using CPU
   top -p $(pgrep -f "wasender-migration")
   
   # Scale horizontally
   pm2 scale wasender-migration +2
   ```

2. **Database performance:**
   ```bash
   # Check slow queries
   mysql -u root -p -e "SHOW PROCESSLIST;"
   
   # Add database indexes (see database section)
   ```

3. **Memory issues:**
   ```bash
   # Check memory usage
   free -h
   
   # Restart application to clear memory
   pm2 restart wasender-migration
   ```

## Network and Connectivity Issues

### Issue: Cannot Connect to External Services

**Symptoms:**
- Wasender API calls fail
- Webhook delivery fails
- DNS resolution errors

**Diagnosis:**
```bash
# Test external connectivity
ping google.com
curl -I https://wasenderapi.com

# Check DNS resolution
nslookup wasenderapi.com
dig wasenderapi.com

# Check routing
traceroute wasenderapi.com

# Check firewall
sudo ufw status
iptables -L
```

**Solutions:**

1. **DNS issues:**
   ```bash
   # Use different DNS servers
   echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
   echo "nameserver 8.8.4.4" | sudo tee -a /etc/resolv.conf
   ```

2. **Firewall blocking:**
   ```bash
   # Allow outbound HTTPS
   sudo ufw allow out 443
   sudo ufw allow out 80
   ```

3. **Proxy configuration:**
   ```bash
   # If behind corporate proxy
   export HTTP_PROXY=http://proxy.company.com:8080
   export HTTPS_PROXY=http://proxy.company.com:8080
   ```

## Monitoring and Alerting Issues

### Issue: Health Checks Failing

**Symptoms:**
- Health endpoints return 503 errors
- Monitoring shows services as unhealthy
- False positive alerts

**Diagnosis:**
```bash
# Check individual service health
curl -s http://localhost:3000/health/service/database | jq
curl -s http://localhost:3000/health/service/wasender_api | jq
curl -s http://localhost:3000/health/service/whatsapp_session | jq

# Check monitoring service logs
grep "health" /var/log/wasender-migration/wasender-migration.log
```

**Solutions:**

1. **Increase health check timeouts:**
   ```bash
   # Update health check configuration
   # In monitoring service configuration
   timeout: 10000, // 10 seconds
   retryAttempts: 3
   ```

2. **Disable problematic health checks:**
   ```bash
   # Temporarily disable specific health checks
   curl -X POST http://localhost:3000/service/database/toggle \
     -H "Content-Type: application/json" \
     -d '{"enabled": false}'
   ```

## Emergency Procedures

### Complete System Recovery

1. **Stop all services:**
   ```bash
   pm2 stop all
   sudo systemctl stop nginx
   ```

2. **Backup current state:**
   ```bash
   /usr/local/bin/backup-database.sh
   /usr/local/bin/backup-application.sh
   ```

3. **Restore from backup:**
   ```bash
   # Restore database
   mysql -u root -p twitter_scrapper < /var/backups/wasender-migration/db_backup_latest.sql
   
   # Restore application
   cd /var/www/wasender-migration
   tar -xzf /var/backups/wasender-migration/app_backup_latest.tar.gz
   ```

4. **Restart services:**
   ```bash
   sudo systemctl start nginx
   pm2 start ecosystem.config.js --env production
   ```

### Rollback Deployment

```bash
# Stop current deployment
pm2 stop wasender-migration

# Restore previous version
cd /var/www/wasender-migration
mv current current_failed
mv previous current

# Restart with previous version
cd current
pm2 start ecosystem.config.js --env production
```

### Emergency Contacts

- **System Administrator**: admin@your-company.com
- **Database Administrator**: dba@your-company.com
- **Wasender API Support**: support@wasenderapi.com
- **On-call Engineer**: +1-XXX-XXX-XXXX

### Escalation Procedures

1. **Level 1**: Check logs and restart services
2. **Level 2**: Contact system administrator
3. **Level 3**: Contact database administrator
4. **Level 4**: Contact vendor support (Wasender API)

This troubleshooting guide should help resolve most common issues. For complex problems, collect relevant logs and system information before contacting support.