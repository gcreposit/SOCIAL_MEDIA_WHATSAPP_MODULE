# WhatsApp Group Message Monitoring System - Testing Guide

## System Overview
This system captures WhatsApp messages from 75 districts via Wasender API webhooks, processes media attachments, and stores data in a MySQL database.

## Prerequisites for Testing

### 1. Environment Setup
Ensure your `.env` file contains:
```bash
# Database Configuration
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=your_db_name

# Wasender API Configuration
WASENDER_API_URL=https://api.wasender.com
WASENDER_API_KEY=your_api_key
WASENDER_SESSION_ID=your_session_id

# Media Storage
ATTACHMENT_PATH=./media

# Server Configuration
PORT=3000
NODE_ENV=development
```

### 2. Start the System
```bash
# Install dependencies
npm install

# Start the server
npm start
# OR for development with auto-reload
npm run dev
```

## Testing Steps

### Phase 1: Basic System Health

#### 1.1 Server Health Check
```bash
# Test basic server health
curl http://localhost:3000/health

# Expected Response:
{
  "status": "OK",
  "timestamp": "2025-10-22T...",
  "uptime": 123.456,
  "version": "1.0.0"
}
```

#### 1.2 Detailed Health Check
```bash
curl http://localhost:3000/health/detailed

# Expected Response:
{
  "status": "healthy|degraded|unhealthy",
  "services": {
    "database": { "status": "healthy", ... },
    "wasender": { "status": "healthy", ... }
  },
  "timestamp": "...",
  "version": "1.0.0"
}
```

### Phase 2: Database Connectivity

#### 2.1 Test Database Connection
```bash
# Get all groups (tests database connectivity)
curl http://localhost:3000/api/groups

# Expected Response:
[
  {
    "group_id": "120363123456789@g.us",
    "group_name": "District 1 Group",
    "message_count": 150,
    "last_message_time": "2025-10-22T..."
  }
]
```

#### 2.2 Test Message Retrieval
```bash
# Get recent messages
curl "http://localhost:3000/api/messages?limit=10&offset=0"

# Expected Response:
{
  "success": true,
  "messages": [
    {
      "id": 1,
      "message_id": "msg123",
      "group_id": "120363123456789@g.us",
      "content": "Test message",
      "timestamp": "2025-10-22T...",
      ...
    }
  ]
}
```

### Phase 3: Wasender Integration

#### 3.1 Check Wasender Session Status
```bash
curl http://localhost:3000/api/whatsapp/status

# Expected Response:
{
  "authenticated": true,
  "status": "connected",
  "sessionId": "your_session_id",
  "architecture": "wasender",
  "sessionInfo": {
    "createdAt": "...",
    "lastSuccessfulConnection": "...",
    "isMonitoring": true
  }
}
```

#### 3.2 Get QR Code (if not authenticated)
```bash
curl http://localhost:3000/api/whatsapp/qr

# Expected Response:
{
  "success": true,
  "qrCode": "data:image/png;base64,...",
  "sessionId": "your_session_id",
  "architecture": "wasender"
}
```

#### 3.3 Test Wasender Groups API
```bash
curl http://localhost:3000/api/wasender/groups

# Expected Response:
{
  "success": true,
  "groups": [
    {
      "groupId": "120363123456789@g.us",
      "groupName": "District 1 Group",
      "messageCount": 150,
      "platform": "whatsapp",
      "source": "wasender_webhook"
    }
  ],
  "totalGroups": 75,
  "architecture": "wasender"
}
```

### Phase 4: Webhook Testing

#### 4.1 Test Webhook Health
```bash
curl http://localhost:3000/webhook/health

# Expected Response:
{
  "status": "healthy",
  "webhook": {
    "status": "active",
    "lastProcessed": "...",
    "totalProcessed": 1234
  }
}
```

#### 4.2 Test Webhook Metrics
```bash
curl http://localhost:3000/webhook/metrics

# Expected Response:
{
  "success": true,
  "metrics": {
    "totalWebhooks": 1234,
    "successfulProcessing": 1200,
    "failedProcessing": 34,
    "averageProcessingTime": 150,
    "lastProcessedAt": "..."
  }
}
```

#### 4.3 Send Test Webhook (Development Only)
```bash
curl -X POST http://localhost:3000/webhook/test \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "data": {
      "messages": [{
        "key": {
          "id": "test-message-123",
          "remoteJid": "120363123456789@g.us",
          "participant": "1234567890@s.whatsapp.net"
        },
        "message": {
          "conversation": "Test message from API"
        },
        "messageTimestamp": 1729612800,
        "pushName": "Test User"
      }]
    }
  }'

# Expected Response:
{
  "success": true,
  "message": "Test webhook received",
  "testMode": true
}
```

### Phase 5: Media Processing

