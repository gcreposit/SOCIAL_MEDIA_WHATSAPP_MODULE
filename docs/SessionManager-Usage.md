# SessionManager Usage Guide

The SessionManager service provides comprehensive WhatsApp session management via the Wasender API with automatic reconnection logic.

## Basic Usage

```javascript
const { SessionManager } = require('./src/services/wasender');

// Create and initialize session manager
const sessionManager = new SessionManager();

// Initialize the session manager
await sessionManager.initialize();

// Listen for session events
sessionManager.on('sessionCreated', (data) => {
    console.log('Session created:', data.sessionId);
});

sessionManager.on('sessionConnected', (data) => {
    console.log('Session connected successfully');
});

sessionManager.on('qrRequired', (data) => {
    console.log('QR code authentication required');
    // Get and display QR code
    const qrData = await sessionManager.getQRCode();
    console.log('QR Code:', qrData.qrCode);
});

sessionManager.on('statusChanged', (data) => {
    console.log('Status changed:', data.previousStatus, '->', data.newStatus);
});
```

## Integration with Express App

```javascript
const express = require('express');
const { SessionManager } = require('./src/services/wasender');

const app = express();
const sessionManager = new SessionManager();

// Initialize session manager
sessionManager.initialize();

// API endpoint to get session status
app.get('/api/session/status', async (req, res) => {
    try {
        const status = await sessionManager.getSessionStatus();
        const info = sessionManager.getSessionInfo();
        
        res.json({
            success: true,
            status,
            info
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to get QR code
app.get('/api/session/qr', async (req, res) => {
    try {
        const qrData = await sessionManager.getQRCode();
        res.json({
            success: true,
            qrCode: qrData.qrCode
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// API endpoint to manually reconnect
app.post('/api/session/reconnect', async (req, res) => {
    try {
        await sessionManager.connectSession();
        res.json({
            success: true,
            message: 'Reconnection initiated'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
```

## Event Handling

The SessionManager emits various events that you can listen to:

### Core Events

- `initialized` - Session manager has been initialized
- `sessionCreated` - New session has been created
- `sessionConnected` - Session is now connected
- `sessionDisconnected` - Session has been disconnected
- `qrRequired` - QR code authentication is required
- `qrCodeReceived` - QR code has been received
- `qrCodeUpdated` - QR code has been updated

### Status Events

- `statusChanged` - Session status has changed
- `connectionError` - Error occurred during connection
- `sessionError` - General session error occurred

### Reconnection Events

- `reconnectionScheduled` - Automatic reconnection has been scheduled
- `reconnectionFailed` - All reconnection attempts have failed
- `maxReconnectAttemptsReached` - Maximum reconnection attempts reached

### Example Event Handler

```javascript
sessionManager.on('statusChanged', (data) => {
    const { sessionId, previousStatus, newStatus, timestamp } = data;
    
    console.log(`Session ${sessionId} status changed from ${previousStatus} to ${newStatus}`);
    
    // Handle specific status changes
    switch (newStatus) {
        case 'connected':
            console.log('✅ WhatsApp session is now connected and ready');
            break;
        case 'disconnected':
            console.log('❌ WhatsApp session disconnected - automatic reconnection will be attempted');
            break;
        case 'qr':
            console.log('📱 QR code authentication required');
            break;
        case 'error':
            console.log('⚠️ Session error occurred');
            break;
    }
});

sessionManager.on('maxReconnectAttemptsReached', (data) => {
    console.error('🚨 Maximum reconnection attempts reached. Manual intervention required.');
    console.error(`Session ID: ${data.sessionId}, Total attempts: ${data.attempts}`);
    
    // Notify administrators or take corrective action
    notifyAdministrators('WhatsApp session requires manual reconnection');
});
```

## Configuration

The SessionManager uses environment variables for configuration:

```bash
# Required
WASENDER_API_KEY=your_session_api_key
WASENDER_PERSONAL_ACCESS_TOKEN=your_account_token
WASENDER_WEBHOOK_SECRET=your_webhook_secret
WASENDER_BASE_URL=https://wasenderapi.com

# Optional
WASENDER_SESSION_NAME=group_monitor_session
WASENDER_PHONE_NUMBER=+1234567890
```

## Advanced Usage

### Custom Reconnection Logic

```javascript
const sessionManager = new SessionManager();

// Override default reconnection settings
sessionManager.maxReconnectAttempts = 10;
sessionManager.reconnectDelay = 3000; // 3 seconds
sessionManager.maxReconnectDelay = 600000; // 10 minutes

// Custom reconnection handling
sessionManager.on('reconnectionFailed', async (data) => {
    console.log('All automatic reconnection attempts failed');
    
    // Wait 30 minutes and try creating a new session
    setTimeout(async () => {
        try {
            await sessionManager.reset();
            await sessionManager.createSession();
        } catch (error) {
            console.error('Failed to create new session:', error);
        }
    }, 30 * 60 * 1000);
});
```

### Session Health Monitoring

```javascript
// Monitor session health
setInterval(async () => {
    const info = sessionManager.getSessionInfo();
    
    if (info.status === 'connected') {
        const timeSinceLastCheck = Date.now() - (info.lastStatusCheck?.getTime() || 0);
        
        if (timeSinceLastCheck > 5 * 60 * 1000) { // 5 minutes
            console.warn('Session status not checked recently, forcing status check');
            await sessionManager.getSessionStatus();
        }
    }
}, 60000); // Check every minute
```

### Webhook Integration

```javascript
// Handle session events from webhooks
app.post('/webhook/wasender', (req, res) => {
    const eventData = req.body;
    
    // Handle session-related events
    if (eventData.event === 'session.status' || eventData.event === 'qrcode.updated') {
        sessionManager.handleSessionEvents(eventData);
    }
    
    res.status(200).send('OK');
});
```

## Error Handling

The SessionManager includes comprehensive error handling:

```javascript
sessionManager.on('error', (error) => {
    console.error('SessionManager error:', error);
    
    // Log error details
    logger.error('SessionManager error', {
        error: error.message,
        stack: error.stack,
        sessionId: sessionManager.sessionId,
        status: sessionManager.sessionStatus
    });
});

// Handle specific error types
sessionManager.on('connectionError', (error) => {
    console.error('Connection error:', error.message);
    
    // Implement custom error handling logic
    if (error.message.includes('timeout')) {
        console.log('Connection timeout - will retry with longer timeout');
    }
});
```

## Cleanup

Always cleanup the SessionManager when shutting down:

```javascript
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    
    try {
        await sessionManager.cleanup();
        console.log('SessionManager cleanup complete');
    } catch (error) {
        console.error('Error during cleanup:', error);
    }
    
    process.exit(0);
});
```

## Requirements Satisfied

This SessionManager implementation satisfies the following requirements:

- **Requirement 8.1**: Automatic reconnection when WhatsApp session is disconnected
- **Requirement 8.3**: Session expiry detection and re-authentication options  
- **Requirement 8.4**: Session health monitoring and status reporting
- **Requirement 1.1**: WhatsApp session establishment using Wasender API credentials

The service provides a robust foundation for managing WhatsApp sessions in the migrated Wasender API architecture.