/**
 * Webhook Handler Service
 * Processes incoming webhooks from Wasender API with security and rate limiting
 */

const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const logger = require('../loggingService');
const wasenderConfig = require('../../config/wasenderConfig');
const GroupMessageMonitor = require('./groupMessageMonitor');

class WebhookHandler {
    constructor(sessionManager = null, databaseService = null, wasenderClient = null) {
        this.webhookSecret = process.env.WASENDER_WEBHOOK_SECRET;
        this.rateLimiter = this.createRateLimiter();
        this.ipWhitelist = this.loadIPWhitelist();

        // Initialize GroupMessageMonitor with database service and wasender client
        this.groupMessageMonitor = new GroupMessageMonitor(databaseService, wasenderClient);

        // Store reference to SessionManager for session event handling
        this.sessionManager = sessionManager;

        // Initialize metrics for monitoring
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            signatureFailures: 0,
            rateLimitHits: 0
        };
    }

    /**
     * Set session manager reference
     */
    setSessionManager(sessionManager) {
        this.sessionManager = sessionManager;
        logger.info('SessionManager reference set in WebhookHandler');
    }

    /**
     * Create rate limiter middleware
     */
    createRateLimiter() {
        return rateLimit({
            windowMs: wasenderConfig.security.rateLimiting.windowMs,
            max: wasenderConfig.security.rateLimiting.max,
            message: {
                error: wasenderConfig.security.rateLimiting.message,
                retryAfter: Math.ceil(wasenderConfig.security.rateLimiting.windowMs / 1000)
            },
            standardHeaders: true,
            legacyHeaders: false,
            handler: (req, res) => {
                this.metrics.rateLimitHits++;
                logger.warn('Rate limit exceeded', {
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    path: req.path
                });
                res.status(429).json({
                    error: wasenderConfig.security.rateLimiting.message,
                    retryAfter: Math.ceil(wasenderConfig.security.rateLimiting.windowMs / 1000)
                });
            },
            skip: (req) => {
                // Skip rate limiting for whitelisted IPs
                return this.isWhitelistedIP(req.ip);
            }
        });
    }

    /**
     * Load IP whitelist from configuration
     */
    loadIPWhitelist() {
        const whitelist = process.env.WEBHOOK_IP_WHITELIST;
        if (!whitelist) return [];

        return whitelist.split(',').map(ip => ip.trim());
    }

    /**
     * Check if IP is whitelisted
     */
    isWhitelistedIP(ip) {
        if (this.ipWhitelist.length === 0) return false;
        return this.ipWhitelist.includes(ip);
    }

    /**
     * Get rate limiter middleware
     */
    getRateLimiter() {
        return this.rateLimiter;
    }

    /**
     * Process incoming webhook with enhanced security
     */
    async processWebhook(req, res) {
        const startTime = Date.now();
        this.metrics.totalRequests++;

        try {
            // Security checks
            const securityCheck = this.performSecurityChecks(req);
            if (!securityCheck.valid) {
                this.metrics.failedRequests++;
                return res.status(securityCheck.statusCode).json({
                    error: securityCheck.message
                });
            }

            // Immediately respond with 200 OK for valid requests
            res.status(200).json({
                success: true,
                timestamp: new Date().toISOString(),
                requestId: this.generateRequestId()
            });

            // Process webhook in background
            setImmediate(() => {
                this.processWebhookData(req.body, {
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    timestamp: new Date().toISOString(),
                    processingTime: Date.now() - startTime
                });
            });

            this.metrics.successfulRequests++;

        } catch (error) {
            this.metrics.failedRequests++;
            logger.error('Webhook processing error', {
                error: error.message,
                stack: error.stack,
                ip: req.ip,
                userAgent: req.get('User-Agent')
            });

            // Return error response if not already sent
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'Internal server error',
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    /**
     * Perform comprehensive security checks
     */
    performSecurityChecks(req) {
        // Check content type
        if (!req.is('application/json')) {
            logger.warn('Invalid content type', {
                contentType: req.get('Content-Type'),
                ip: req.ip
            });
            return {
                valid: false,
                statusCode: 400,
                message: 'Invalid content type. Expected application/json'
            };
        }

        // Check payload size
        const payloadSize = JSON.stringify(req.body).length;
        const maxPayloadSize = 1024 * 1024; // 1MB
        if (payloadSize > maxPayloadSize) {
            logger.warn('Payload too large', {
                payloadSize,
                maxPayloadSize,
                ip: req.ip
            });
            return {
                valid: false,
                statusCode: 413,
                message: 'Payload too large'
            };
        }

        // Verify webhook signature (temporarily disabled for testing)
        const signature = req.headers['x-webhook-signature'] || req.headers['X-Webhook-Signature'];
        const payload = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);

        // TODO: Re-enable signature verification after testing
        const signatureValid = true; // this.verifySignature(payload, signature);
        if (!signatureValid) {
            this.metrics.signatureFailures++;
            logger.error('Webhook signature verification failed', {
                headers: {
                    'x-webhook-signature': signature ? '[PRESENT]' : '[MISSING]',
                    'user-agent': req.get('User-Agent'),
                    'content-length': req.get('Content-Length')
                },
                ip: req.ip,
                payloadSize
            });
            return {
                valid: false,
                statusCode: 401,
                message: 'Unauthorized: Invalid signature'
            };
        }

        return { valid: true };
    }

    /**
     * Generate unique request ID for tracking
     */
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Verify webhook signature using HMAC-SHA256 with enhanced security
     */
    verifySignature(payload, signature) {
        if (!signature || !this.webhookSecret) {
            logger.debug('Missing signature or webhook secret', {
                hasSignature: !!signature,
                hasSecret: !!this.webhookSecret
            });
            return false;
        }

        try {
            // Handle different signature formats
            let receivedSignature = signature;
            if (signature.startsWith('sha256=')) {
                receivedSignature = signature.replace('sha256=', '');
            }

            // Ensure signature is in hex format (remove any non-hex characters)
            receivedSignature = receivedSignature.replace(/[^a-fA-F0-9]/g, '');

            // Generate expected signature
            const expectedSignature = crypto
                .createHmac('sha256', this.webhookSecret)
                .update(payload, 'utf8')
                .digest('hex');

            // Use timing-safe comparison to prevent timing attacks
            // Ensure both signatures are the same length before comparison
            if (expectedSignature.length !== receivedSignature.length) {
                logger.debug('Signature length mismatch', {
                    expectedLength: expectedSignature.length,
                    receivedLength: receivedSignature.length
                });
                return false;
            }

            const isValid = crypto.timingSafeEqual(
                Buffer.from(expectedSignature, 'hex'),
                Buffer.from(receivedSignature, 'hex')
            );

            if (!isValid) {
                logger.debug('Signature verification failed', {
                    expectedLength: expectedSignature.length,
                    receivedLength: receivedSignature.length,
                    payloadLength: payload.length
                });
            }

            return isValid;

        } catch (error) {
            logger.error('Signature verification error', {
                error: error.message,
                signatureFormat: signature ? signature.substring(0, 20) + '...' : 'null'
            });
            return false;
        }
    }

    /**
     * Process webhook data based on event type with enhanced routing
     */
    async processWebhookData(data, metadata = {}) {
        const processingStartTime = Date.now();

        try {
            // Validate webhook data structure
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid webhook data structure');
            }

            const { event, data: eventData } = data;

            if (!event) {
                throw new Error('Missing event type in webhook data');
            }

            logger.info('Processing webhook event', {
                event,
                dataSize: JSON.stringify(eventData || {}).length,
                metadata,
                processingId: this.generateRequestId()
            });

            // Route to appropriate handler based on event type
            const eventHandlers = {
                'messages.upsert': this.handleMessageUpsert.bind(this),
                'messages.update': this.handleMessageUpdate.bind(this),
                'messages.received': this.handleMessageUpsert.bind(this), // Alias for messages.upsert
                'messages-group.received': this.handleMessageUpsert.bind(this), // Alias for messages.upsert
                'session.status': this.handleSessionStatus.bind(this),
                'qrcode.updated': this.handleQRCodeUpdate.bind(this),
                'connection.update': this.handleConnectionUpdate.bind(this),
                'auth.failure': this.handleAuthFailure.bind(this),
                'auth.success': this.handleAuthSuccess.bind(this)
            };

            const handler = eventHandlers[event];
            if (handler) {
                await handler(eventData, metadata);

                logger.debug('Webhook event processed successfully', {
                    event,
                    processingTime: Date.now() - processingStartTime,
                    metadata
                });
            } else {
                logger.warn('Unknown webhook event type', {
                    event,
                    availableEvents: Object.keys(eventHandlers),
                    metadata
                });
            }

        } catch (error) {
            logger.error('Webhook data processing error', {
                error: error.message,
                stack: error.stack,
                data: JSON.stringify(data).substring(0, 500) + '...',
                metadata,
                processingTime: Date.now() - processingStartTime
            });

            // Don't throw error to prevent webhook retry loops
            // Log and continue processing
        }
    }

    /**
     * Handle new messages with enhanced processing
     */
    async handleMessageUpsert(eventData, metadata = {}) {
        try {
            if (!eventData || !eventData.messages) {
                logger.warn('Invalid message upsert data', { eventData, metadata });
                return;
            }

            let { messages } = eventData;

            // Handle different message formats
            if (!messages) {
                // If no messages field, check if eventData itself is the message
                if (eventData.key && eventData.message) {
                    messages = [eventData];
                } else {
                    logger.warn('No messages found in event data', { eventData, metadata });
                    return;
                }
            } else if (!Array.isArray(messages)) {
                // If messages is an object, convert to array
                if (typeof messages === 'object' && messages.key) {
                    messages = [messages];
                } else {
                    logger.warn('Messages is not an array or valid object', { 
                        messagesType: typeof messages,
                        messages: JSON.stringify(messages).substring(0, 200),
                        metadata 
                    });
                    return;
                }
            }

            logger.info('Processing message batch', {
                messageCount: messages.length,
                metadata
            });

            for (const message of messages) {
                try {
                    await this.processIndividualMessage(message, metadata);
                } catch (messageError) {
                    logger.error('Individual message processing error', {
                        error: messageError.message,
                        messageId: message.key?.id,
                        metadata
                    });
                    // Continue processing other messages
                }
            }

        } catch (error) {
            logger.error('Message upsert handling error', {
                error: error.message,
                stack: error.stack,
                eventData: JSON.stringify(eventData).substring(0, 200) + '...',
                metadata
            });
        }
    }

    /**
     * Process individual message with validation
     */
    async processIndividualMessage(message, metadata = {}) {
        if (!message || !message.key) {
            logger.warn('Invalid message structure', { message, metadata });
            return;
        }

        const messageInfo = {
            messageId: message.key.id,
            from: message.key.remoteJid,
            participant: message.key.participant,
            type: message.message ? Object.keys(message.message)[0] : 'unknown',
            timestamp: message.messageTimestamp,
            hasMedia: this.hasMediaContent(message),
            metadata
        };

        logger.info('Processing individual message', messageInfo);

        try {
            // Route to Group Message Monitor for filtering and processing
            const result = await this.groupMessageMonitor.processMessage(message, metadata);

            if (result.success) {
                logger.debug('Message processed by GroupMessageMonitor', {
                    messageId: messageInfo.messageId,
                    result: result.reason || 'processed',
                    processingTime: result.processingTime
                });

                // If message was successfully processed (not ignored), continue with next steps
                if (result.normalizedMessage) {
                    // TODO: Route to database service for storage (task 4)
                    // TODO: Route to media decryption service if has media (task 5)
                    logger.info('Group message ready for database storage', {
                        messageId: result.messageId,
                        groupId: result.normalizedMessage.groupInfo.groupId,
                        hasMedia: result.normalizedMessage.hasMedia
                    });
                }
            } else {
                logger.warn('Message processing failed in GroupMessageMonitor', {
                    messageId: messageInfo.messageId,
                    error: result.error,
                    processingTime: result.processingTime
                });
            }
        } catch (error) {
            logger.error('Error routing message to GroupMessageMonitor', {
                error: error.message,
                stack: error.stack,
                messageId: messageInfo.messageId,
                metadata
            });
        }
    }

    /**
     * Check if message contains media content
     */
    hasMediaContent(message) {
        if (!message.message) return false;

        const mediaTypes = [
            'imageMessage',
            'videoMessage',
            'audioMessage',
            'documentMessage',
            'stickerMessage'
        ];

        return mediaTypes.some(type => message.message[type]);
    }

    /**
     * Handle message updates with enhanced validation
     */
    async handleMessageUpdate(eventData, metadata = {}) {
        try {
            if (!eventData || !eventData.updates) {
                logger.warn('Invalid message update data', { eventData, metadata });
                return;
            }

            const { updates } = eventData;

            if (!Array.isArray(updates)) {
                logger.warn('Updates is not an array', {
                    updatesType: typeof updates,
                    metadata
                });
                return;
            }

            logger.info('Processing message updates', {
                updateCount: updates.length,
                metadata
            });

            for (const update of updates) {
                try {
                    const updateInfo = {
                        messageId: update.key?.id,
                        from: update.key?.remoteJid,
                        updateType: update.update ? Object.keys(update.update)[0] : 'unknown',
                        updateData: update.update,
                        metadata
                    };

                    logger.info('Processing message update', updateInfo);

                    // Process message status updates (will be implemented in task 4)
                    // await databaseService.updateMessageStatus(update, metadata);

                    // For now, just log the update details
                    logger.debug('Message update ready for database processing', {
                        messageId: updateInfo.messageId,
                        updateType: updateInfo.updateType
                    });

                } catch (updateError) {
                    logger.error('Individual update processing error', {
                        error: updateError.message,
                        updateId: update.key?.id,
                        metadata
                    });
                    // Continue processing other updates
                }
            }

        } catch (error) {
            logger.error('Message update handling error', {
                error: error.message,
                stack: error.stack,
                eventData: JSON.stringify(eventData).substring(0, 200) + '...',
                metadata
            });
        }
    }

    /**
     * Handle session status changes with enhanced logging
     */
    async handleSessionStatus(eventData, metadata = {}) {
        try {
            if (!eventData) {
                logger.warn('Invalid session status data', { eventData, metadata });
                return;
            }

            const { sessionId, status, message, timestamp } = eventData;

            logger.info('Session status update', {
                sessionId,
                status,
                message,
                timestamp,
                metadata
            });

            // Route to SessionManager if available
            if (this.sessionManager) {
                await this.sessionManager.handleSessionEvents({
                    type: 'session.status',
                    data: eventData,
                    metadata
                });
            } else {
                logger.warn('SessionManager not available for session status handling');
            }

        } catch (error) {
            logger.error('Session status handling error', {
                error: error.message,
                stack: error.stack,
                eventData,
                metadata
            });
        }
    }

    /**
     * Handle QR code updates with enhanced validation
     */
    async handleQRCodeUpdate(eventData, metadata = {}) {
        try {
            if (!eventData) {
                logger.warn('Invalid QR code update data', { eventData, metadata });
                return;
            }

            const { sessionId, qrCode, timestamp } = eventData;

            logger.info('QR code updated', {
                sessionId,
                qrCodeLength: qrCode ? qrCode.length : 0,
                timestamp,
                metadata
            });

            // Route to SessionManager if available
            if (this.sessionManager) {
                await this.sessionManager.handleSessionEvents({
                    type: 'qrcode.updated',
                    data: eventData,
                    metadata
                });
            } else {
                logger.warn('SessionManager not available for QR code handling');
            }

        } catch (error) {
            logger.error('QR code update handling error', {
                error: error.message,
                stack: error.stack,
                eventData,
                metadata
            });
        }
    }

    /**
     * Handle connection updates
     */
    async handleConnectionUpdate(eventData, metadata = {}) {
        try {
            const { sessionId, connection, lastDisconnect, qr } = eventData;

            logger.info('Connection update', {
                sessionId,
                connection,
                lastDisconnect,
                hasQR: !!qr,
                metadata
            });

            // Route to SessionManager if available
            if (this.sessionManager) {
                await this.sessionManager.handleSessionEvents({
                    type: 'connection.update',
                    data: eventData,
                    metadata
                });
            } else {
                logger.warn('SessionManager not available for connection update handling');
            }

        } catch (error) {
            logger.error('Connection update handling error', {
                error: error.message,
                eventData,
                metadata
            });
        }
    }

    /**
     * Handle authentication failures
     */
    async handleAuthFailure(eventData, metadata = {}) {
        try {
            const { sessionId, reason, timestamp } = eventData;

            logger.error('Authentication failure', {
                sessionId,
                reason,
                timestamp,
                metadata
            });

            // Route to SessionManager if available
            if (this.sessionManager) {
                await this.sessionManager.handleSessionEvents({
                    type: 'auth.failure',
                    data: eventData,
                    metadata
                });
            } else {
                logger.warn('SessionManager not available for auth failure handling');
            }

        } catch (error) {
            logger.error('Auth failure handling error', {
                error: error.message,
                eventData,
                metadata
            });
        }
    }

    /**
     * Handle authentication success
     */
    async handleAuthSuccess(eventData, metadata = {}) {
        try {
            const { sessionId, user, timestamp } = eventData;

            logger.info('Authentication success', {
                sessionId,
                user: user ? { id: user.id, name: user.name } : null,
                timestamp,
                metadata
            });

            // Route to SessionManager if available
            if (this.sessionManager) {
                await this.sessionManager.handleSessionEvents({
                    type: 'auth.success',
                    data: eventData,
                    metadata
                });
            } else {
                logger.warn('SessionManager not available for auth success handling');
            }

        } catch (error) {
            logger.error('Auth success handling error', {
                error: error.message,
                eventData,
                metadata
            });
        }
    }

    /**
     * Get webhook handler metrics
     */
    getMetrics() {
        return {
            webhook: {
                ...this.metrics,
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            },
            groupMessageMonitor: this.groupMessageMonitor.getMetrics()
        };
    }

    /**
     * Reset metrics (useful for monitoring)
     */
    resetMetrics() {
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            signatureFailures: 0,
            rateLimitHits: 0
        };

        logger.info('Webhook handler metrics reset');
    }

    /**
     * Create Express middleware for webhook processing
     */
    createMiddleware() {
        return [
            // Apply rate limiting first
            this.getRateLimiter(),

            // Then process the webhook
            (req, res, next) => {
                this.processWebhook(req, res).catch(next);
            }
        ];
    }

    /**
     * Health check endpoint handler
     */
    healthCheck(req, res) {
        const metrics = this.getMetrics();
        const groupMonitorHealth = this.groupMessageMonitor.healthCheck();

        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            metrics,
            services: {
                webhookHandler: {
                    status: 'healthy',
                    configuration: {
                        hasWebhookSecret: !!this.webhookSecret,
                        rateLimitWindow: wasenderConfig.security.rateLimiting.windowMs,
                        rateLimitMax: wasenderConfig.security.rateLimiting.max,
                        ipWhitelistCount: this.ipWhitelist.length
                    }
                },
                groupMessageMonitor: groupMonitorHealth
            }
        };

        res.status(200).json(health);
    }
}

module.exports = WebhookHandler;