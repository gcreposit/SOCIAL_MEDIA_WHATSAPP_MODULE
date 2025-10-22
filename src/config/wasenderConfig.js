/**
 * Wasender API Configuration
 * Centralized configuration for Wasender API integration
 */

const ProductionConfig = require('./productionConfig');

// Initialize production config
const productionConfig = new ProductionConfig();

const wasenderConfig = {
    // Use production configuration
    ...productionConfig.getWasenderConfig(),
    
    // Webhook Configuration
    webhook: productionConfig.getWebhookConfig(),
    
    // Ngrok Configuration
    ngrokAuthToken: process.env.NGROK_AUTH_TOKEN,
    
    // Webhook events to subscribe to
    webhookEvents: [
        'messages.upsert',      // New messages
        'messages.update',      // Message updates
        'session.status',       // Session status changes
        'qrcode.updated'        // QR code updates
    ],
    
    // API endpoints
    endpoints: {
        sessions: '/api/whatsapp-sessions',
        qrcode: '/api/whatsapp-sessions/:sessionId/qrcode',
        status: '/api/whatsapp-sessions/:sessionId/status',
        connect: '/api/whatsapp-sessions/:sessionId/connect',
        disconnect: '/api/whatsapp-sessions/:sessionId/disconnect',
        decryptMedia: '/api/decrypt-media',
        updateWebhook: '/api/webhook/update'
    },
    
    // File Storage Configuration
    fileStorage: productionConfig.getStorageConfig(),
    
    // Logging Configuration
    logging: productionConfig.getLoggingConfig(),
    
    // Session Configuration
    session: productionConfig.getSessionConfig(),
    
    // Security Configuration
    security: {
        signatureVerification: {
            algorithm: 'HMAC-SHA256',
            header: 'X-Webhook-Signature'
        },
        rateLimiting: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 1000, // limit each IP to 1000 requests per windowMs
            message: 'Too many webhook requests'
        }
    },
    
    // Performance Configuration
    performance: {
        apiTimeout: 30000, // 30 seconds
        retryAttempts: 3,
        retryDelay: 1000, // 1 second
        connectionPoolSize: 10
    },
    
    // Development Configuration
    development: {
        useNgrok: process.env.NODE_ENV === 'development',
        ngrokRegion: 'us',
        tunnelHealthCheckInterval: 30000 // 30 seconds
    }
};

// Validation function
function validateConfig() {
    return productionConfig.validateProductionConfig();
}

module.exports = {
    ...wasenderConfig,
    validateConfig,
    productionConfig
};