/**
 * WebhookHandler Tests
 * Tests for webhook signature verification, security checks, and event processing
 */

const crypto = require('crypto');
const WebhookHandler = require('../../../src/services/wasender/webhookHandler');
const GroupMessageMonitor = require('../../../src/services/wasender/groupMessageMonitor');

// Mock dependencies
jest.mock('../../../src/services/loggingService', () => ({
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

jest.mock('../../../src/config/wasenderConfig', () => ({
    security: {
        rateLimiting: {
            windowMs: 15 * 60 * 1000,
            max: 1000,
            message: 'Too many webhook requests'
        }
    }
}));

jest.mock('../../../src/services/wasender/groupMessageMonitor');

describe('WebhookHandler', () => {
    let webhookHandler;
    let mockSessionManager;
    let mockGroupMessageMonitor;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Set up environment variables
        process.env.WASENDER_WEBHOOK_SECRET = 'test-webhook-secret';
        process.env.WEBHOOK_IP_WHITELIST = '127.0.0.1,192.168.1.1';
        
        // Mock SessionManager
        mockSessionManager = {
            handleSessionEvents: jest.fn()
        };
        
        // Mock GroupMessageMonitor
        mockGroupMessageMonitor = {
            processMessage: jest.fn(),
            getMetrics: jest.fn().mockReturnValue({
                totalMessagesReceived: 0,
                groupMessagesProcessed: 0
            }),
            healthCheck: jest.fn().mockReturnValue({
                status: 'healthy',
                timestamp: new Date().toISOString()
            })
        };
        
        GroupMessageMonitor.mockImplementation(() => mockGroupMessageMonitor);
        
        // Create WebhookHandler instance
        webhookHandler = new WebhookHandler(mockSessionManager);
    });

    afterEach(() => {
        // Clean up environment variables
        delete process.env.WASENDER_WEBHOOK_SECRET;
        delete process.env.WEBHOOK_IP_WHITELIST;
    });

    describe('Constructor', () => {
        test('should initialize with default values', () => {
            expect(webhookHandler.webhookSecret).toBe('test-webhook-secret');
            expect(webhookHandler.sessionManager).toBe(mockSessionManager);
            expect(webhookHandler.groupMessageMonitor).toBeDefined();
            expect(webhookHandler.metrics.totalRequests).toBe(0);
        });

        test('should initialize without session manager', () => {
            const handler = new WebhookHandler();
            expect(handler.sessionManager).toBeNull();
        });
    });

    describe('Signature Verification', () => {
        test('should verify valid HMAC-SHA256 signature', () => {
            const payload = JSON.stringify({ test: 'data' });
            const secret = 'test-webhook-secret'; // Use the actual secret from environment
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(payload, 'utf8')
                .digest('hex');

            // Test with raw signature
            const isValid = webhookHandler.verifySignature(payload, expectedSignature);
            expect(isValid).toBe(true);
        });

        test('should verify signature with sha256= prefix', () => {
            const payload = JSON.stringify({ test: 'data' });
            const secret = 'test-webhook-secret'; // Use the actual secret from environment
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(payload, 'utf8')
                .digest('hex');

            // Test with sha256= prefix
            const isValid = webhookHandler.verifySignature(payload, `sha256=${expectedSignature}`);
            expect(isValid).toBe(true);
        });

        test('should reject invalid signature', () => {
            const payload = JSON.stringify({ test: 'data' });
            const invalidSignature = 'invalid-signature';

            const isValid = webhookHandler.verifySignature(payload, invalidSignature);
            expect(isValid).toBe(false);
        });

        test('should reject missing signature', () => {
            const payload = JSON.stringify({ test: 'data' });

            const isValid = webhookHandler.verifySignature(payload, null);
            expect(isValid).toBe(false);
        });

        test('should reject when webhook secret is missing', () => {
            const originalSecret = webhookHandler.webhookSecret;
            webhookHandler.webhookSecret = null;

            const payload = JSON.stringify({ test: 'data' });
            const signature = 'some-signature';

            const isValid = webhookHandler.verifySignature(payload, signature);
            expect(isValid).toBe(false);

            // Restore original secret
            webhookHandler.webhookSecret = originalSecret;
        });

        test('should handle signature verification errors gracefully', () => {
            const payload = JSON.stringify({ test: 'data' });
            const malformedSignature = 'not-hex-string';

            const isValid = webhookHandler.verifySignature(payload, malformedSignature);
            expect(isValid).toBe(false);
        });
    });

    describe('Security Checks', () => {
        let mockReq;

        beforeEach(() => {
            mockReq = {
                is: jest.fn().mockReturnValue(true),
                get: jest.fn(),
                body: { test: 'data' },
                rawBody: Buffer.from(JSON.stringify({ test: 'data' })),
                headers: {
                    'x-webhook-signature': 'valid-signature'
                },
                ip: '127.0.0.1'
            };

            // Mock verifySignature to return true by default
            jest.spyOn(webhookHandler, 'verifySignature').mockReturnValue(true);
        });

        test('should pass valid security checks', () => {
            const result = webhookHandler.performSecurityChecks(mockReq);
            expect(result.valid).toBe(true);
        });

        test('should reject invalid content type', () => {
            mockReq.is.mockReturnValue(false);
            mockReq.get.mockReturnValue('text/plain');

            const result = webhookHandler.performSecurityChecks(mockReq);
            expect(result.valid).toBe(false);
            expect(result.statusCode).toBe(400);
            expect(result.message).toContain('Invalid content type');
        });

        test('should reject payload that is too large', () => {
            // Create a large payload
            const largePayload = { data: 'x'.repeat(2 * 1024 * 1024) }; // 2MB
            mockReq.body = largePayload;

            const result = webhookHandler.performSecurityChecks(mockReq);
            expect(result.valid).toBe(false);
            expect(result.statusCode).toBe(413);
            expect(result.message).toContain('Payload too large');
        });

        test('should reject invalid signature', () => {
            jest.spyOn(webhookHandler, 'verifySignature').mockReturnValue(false);

            const result = webhookHandler.performSecurityChecks(mockReq);
            expect(result.valid).toBe(false);
            expect(result.statusCode).toBe(401);
            expect(result.message).toContain('Unauthorized');
        });
    });

    describe('IP Whitelist', () => {
        test('should identify whitelisted IPs correctly', () => {
            expect(webhookHandler.isWhitelistedIP('127.0.0.1')).toBe(true);
            expect(webhookHandler.isWhitelistedIP('192.168.1.1')).toBe(true);
            expect(webhookHandler.isWhitelistedIP('10.0.0.1')).toBe(false);
        });

        test('should handle empty whitelist', () => {
            // Clear the environment variable to test empty whitelist
            delete process.env.WEBHOOK_IP_WHITELIST;
            const handler = new WebhookHandler();
            expect(handler.isWhitelistedIP('127.0.0.1')).toBe(false);
            // Restore the environment variable
            process.env.WEBHOOK_IP_WHITELIST = '127.0.0.1,192.168.1.1';
        });
    });

    describe('Event Processing', () => {
        test('should process messages.upsert event', async () => {
            const eventData = {
                messages: [
                    {
                        key: { id: 'msg1', remoteJid: 'group@g.us' },
                        message: { conversation: 'Test message' },
                        messageTimestamp: Date.now() / 1000
                    }
                ]
            };

            mockGroupMessageMonitor.processMessage.mockResolvedValue({
                success: true,
                messageId: 'msg1'
            });

            await webhookHandler.handleMessageUpsert(eventData);

            expect(mockGroupMessageMonitor.processMessage).toHaveBeenCalledWith(
                eventData.messages[0],
                expect.any(Object)
            );
        });

        test('should handle invalid message upsert data', async () => {
            const eventData = null;

            await webhookHandler.handleMessageUpsert(eventData);

            expect(mockGroupMessageMonitor.processMessage).not.toHaveBeenCalled();
        });

        test('should process session status events', async () => {
            const eventData = {
                sessionId: 'test-session',
                status: 'connected',
                timestamp: new Date().toISOString()
            };

            await webhookHandler.handleSessionStatus(eventData);

            expect(mockSessionManager.handleSessionEvents).toHaveBeenCalledWith({
                type: 'session.status',
                data: eventData,
                metadata: expect.any(Object)
            });
        });

        test('should handle session status without session manager', async () => {
            const handler = new WebhookHandler();
            const eventData = {
                sessionId: 'test-session',
                status: 'connected'
            };

            // Should not throw error
            await expect(handler.handleSessionStatus(eventData)).resolves.toBeUndefined();
        });
    });

    describe('Media Content Detection', () => {
        test('should detect image message as media', () => {
            const message = {
                message: {
                    imageMessage: {
                        url: 'https://example.com/image.jpg',
                        caption: 'Test image'
                    }
                }
            };

            const hasMedia = webhookHandler.hasMediaContent(message);
            expect(hasMedia).toBe(true);
        });

        test('should detect video message as media', () => {
            const message = {
                message: {
                    videoMessage: {
                        url: 'https://example.com/video.mp4'
                    }
                }
            };

            const hasMedia = webhookHandler.hasMediaContent(message);
            expect(hasMedia).toBe(true);
        });

        test('should not detect text message as media', () => {
            const message = {
                message: {
                    conversation: 'Just text'
                }
            };

            const hasMedia = webhookHandler.hasMediaContent(message);
            expect(hasMedia).toBe(false);
        });

        test('should handle message without content', () => {
            const message = {};

            const hasMedia = webhookHandler.hasMediaContent(message);
            expect(hasMedia).toBe(false);
        });
    });

    describe('Request ID Generation', () => {
        test('should generate unique request IDs', () => {
            const id1 = webhookHandler.generateRequestId();
            const id2 = webhookHandler.generateRequestId();

            expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
            expect(id2).toMatch(/^req_\d+_[a-z0-9]+$/);
            expect(id1).not.toBe(id2);
        });
    });

    describe('Metrics', () => {
        test('should track request metrics', () => {
            const initialMetrics = webhookHandler.getMetrics();
            expect(initialMetrics.webhook.totalRequests).toBe(0);
            expect(initialMetrics.webhook.successfulRequests).toBe(0);
            expect(initialMetrics.webhook.failedRequests).toBe(0);
        });

        test('should reset metrics', () => {
            webhookHandler.metrics.totalRequests = 10;
            webhookHandler.metrics.successfulRequests = 8;
            webhookHandler.metrics.failedRequests = 2;

            webhookHandler.resetMetrics();

            expect(webhookHandler.metrics.totalRequests).toBe(0);
            expect(webhookHandler.metrics.successfulRequests).toBe(0);
            expect(webhookHandler.metrics.failedRequests).toBe(0);
        });
    });

    describe('Health Check', () => {
        test('should return healthy status', () => {
            const mockReq = {};
            const mockRes = {
                status: jest.fn().mockReturnThis(),
                json: jest.fn()
            };

            webhookHandler.healthCheck(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'healthy',
                    timestamp: expect.any(String),
                    metrics: expect.any(Object),
                    services: expect.any(Object)
                })
            );
        });
    });

    describe('Webhook Data Processing', () => {
        test('should route events to correct handlers', async () => {
            const testEvents = [
                { event: 'messages.upsert', data: { messages: [] } },
                { event: 'session.status', data: { sessionId: 'test', status: 'connected' } },
                { event: 'qrcode.updated', data: { sessionId: 'test', qrCode: 'data:image/png;base64,abc' } }
            ];

            // Spy on handler methods
            const handleMessageUpsertSpy = jest.spyOn(webhookHandler, 'handleMessageUpsert').mockResolvedValue();
            const handleSessionStatusSpy = jest.spyOn(webhookHandler, 'handleSessionStatus').mockResolvedValue();
            const handleQRCodeUpdateSpy = jest.spyOn(webhookHandler, 'handleQRCodeUpdate').mockResolvedValue();

            for (const eventData of testEvents) {
                await webhookHandler.processWebhookData(eventData);
            }

            expect(handleMessageUpsertSpy).toHaveBeenCalledWith(testEvents[0].data, expect.any(Object));
            expect(handleSessionStatusSpy).toHaveBeenCalledWith(testEvents[1].data, expect.any(Object));
            expect(handleQRCodeUpdateSpy).toHaveBeenCalledWith(testEvents[2].data, expect.any(Object));
        });

        test('should handle unknown event types gracefully', async () => {
            const unknownEvent = {
                event: 'unknown.event',
                data: { test: 'data' }
            };

            // Should not throw error
            await expect(webhookHandler.processWebhookData(unknownEvent)).resolves.toBeUndefined();
        });

        test('should handle invalid webhook data structure', async () => {
            const invalidData = null;

            // Should not throw error
            await expect(webhookHandler.processWebhookData(invalidData)).resolves.toBeUndefined();
        });
    });
});