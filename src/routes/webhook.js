/**
 * Webhook Routes
 * Handles incoming webhooks from Wasender API with immediate response and background processing
 */

const express = require('express');
const { WebhookHandler } = require('../services/wasender');

/**
 * Create webhook router
 * @param {Object} sessionManager - SessionManager instance for session event handling
 * @param {Object} databaseService - Database service for data storage
 * @param {Object} wasenderClient - Wasender client for API calls
 * @returns {Object} - Express router with webhook endpoints
 */
function createWebhookRouter(sessionManager = null, databaseService = null, wasenderClient = null) {
    const router = express.Router();
    const webhookHandler = new WebhookHandler(sessionManager, databaseService, wasenderClient);

    /**
     * Wasender API webhook endpoint
     * POST /webhook/wasender
     * 
     * This endpoint:
     * 1. Immediately responds with 200 OK for valid requests
     * 2. Processes webhook events in background
     * 3. Includes security validation and rate limiting
     */
    router.post('/wasender', ...webhookHandler.createMiddleware());

    /**
     * Webhook health check endpoint
     * GET /webhook/health
     * 
     * Returns health status of webhook handler and related services
     */
    router.get('/health', (req, res) => {
        webhookHandler.healthCheck(req, res);
    });

    /**
     * Webhook metrics endpoint
     * GET /webhook/metrics
     * 
     * Returns processing metrics for monitoring and debugging
     */
    router.get('/metrics', (req, res) => {
        const metrics = webhookHandler.getMetrics();
        res.json({
            success: true,
            metrics,
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Reset webhook metrics (admin endpoint)
     * POST /webhook/metrics/reset
     * 
     * Resets all webhook processing metrics
     */
    router.post('/metrics/reset', (req, res) => {
        webhookHandler.resetMetrics();
        res.json({
            success: true,
            message: 'Webhook metrics reset successfully',
            timestamp: new Date().toISOString()
        });
    });

    /**
     * Test webhook endpoint (development only)
     * POST /webhook/test
     * 
     * Allows testing webhook processing with sample data
     */
    router.post('/test', (req, res) => {
        if (process.env.NODE_ENV === 'production') {
            return res.status(404).json({
                error: 'Test endpoint not available in production'
            });
        }

        // Immediately respond
        res.status(200).json({
            success: true,
            message: 'Test webhook received',
            timestamp: new Date().toISOString(),
            testMode: true
        });

        // Process test data in background
        setImmediate(() => {
            const testData = req.body || {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'test-message-' + Date.now(),
                            remoteJid: 'test-group@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            conversation: 'Test message from webhook test endpoint'
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000),
                        pushName: 'Test User'
                    }]
                }
            };

            webhookHandler.processWebhookData(testData, {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                timestamp: new Date().toISOString(),
                testMode: true
            }).catch(error => {
                console.error('Test webhook processing error:', error);
            });
        });
    });

    /**
     * Webhook status endpoint
     * GET /webhook/status
     * 
     * Returns basic status information about webhook endpoints
     */
    router.get('/status', (req, res) => {
        res.json({
            success: true,
            message: 'Webhook endpoints are active',
            endpoints: {
                'POST /webhook/wasender': 'Main Wasender API webhook endpoint',
                'GET /webhook/health': 'Health check endpoint',
                'GET /webhook/metrics': 'Processing metrics endpoint',
                'POST /webhook/metrics/reset': 'Reset metrics endpoint',
                'POST /webhook/test': 'Test endpoint (development only)',
                'GET /webhook/status': 'This status endpoint'
            },
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    });

    return router;
}

module.exports = createWebhookRouter;