# Wasender API Setup Guide

This guide explains how to set up the Wasender API integration for the WhatsApp Message Capture System.

## Prerequisites

1. **Wasender API Account**: Create an account at [Wasender API](https://wasenderapi.com)
2. **Node.js**: Ensure Node.js 16+ is installed
3. **MySQL Database**: Existing database setup (already configured)

## Step 1: Obtain Wasender API Credentials

### 1.1 Create Wasender Account
1. Visit [Wasender API](https://wasenderapi.com)
2. Sign up for an account
3. Verify your email address

### 1.2 Generate API Credentials
1. Log into your Wasender dashboard
2. Navigate to **API Settings** or **Credentials**
3. Generate the following credentials:
   - **Session API Key**: Used for session management
   - **Personal Access Token**: Used for API authentication
   - **Webhook Secret**: Used for webhook signature verification

### 1.3 Configure Webhook URL
1. In the Wasender dashboard, go to **Webhook Settings**
2. Set the webhook URL (will be updated automatically by ngrok in development)
3. Subscribe to the following events:
   - `messages.upsert` (new messages)
   - `messages.update` (message updates)
   - `session.status` (session status changes)
   - `qrcode.updated` (QR code updates)

## Step 2: Configure Environment Variables

Update your `.env` file with the Wasender API credentials:

```bash
# Wasender API Configuration
WASENDER_API_KEY=your_session_api_key_here
WASENDER_PERSONAL_ACCESS_TOKEN=your_account_token_here
WASENDER_WEBHOOK_SECRET=your_webhook_secret_here
WASENDER_BASE_URL=https://wasenderapi.com
WASENDER_SESSION_NAME=group_monitor_session

# Webhook Configuration
WEBHOOK_PORT=3000
WEBHOOK_PATH=/webhook/wasender
NGROK_AUTH_TOKEN=your_ngrok_token_here

# File Storage Configuration
MAX_FILE_SIZE=50MB
ALLOWED_MEDIA_TYPES=image,video,audio,document

# Logging Configuration
LOG_LEVEL=info
LOG_FILE_PATH=./logs/wasender-migration.log
LOG_ROTATION=daily
LOG_MAX_FILES=30
```

## Step 3: Set Up Ngrok (Development Only)

### 3.1 Install Ngrok
```bash
# Install ngrok globally
npm install -g ngrok

# Or use the npm package (already installed)
# npm install ngrok
```

### 3.2 Get Ngrok Auth Token
1. Sign up at [ngrok.com](https://ngrok.com)
2. Get your auth token from the dashboard
3. Add it to your `.env` file as `NGROK_AUTH_TOKEN`

## Step 4: Install Dependencies

The required dependencies have been installed:
- `axios`: For HTTP API calls
- `crypto-js`: For webhook signature verification
- `ngrok`: For development tunnel

## Step 5: Directory Structure

The following directory structure has been created:

```
src/
├── config/
│   └── wasenderConfig.js       # Centralized configuration
├── services/
│   ├── loggingService.js       # Comprehensive logging
│   └── wasender/
│       ├── index.js            # Service exports
│       ├── wasenderClient.js   # API client wrapper
│       ├── webhookHandler.js   # Webhook processing
│       └── ngrokService.js     # Tunnel management
└── logs/                       # Log files directory
```

## Step 6: Testing the Setup

### 6.1 Validate Configuration

```javascript
const {validateConfig} = require('./wasenderConfig');

try {
    validateConfig();
    console.log('Configuration is valid');
} catch (error) {
    console.error('Configuration error:', error.message);
}
```

### 6.2 Test API Connection
```javascript
const { WasenderClient } = require('./src/services/wasender');

const client = new WasenderClient();
// Test methods will be available after implementing session management
```

## Step 7: Security Considerations

### 7.1 Environment Variables
- Never commit `.env` file to version control
- Use strong, unique webhook secrets
- Rotate API keys regularly

### 7.2 Webhook Security
- Webhook signature verification is implemented
- Rate limiting is configured
- IP whitelisting can be added for production

## Step 8: Production Deployment

### 8.1 Replace Ngrok
For production, replace ngrok with:
- Reverse proxy (nginx)
- Load balancer
- Direct public IP/domain

### 8.2 SSL Configuration
- Use HTTPS for webhook endpoints
- Configure SSL certificates
- Update Wasender webhook URL to HTTPS

## Troubleshooting

### Common Issues

1. **Invalid API Credentials**
   - Verify credentials in Wasender dashboard
   - Check environment variable names
   - Ensure no extra spaces in values

2. **Webhook Not Receiving Events**
   - Check ngrok tunnel status
   - Verify webhook URL in Wasender dashboard
   - Check firewall settings

3. **Signature Verification Fails**
   - Verify webhook secret matches
   - Check signature header format
   - Ensure payload is not modified

### Debug Logging

Enable debug logging:
```bash
LOG_LEVEL=debug
```

Check log files in `./logs/` directory for detailed information.

## Next Steps

After completing this setup:

1. **Task 2**: Implement Core Service Infrastructure
2. **Task 3**: Implement Webhook Processing Pipeline
3. **Task 4**: Implement Database Integration
4. **Task 5**: Implement Media Decryption and Storage
5. **Task 6**: Implement Session Management

## Support

For Wasender API specific issues:
- Check [Wasender API Documentation](https://wasenderapi.com/docs)
- Contact Wasender Support

For implementation issues:
- Check application logs
- Review error messages
- Verify configuration settings