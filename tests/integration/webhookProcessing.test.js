/**
 * Webhook Processing Integration Tests
 * Tests end-to-end webhook processing from HTTP request to database storage
 */

const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const WebhookHandler = require('../../src/services/wasender/webhookHandler');
const GroupMessageMonitor = require('../../src/services/wasender/groupMessageMonitor');
const DatabaseService = require('../../src/services/databaseService');

// Mock dependencies
jest.mock('../../src/services/loggingService', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    getServiceLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

jest.mock('../../src/config/wasenderConfig', () => ({
    security: {
        rateLimiting: {
            windowMs: 15 * 60 * 1000,
            max: 1000,
            message: 'Too many webhook requests'
        }
    }
}));

describe('Webhook Processing Integration', () => {
    let app;
    let webhookHandler;
    let mockDatabaseService;
    let mockSessionManager;

    beforeEach(() => {
        // Set up environment variables
        process.env.WASENDER_WEBHOOK_SECRET = 'test-webhook-secret';
        
        // Create Express app
        app = express();
        app.use(express.json());
        
        // Add raw body parser for signature verification
        app.use('/webhook', (req, res, next) => {
            req.rawBody = Buffer.from(JSON.stringify(req.body));
            next();
        });

        // Mock DatabaseService
        mockDatabaseService = {
            saveGroupMessage: jest.fn(),
            saveUserInfo: jest.fn(),
            getUserByPlatformId: jest.fn(),
            getUserStatistics: jest.fn()
        };

        // Mock SessionManager
        mockSessionManager = {
            handleSessionEvents: jest.fn()
        };

        // Create WebhookHandler with mocked dependencies
        webhookHandler = new WebhookHandler(mockSessionManager);
        
        // Set up database service in GroupMessageMonitor
        webhookHandler.groupMessageMonitor.setDatabaseService(mockDatabaseService);

        // Add webhook route
        app.post('/webhook/wasender', webhookHandler.createMiddleware());
    });

    afterEach(() => {
        delete process.env.WASENDER_WEBHOOK_SECRET;
        jest.clearAllMocks();
    });

    describe('End-to-End Group Message Processing', () => {
        test('should process group message webhook to database storage', async () => {
            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'test-msg-id-123',
                            remoteJid: 'group123@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            conversation: 'Test group message for integration'
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000),
                        pushName: 'Test User'
                    }]
                }
            };

            // Mock successful database storage
            mockDatabaseService.saveGroupMessage.mockResolvedValue({
                success: true,
                messageId: 'test-msg-id-123',
                postBankId: 1,
                groupId: 'group123@g.us',
                userOperation: 'created'
            });

            mockDatabaseService.saveUserInfo.mockResolvedValue({
                id: 1,
                display_name: 'Test User',
                mobile_number: '1234567890',
                created_at: new Date(),
                updated_at: new Date()
            });

            // Generate valid signature
            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            // Send webhook request
            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            // Verify HTTP response
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify database operations were called
            expect(mockDatabaseService.saveGroupMessage).toHaveBeenCalledWith(
                webhookPayload.data.messages[0],
                expect.objectContaining({
                    groupId: 'group123@g.us',
                    isGroup: true
                }),
                expect.objectContaining({
                    userId: '1234567890@s.whatsapp.net',
                    displayName: 'Test User',
                    platform: 'whatsapp'
                })
            );
        });

        test('should ignore personal messages in webhook processing', async () => {
            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'personal-msg-id',
                            remoteJid: '1234567890@s.whatsapp.net' // Personal message JID
                        },
                        message: {
                            conversation: 'Personal message'
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000)
                    }]
                }
            };

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            expect(response.status).toBe(200);

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify database operations were NOT called for personal message
            expect(mockDatabaseService.saveGroupMessage).not.toHaveBeenCalled();
        });

        test('should handle media messages with attachment processing', async () => {
            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'media-msg-id',
                            remoteJid: 'group123@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            imageMessage: {
                                url: 'https://example.com/encrypted-image.jpg',
                                mediaKey: 'media-key-123',
                                mimetype: 'image/jpeg',
                                caption: 'Test image',
                                fileLength: 1024,
                                fileSha256: 'test-hash'
                            }
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000),
                        pushName: 'Media User'
                    }]
                }
            };

            mockDatabaseService.saveGroupMessage.mockResolvedValue({
                success: true,
                messageId: 'media-msg-id',
                postBankId: 2,
                groupId: 'group123@g.us',
                hasMedia: true
            });

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            expect(response.status).toBe(200);

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify message was processed with media information
            expect(mockDatabaseService.saveGroupMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    key: expect.objectContaining({
                        id: 'media-msg-id'
                    }),
                    message: expect.objectContaining({
                        imageMessage: expect.any(Object)
                    })
                }),
                expect.any(Object),
                expect.any(Object)
            );
        });

        test('should handle duplicate messages correctly', async () => {
            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'duplicate-msg-id',
                            remoteJid: 'group123@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            conversation: 'Duplicate message test'
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000)
                    }]
                }
            };

            mockDatabaseService.saveGroupMessage.mockResolvedValue({
                success: true,
                messageId: 'duplicate-msg-id',
                postBankId: 3,
                groupId: 'group123@g.us'
            });

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            // Send first webhook
            const response1 = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            expect(response1.status).toBe(200);

            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Send duplicate webhook
            const response2 = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            expect(response2.status).toBe(200);

            // Wait for processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Database should only be called once (first message)
            expect(mockDatabaseService.saveGroupMessage).toHaveBeenCalledTimes(1);
        });
    });

    describe('Session Event Processing', () => {
        test('should process session status events', async () => {
            const webhookPayload = {
                event: 'session.status',
                data: {
                    sessionId: 'test-session-123',
                    status: 'connected',
                    timestamp: new Date().toISOString()
                }
            };

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            expect(response.status).toBe(200);

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify session manager was called
            expect(mockSessionManager.handleSessionEvents).toHaveBeenCalledWith({
                type: 'session.status',
                data: webhookPayload.data,
                metadata: expect.any(Object)
            });
        });

        test('should process QR code update events', async () => {
            const webhookPayload = {
                event: 'qrcode.updated',
                data: {
                    sessionId: 'test-session-123',
                    qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
                    timestamp: new Date().toISOString()
                }
            };

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            expect(response.status).toBe(200);

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Verify session manager was called
            expect(mockSessionManager.handleSessionEvents).toHaveBeenCalledWith({
                type: 'qrcode.updated',
                data: webhookPayload.data,
                metadata: expect.any(Object)
            });
        });
    });

    describe('Error Handling and Security', () => {
        test('should reject webhooks with invalid signatures', async () => {
            const webhookPayload = {
                event: 'messages.upsert',
                data: { messages: [] }
            };

            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', 'invalid-signature')
                .send(webhookPayload);

            expect(response.status).toBe(401);
            expect(response.body.error).toContain('Unauthorized');
        });

        test('should reject webhooks with missing signatures', async () => {
            const webhookPayload = {
                event: 'messages.upsert',
                data: { messages: [] }
            };

            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .send(webhookPayload);

            expect(response.status).toBe(401);
        });

        test('should reject non-JSON content', async () => {
            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'text/plain')
                .send('not json');

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Invalid content type');
        });

        test('should handle database errors gracefully', async () => {
            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'error-msg-id',
                            remoteJid: 'group123@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            conversation: 'Message that will cause DB error'
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000)
                    }]
                }
            };

            // Mock database error
            mockDatabaseService.saveGroupMessage.mockRejectedValue(new Error('Database connection failed'));

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            // Webhook should still return 200 (immediate response)
            expect(response.status).toBe(200);

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 100));

            // Database operation should have been attempted
            expect(mockDatabaseService.saveGroupMessage).toHaveBeenCalled();
        });
    });

    describe('Performance and Load', () => {
        test('should handle multiple concurrent webhooks', async () => {
            const webhookPromises = [];
            
            for (let i = 0; i < 5; i++) {
                const webhookPayload = {
                    event: 'messages.upsert',
                    data: {
                        messages: [{
                            key: {
                                id: `concurrent-msg-${i}`,
                                remoteJid: 'group123@g.us',
                                participant: '1234567890@s.whatsapp.net'
                            },
                            message: {
                                conversation: `Concurrent message ${i}`
                            },
                            messageTimestamp: Math.floor(Date.now() / 1000)
                        }]
                    }
                };

                mockDatabaseService.saveGroupMessage.mockResolvedValue({
                    success: true,
                    messageId: `concurrent-msg-${i}`,
                    postBankId: i + 1,
                    groupId: 'group123@g.us'
                });

                const payloadString = JSON.stringify(webhookPayload);
                const signature = crypto
                    .createHmac('sha256', 'test-webhook-secret')
                    .update(payloadString, 'utf8')
                    .digest('hex');

                const promise = request(app)
                    .post('/webhook/wasender')
                    .set('Content-Type', 'application/json')
                    .set('X-Webhook-Signature', signature)
                    .send(webhookPayload);

                webhookPromises.push(promise);
            }

            // Wait for all webhooks to complete
            const responses = await Promise.all(webhookPromises);

            // All should return 200
            responses.forEach(response => {
                expect(response.status).toBe(200);
            });

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 200));

            // All messages should have been processed
            expect(mockDatabaseService.saveGroupMessage).toHaveBeenCalledTimes(5);
        });

        test('should process large webhook payloads efficiently', async () => {
            const largeMessage = 'A'.repeat(1000); // 1KB message
            
            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'large-msg-id',
                            remoteJid: 'group123@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            conversation: largeMessage
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000)
                    }]
                }
            };

            mockDatabaseService.saveGroupMessage.mockResolvedValue({
                success: true,
                messageId: 'large-msg-id',
                postBankId: 1,
                groupId: 'group123@g.us'
            });

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const startTime = Date.now();
            
            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            const responseTime = Date.now() - startTime;

            expect(response.status).toBe(200);
            expect(responseTime).toBeLessThan(1000); // Should respond within 1 second

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 100));

            expect(mockDatabaseService.saveGroupMessage).toHaveBeenCalled();
        });
    });
});