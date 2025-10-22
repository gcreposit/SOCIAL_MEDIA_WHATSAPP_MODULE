/**
 * Example: How to integrate WebhookHandler with Express app
 * This shows how task 3.3 (webhook endpoint routes) will be implemented
 */

const express = require('express');
const createWebhookRouter = require('../src/routes/webhook');

// Example Express app setup
function setupWebhookIntegration() {
    const app = express();
    
    // Middleware for parsing JSON
    app.use(express.json({ limit: '1mb' }));
    
    // Add webhook routes
    const webhookRouter = createWebhookRouter();
    app.use('/webhook', webhookRouter);
    
    // Example of how to start the server
    const port = process.env.WEBHOOK_PORT || 3000;
    
    app.listen(port, () => {
        console.log(`🚀 Webhook server running on port ${port}`);
        console.log(`📡 Webhook endpoint: http://localhost:${port}/webhook/wasender`);
        console.log(`🏥 Health check: http://localhost:${port}/webhook/health`);
        console.log(`📊 Metrics: http://localhost:${port}/webhook/metrics`);
    });
    
    return app;
}

// Example usage
if (require.main === module) {
    require('dotenv').config();
    setupWebhookIntegration();
}

module.exports = setupWebhookIntegration;