#### 5.1 Test Media Queue Status
```bash
curl http://localhost:3000/api/queue/status

# Expected Response:
{
  "success": true,
  "queue": {
    "pending": 5,
    "processing": 2,
    "completed": 1234,
    "failed": 12
  },
  "workers": {
    "active": 3,
    "idle": 2
  }
}
```

#### 5.2 Test Media File Serving
```bash
# List available media files
curl http://localhost:3000/api/media/images

# Expected Response:
{
  "type": "images",
  "count": 25,
  "files": [
    {
      "filename": "image_123.jpg",
      "size": 245760,
      "mimeType": "image/jpeg",
      "downloadUrl": "/api/media/images/image_123.jpg"
    }
  ]
}

# Download a specific media file
curl http://localhost:3000/api/media/images/image_123.jpg
# Should return the image file as binary data
```

#### 5.3 Test Media Queue Processing
```bash
curl http://localhost:3000/api/queue/process

# Expected Response:
{
  "success": true,
  "message": "Queue processing initiated",
  "queueStats": {
    "pending": 5,
    "processing": 3
  }
}
```

### Phase 6: End-to-End Testing

#### 6.1 Simulate Complete Message Flow
1. **Send a test message to one of your monitored WhatsApp groups**
2. **Check if webhook receives it:**
   ```bash
   curl http://localhost:3000/webhook/metrics
   # Check if totalWebhooks increased
   ```

3. **Verify message is stored in database:**
   ```bash
   curl "http://localhost:3000/api/messages?limit=1&offset=0"
   # Should show your test message
   ```

4. **If message contains media, check media processing:**
   ```bash
   curl http://localhost:3000/api/queue/status
   # Check if media is being processed
   ```

#### 6.2 Test Group Name Resolution
```bash
# Send message to group and check if group name is resolved
curl http://localhost:3000/api/groups
# Verify group names are human-readable, not JIDs
```

#### 6.3 Test Phone Number Formatting
```bash
# Check if phone numbers are properly formatted
curl "http://localhost:3000/api/messages?limit=10"
# Look for mobile_number field with proper formatting like "+1 722 295 3082901"
```

## Performance Testing

### Load Testing Webhooks
```bash
# Install Apache Bench (if not installed)
# macOS: brew install httpd
# Ubuntu: sudo apt-get install apache2-utils

# Test webhook endpoint with concurrent requests
ab -n 100 -c 10 -T application/json -p test_webhook.json http://localhost:3000/webhook/test

# Create test_webhook.json file:
echo '{
  "event": "messages.upsert",
  "data": {
    "messages": [{
      "key": {
        "id": "load-test-123",
        "remoteJid": "120363123456789@g.us",
        "participant": "1234567890@s.whatsapp.net"
      },
      "message": {
        "conversation": "Load test message"
      },
      "messageTimestamp": 1729612800
    }]
  }
}' > test_webhook.json
```

## Monitoring and Alerts

### System Metrics
```bash
# Get comprehensive system metrics
curl http://localhost:3000/metrics

# Get Prometheus-compatible metrics
curl http://localhost:3000/metrics/prometheus
```

### Active Alerts
```bash
curl http://localhost:3000/alerts
```

## Troubleshooting Common Issues

### 1. Database Connection Issues
```bash
# Check database service health
curl http://localhost:3000/health/service/database
```

### 2. Wasender API Issues
```bash
# Check Wasender service health
curl http://localhost:3000/health/service/wasender

# Check session status
curl http://localhost:3000/api/wasender/session-status
```

### 3. Media Processing Issues
```bash
# Check media queue health
curl http://localhost:3000/api/queue/health

# Check failed media processing
curl http://localhost:3000/api/queue/failed
```

### 4. Webhook Processing Issues
```bash
# Reset webhook metrics to clear counters
curl -X POST http://localhost:3000/webhook/metrics/reset

# Check webhook processing errors
curl http://localhost:3000/webhook/metrics
```

## Success Criteria

Your system is working correctly if:

✅ **Health checks return "healthy" status**
✅ **Database connectivity is established**
✅ **Wasender session is "connected"**
✅ **Webhooks are being received and processed**
✅ **Messages are stored in database with proper formatting**
✅ **Media files are downloaded and accessible**
✅ **Group names are resolved (not showing JIDs)**
✅ **Phone numbers are properly formatted**
✅ **No critical alerts are active**

## Next Steps After Testing

1. **Set up monitoring dashboards** using the `/metrics/prometheus` endpoint
2. **Configure alerting** based on the `/alerts` endpoint
3. **Set up log aggregation** for the application logs
4. **Configure backup procedures** for the database
5. **Set up SSL/TLS** for production deployment
6. **Configure rate limiting** for webhook endpoints
7. **Set up load balancing** if deploying multiple instances

## Web Interface Testing

After API testing, you can also test the web interface:

1. **Main Dashboard:** http://localhost:3000/
2. **QR Code Page:** http://localhost:3000/qr
3. **Dashboard View:** http://localhost:3000/dashboard.html

These interfaces provide visual confirmation that your system is working correctly.