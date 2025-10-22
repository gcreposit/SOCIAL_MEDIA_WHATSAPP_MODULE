# Webhook Endpoints Documentation

This document describes the webhook endpoints implemented for the Wasender API migration.

## Overview

The webhook endpoints are designed to:
- Receive webhooks from Wasender API with immediate 200 OK response
- Process webhook events in background to avoid blocking the response
- Include comprehensive security measures and rate limiting
- Provide monitoring and debugging capabilities

## Endpoints

### Main Webhook Endpoint

**POST /webhook/wasender**

The primary endpoint for receiving webhooks from Wasender API.

**Features:**
- Immediate 200 OK response for valid requests
- Background processing of webhook events
- HMAC-SHA256 signature verification
- Rate limiting (1000 requests per 15 minutes by default)
- IP whitelisting support
- Comprehensive logging and metrics

**Headers Required:**
- `Content-Type: application/json`
- `X-Webhook-Signature: sha256=<signature>` (HMAC-SHA256 of request body)

**Response:**
```json
{
  "success": true,
  "timestamp": "2025-10-22T00:08:34.517Z",
  "requestId": "req_1761071914518_e533rvq9m"
}
```

**Security:**
- Returns 401 for invalid/missing signatures
- Returns 429 for rate limit exceeded
- Returns 413 for payload too large (>1MB)
- Returns 400 for invalid content type

### Health Check Endpoint

**GET /webhook/health**

Returns health status of webhook handler and related services.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-22T00:08:34.517Z",
  "metrics": {
    "webhook": {
      "totalRequests": 0,
      "successfulRequests": 0,
      "failedRequests": 0,
      "signatureFailures": 0,
      "rateLimitHits": 0,
      "uptime": 123.456
    },
    "groupMessageMonitor": {
      "totalMessagesReceived": 10,
      "groupMessagesProcessed": 8,
      "personalMessagesIgnored": 2
    }
  },
  "services": {
    "webhookHandler": {
      "status": "healthy",
      "configuration": {
        "hasWebhookSecret": true,
        "rateLimitWindow": 900000,
        "rateLimitMax": 1000,
        "ipWhitelistCount": 0
      }
    },
    "groupMessageMonitor": {
      "status": "healthy"
    }
  }
}
```

### Metrics Endpoint

**GET /webhook/metrics**

Returns processing metrics for monitoring and debugging.

**Response:**
```json
{
  "success": true,
  "metrics": {
    "webhook": {
      "totalRequests": 150,
      "successfulRequests": 145,
      "failedRequests": 5,
      "signatureFailures": 3,
      "rateLimitHits": 2,
      "uptime": 3600.123
    },
    "groupMessageMonitor": {
      "totalMessagesReceived": 100,
      "groupMessagesProcessed": 85,
      "personalMessagesIgnored": 15,
      "cacheStats": {
        "groupCacheSize": 10,
        "userCacheSize": 25,
        "processedMessagesCount": 85
      }
    }
  },
  "timestamp": "2025-10-22T00:08:34.517Z"
}
```

### Reset Metrics Endpoint

**POST /webhook/metrics/reset**

Resets all webhook processing metrics (admin endpoint).

**Response:**
```json
{
  "success": true,
  "message": "Webhook metrics reset successfully",
  "timestamp": "2025-10-22T00:08:34.517Z"
}
```

### Status Endpoint

**GET /webhook/status**

Returns basic status information about webhook endpoints.

**Response:**
```json
{
  "success": true,
  "message": "Webhook endpoints are active",
  "endpoints": {
    "POST /webhook/wasender": "Main Wasender API webhook endpoint",
    "GET /webhook/health": "Health check endpoint",
    "GET /webhook/metrics": "Processing metrics endpoint",
    "POST /webhook/metrics/reset": "Reset metrics endpoint",
    "POST /webhook/test": "Test endpoint (development only)",
    "GET /webhook/status": "This status endpoint"
  },
  "timestamp": "2025-10-22T00:08:34.517Z",
  "environment": "development"
}
```

### Test Endpoint (Development Only)

**POST /webhook/test**

Allows testing webhook processing with sample data. Only available in non-production environments.

**Request Body:**
```json
{
  "event": "messages.upsert",
  "data": {
    "messages": [{
      "key": { "id": "test-msg", "remoteJid": "test-group@g.us" },
      "message": { "conversation": "Test message" },
      "messageTimestamp": 1729555714
    }]
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Test webhook received",
  "timestamp": "2025-10-22T00:08:34.517Z",
  "testMode": true
}
```

## Configuration

### Environment Variables

```bash
# Webhook Configuration
WASENDER_WEBHOOK_SECRET=your_webhook_secret_here
WEBHOOK_IP_WHITELIST=192.168.1.1,10.0.0.1  # Optional, comma-separated IPs
NODE_ENV=development  # Set to 'production' to disable test endpoint

# Rate Limiting (configured in wasenderConfig.js)
WEBHOOK_RATE_LIMIT_WINDOW=900000  # 15 minutes in milliseconds
WEBHOOK_RATE_LIMIT_MAX=1000       # Max requests per window
```

### Security Configuration

The webhook endpoints include several security measures:

1. **Signature Verification**: All webhook requests must include a valid HMAC-SHA256 signature
2. **Rate Limiting**: Configurable rate limiting to prevent abuse
3. **IP Whitelisting**: Optional IP whitelist for additional security
4. **Payload Size Limits**: Maximum payload size of 1MB
5. **Content Type Validation**: Only accepts `application/json` content

## Event Processing

The webhook handler processes the following event types:

- `messages.upsert`: New messages (routed to GroupMessageMonitor)
- `messages.update`: Message status updates
- `session.status`: Session status changes
- `qrcode.updated`: QR code updates
- `connection.update`: Connection status changes
- `auth.failure`: Authentication failures
- `auth.success`: Authentication success

## Integration with Other Services

The webhook endpoints integrate with:

1. **GroupMessageMonitor**: Filters and processes group messages only
2. **DatabaseService**: Stores processed messages (implemented in task 4)
3. **MediaDecryptionService**: Handles media attachments (implemented in task 5)
4. **SessionManager**: Manages WhatsApp sessions (implemented in task 6)
5. **LoggingService**: Comprehensive logging of all webhook activities

## Monitoring and Debugging

- All webhook activities are logged with structured logging
- Metrics are tracked for monitoring webhook performance
- Health check endpoint provides service status
- Test endpoint allows easy debugging in development

## Error Handling

The webhook endpoints handle errors gracefully:

- Invalid signatures return 401 Unauthorized
- Rate limit exceeded returns 429 Too Many Requests
- Payload too large returns 413 Payload Too Large
- Invalid content type returns 400 Bad Request
- Processing errors are logged but don't affect webhook response
- Background processing failures are logged and don't cause webhook retries