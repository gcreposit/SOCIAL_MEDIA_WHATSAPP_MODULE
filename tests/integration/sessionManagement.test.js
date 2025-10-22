/**
 * Session Management Integration Tests
 * Tests session management and reconnection scenarios with Wasender API
 */

const SessionManager = require('../../src/services/wasender/sessionManager');
const WasenderClient = require('../../src/services/wasender/wasenderClient');
const WebhookHandler = require('../../src/services/wasender/webhookHandler');

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

jest.mock('../../src/services/wasender/wasenderClient');
jest.mock('../../src/services/wasender/groupMessageMonitor');
jest.mock('../../src/config/wasenderConfig', () => ({
    security: {
        rateLimiting: {
            windowMs: 15 * 60 * 1000,
            max: 1000,
            message: 'Too many webhook requests'
        }
    }
}));

describe('Session Management Integration Tests', () => {
    let sessionManager;
    let webhookHandler;
    let mockWasenderClient;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        jest.useFakeTimers();
        
        // Set up environment variables
        process.env.WASENDER_SESSION_NAME = 'test_session';
        process.env.WASENDER_PHONE_NUMBER = '+1234567890';
        process.env.WASENDER_WEBHOOK_SECRET = 'test-secret';
        
        // Mock WasenderClient
        mockWasenderClient = {
            createSession: jest.fn(),
            getQRCode: jest.fn(),
            getSessionStatus: jest.fn(),
            connectSession: jest.fn(),
            disconnectSession: jest.fn()
        };
        
        WasenderClient.mockImplementation(() => mockWasenderClient);
        
        // Create instances
        sessionManager = new SessionManager();
        webhookHandler = new WebhookHandler(sessionManager);
    });

    afterEach(() => {
        jest.useRealTimers();
        delete process.env.WASENDER_SESSION_NAME;
        delete process.env.WASENDER_PHONE_NUMBER;
        delete process.env.WASENDER_WEBHOOK_SECRET;
    });

    describe('Session Creation and Authentication Flow', () => {
        test('should complete full session creation and authentication flow', async () => {
            // Step 1: Create session
            mockWasenderClient.createSession.mockResolvedValue({
                sessionId: 'test-session-123',
                sessionName: 'test_session',
                status: 'created'
            });

            const createResult = await sessionManager.createSession();
            
            expect(createResult.sessionId).toBe('test-session-123');
            expect(sessionManager.sessionId).toBe('test-session-123');
            expect(sessionManager.sessionStatus).toBe('created');

            // Step 2: Get QR code for authentication
            mockWasenderClient.getQRCode.mockResolvedValue({
                qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
                timestamp: new Date().toISOString()
            });

            const qrResult = await sessionManager.getQRCode();
            
            expect(qrResult.qrCode).toBeDefined();
            expect(qrResult.qrCode).toContain('data:image/png;base64');

            // Step 3: Simulate QR code scan and authentication via webhook
            const authSuccessEvent = {
                type: 'auth.success',
                data: {
                    sessionId: 'test-session-123',
                    user: {
                        id: '1234567890@s.whatsapp.net',
                        name: 'Test User'
                    },
                    timestamp: new Date().toISOString()
                }
            };

            await sessionManager.handleSessionEvents(authSuccessEvent);
            
            expect(sessionManager.sessionStatus).toBe('authenticated');

            // Step 4: Connect session
            mockWasenderClient.connectSession.mockResolvedValue({
                success: true,
                message: 'Session connected successfully'
            });

            const connectResult = await sessionManager.connectSession();
            
            expect(connectResult.success).toBe(true);
            expect(sessionManager.sessionStatus).toBe('connecting');

            // Step 5: Simulate connection success via webhook
            const connectionUpdateEvent = {
                type: 'connection.update',
                data: {
                    sessionId: 'test-session-123',
                    connection: 'open',
                    timestamp: new Date().toISOString()
                }
            };

            await sessionManager.handleSessionEvents(connectionUpdateEvent);
            
            expect(sessionManager.sessionStatus).toBe('connected');
            expect(sessionManager.lastSuccessfulConnection).toBeInstanceOf(Date);
        });

        test('should handle authentication failure and retry', async () => {
            // Create session
            mockWasenderClient.createSession.mockResolvedValue({
                sessionId: 'auth-fail-session',
                sessionName: 'test_session'
            });

            await sessionManager.createSession();

            // Simulate authentication failure
            const authFailureEvent = {
                type: 'auth.failure',
                data: {
                    sessionId: 'auth-fail-session',
                    reason: 'QR_CODE_EXPIRED',
                    timestamp: new Date().toISOString()
                }
            };

            await sessionManager.handleSessionEvents(authFailureEvent);
            
            expect(sessionManager.sessionStatus).toBe('auth_failed');
            expect(sessionManager.connectionFailures).toBe(1);

            // Should trigger reconnection attempt
            expect(sessionManager.reconnectTimer).toBeDefined();

            // Simulate successful retry
            mockWasenderClient.getQRCode.mockResolvedValue({
                qrCode: 'data:image/png;base64,newQRCode...'
            });

            // Fast-forward timer to trigger reconnection
            jest.advanceTimersByTime(5000);

            // Verify reconnection was attempted
            expect(sessionManager.reconnectAttempts).toBe(1);
        });
    });

    describe('Session Status Monitoring', () => {
        beforeEach(async () => {
            // Set up connected session
            mockWasenderClient.createSession.mockResolvedValue({
                sessionId: 'monitor-session-123',
                sessionName: 'test_session'
            });

            await sessionManager.createSession();
            sessionManager.sessionStatus = 'connected';
            sessionManager.lastSuccessfulConnection = new Date();
        });

        test('should monitor session status and detect disconnection', async () => {
            // Start status monitoring
            sessionManager.startStatusMonitoring();
            
            expect(sessionManager.isStatusMonitoring).toBe(true);

            // Mock status check returning disconnected
            mockWasenderClient.getSessionStatus.mockResolvedValue({
                status: 'disconnected',
                timestamp: new Date().toISOString()
            });

            // Trigger status check
            jest.advanceTimersByTime(30000); // Default status check interval

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(sessionManager.sessionStatus).toBe('disconnected');
            expect(sessionManager.reconnectTimer).toBeDefined();
        });

        test('should handle session status check failures', async () => {
            sessionManager.startStatusMonitoring();

            // Mock status check failure
            mockWasenderClient.getSessionStatus.mockRejectedValue(
                new Error('API connection failed')
            );

            // Trigger status check
            jest.advanceTimersByTime(30000);

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(sessionManager.consecutiveFailures).toBe(1);
            expect(sessionManager.sessionStatus).toBe('disconnected');
        });

        test('should stop monitoring when session is disconnected manually', async () => {
            sessionManager.startStatusMonitoring();
            
            expect(sessionManager.isStatusMonitoring).toBe(true);

            // Disconnect session
            mockWasenderClient.disconnectSession.mockResolvedValue({
                success: true,
                message: 'Session disconnected'
            });

            await sessionManager.disconnectSession();

            expect(sessionManager.isStatusMonitoring).toBe(false);
            expect(sessionManager.sessionStatus).toBe('disconnected');
        });
    });

    describe('Automatic Reconnection Logic', () => {
        beforeEach(async () => {
            mockWasenderClient.createSession.mockResolvedValue({
                sessionId: 'reconnect-session-123',
                sessionName: 'test_session'
            });

            await sessionManager.createSession();
            sessionManager.sessionStatus = 'connected';
        });

        test('should attempt automatic reconnection on disconnection', async () => {
            // Simulate disconnection event
            const disconnectionEvent = {
                type: 'connection.update',
                data: {
                    sessionId: 'reconnect-session-123',
                    connection: 'close',
                    lastDisconnect: {
                        error: {
                            output: {
                                statusCode: 428,
                                payload: {
                                    error: 'Connection Lost'
                                }
                            }
                        }
                    }
                }
            };

            await sessionManager.handleSessionEvents(disconnectionEvent);

            expect(sessionManager.sessionStatus).toBe('disconnected');
            expect(sessionManager.reconnectTimer).toBeDefined();
            expect(sessionManager.reconnectAttempts).toBe(0); // Not incremented until actual attempt

            // Mock successful reconnection
            mockWasenderClient.connectSession.mockResolvedValue({
                success: true,
                message: 'Reconnected successfully'
            });

            // Trigger reconnection attempt
            jest.advanceTimersByTime(5000); // Base reconnection delay

            await new Promise(resolve => setTimeout(resolve, 100));

            expect(sessionManager.reconnectAttempts).toBe(1);
            expect(mockWasenderClient.connectSession).toHaveBeenCalled();
        });

        test('should use exponential backoff for reconnection attempts', async () => {
            sessionManager.sessionStatus = 'disconnected';
            
            // First attempt - 5 seconds
            sessionManager.reconnectAttempts = 0;
            let delay = sessionManager.calculateReconnectDelay();
            expect(delay).toBe(5000);

            // Second attempt - 10 seconds
            sessionManager.reconnectAttempts = 1;
            delay = sessionManager.calculateReconnectDelay();
            expect(delay).toBe(10000);

            // Third attempt - 20 seconds
            sessionManager.reconnectAttempts = 2;
            delay = sessionManager.calculateReconnectDelay();
            expect(delay).toBe(20000);

            // Should not exceed maximum delay
            sessionManager.reconnectAttempts = 10;
            delay = sessionManager.calculateReconnectDelay();
            expect(delay).toBeLessThanOrEqual(sessionManager.maxReconnectDelay);
        });

        test('should stop reconnection attempts after max attempts reached', async () => {
            sessionManager.sessionStatus = 'disconnected';
            sessionManager.reconnectAttempts = sessionManager.maxReconnectAttempts;

            const maxAttemptsReachedSpy = jest.fn();
            sessionManager.on('maxReconnectAttemptsReached', maxAttemptsReachedSpy);

            sessionManager.scheduleReconnection();

            expect(sessionManager.reconnectTimer).toBeNull();
            expect(maxAttemptsReachedSpy).toHaveBeenCalled();
        });

        test('should reset reconnection attempts on successful connection', async () => {
            sessionManager.reconnectAttempts = 3;
            sessionManager.connectionFailures = 2;

            // Simulate successful connection
            const connectionEvent = {
                type: 'connection.update',
                data: {
                    sessionId: 'reconnect-session-123',
                    connection: 'open'
                }
            };

            await sessionManager.handleSessionEvents(connectionEvent);

            expect(sessionManager.reconnectAttempts).toBe(0);
            expect(sessionManager.connectionFailures).toBe(0);
            expect(sessionManager.sessionStatus).toBe('connected');
        });
    });

    describe('Webhook Integration with Session Events', () => {
        test('should process session events through webhook handler', async () => {
            const sessionStatusEvent = {
                event: 'session.status',
                data: {
                    sessionId: 'webhook-session-123',
                    status: 'connecting',
                    timestamp: new Date().toISOString()
                }
            };

            // Process through webhook handler
            await webhookHandler.handleSessionStatus(sessionStatusEvent.data);

            // Verify session manager received the event
            expect(sessionManager.sessionStatus).toBe('connecting');
        });

        test('should handle QR code updates through webhooks', async () => {
            const qrUpdateEvent = {
                event: 'qrcode.updated',
                data: {
                    sessionId: 'webhook-session-123',
                    qrCode: 'data:image/png;base64,updatedQR...',
                    timestamp: new Date().toISOString()
                }
            };

            const qrUpdatedSpy = jest.fn();
            sessionManager.on('qrCodeUpdated', qrUpdatedSpy);

            await webhookHandler.handleQRCodeUpdate(qrUpdateEvent.data);

            expect(qrUpdatedSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    qrCode: 'data:image/png;base64,updatedQR...'
                })
            );
        });

        test('should handle connection updates through webhooks', async () => {
            const connectionUpdateEvent = {
                event: 'connection.update',
                data: {
                    sessionId: 'webhook-session-123',
                    connection: 'connecting',
                    qr: 'data:image/png;base64,connectionQR...'
                }
            };

            await webhookHandler.handleConnectionUpdate(connectionUpdateEvent.data);

            // Should update session status and emit QR if present
            expect(sessionManager.sessionStatus).toBe('connecting');
        });
    });

    describe('Session Health Monitoring', () => {
        beforeEach(async () => {
            mockWasenderClient.createSession.mockResolvedValue({
                sessionId: 'health-session-123',
                sessionName: 'test_session'
            });

            await sessionManager.createSession();
            sessionManager.sessionStatus = 'connected';
        });

        test('should track session health metrics', async () => {
            sessionManager.startHealthMonitoring();

            // Mock successful health checks
            mockWasenderClient.getSessionStatus.mockResolvedValue({
                status: 'connected',
                timestamp: new Date().toISOString()
            });

            // Trigger health checks
            jest.advanceTimersByTime(60000); // Health check interval
            await new Promise(resolve => setTimeout(resolve, 100));

            jest.advanceTimersByTime(60000);
            await new Promise(resolve => setTimeout(resolve, 100));

            const sessionInfo = sessionManager.getSessionInfo();
            
            expect(sessionInfo.health.totalStatusChecks).toBe(2);
            expect(sessionInfo.health.failedStatusChecks).toBe(0);
            expect(sessionInfo.health.healthScore).toBe(100);
        });

        test('should detect degraded session health', async () => {
            sessionManager.startHealthMonitoring();

            // Mock failing health checks
            mockWasenderClient.getSessionStatus
                .mockResolvedValueOnce({ status: 'connected' })
                .mockRejectedValueOnce(new Error('Health check failed'))
                .mockRejectedValueOnce(new Error('Health check failed'))
                .mockResolvedValueOnce({ status: 'connected' });

            // Trigger multiple health checks
            for (let i = 0; i < 4; i++) {
                jest.advanceTimersByTime(60000);
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const sessionInfo = sessionManager.getSessionInfo();
            
            expect(sessionInfo.health.totalStatusChecks).toBe(4);
            expect(sessionInfo.health.failedStatusChecks).toBe(2);
            expect(sessionInfo.health.healthScore).toBe(50); // 2 failures out of 4 checks
        });

        test('should trigger reconnection on consecutive health check failures', async () => {
            sessionManager.startHealthMonitoring();
            sessionManager.maxConsecutiveFailures = 3;

            // Mock consecutive failures
            mockWasenderClient.getSessionStatus.mockRejectedValue(
                new Error('Consecutive health check failure')
            );

            // Trigger enough failures to exceed threshold
            for (let i = 0; i < 4; i++) {
                jest.advanceTimersByTime(60000);
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            expect(sessionManager.consecutiveFailures).toBe(4);
            expect(sessionManager.sessionStatus).toBe('disconnected');
            expect(sessionManager.reconnectTimer).toBeDefined();
        });
    });

    describe('Session Cleanup and Resource Management', () => {
        test('should cleanup resources on session reset', async () => {
            // Set up session with various states
            mockWasenderClient.createSession.mockResolvedValue({
                sessionId: 'cleanup-session-123',
                sessionName: 'test_session'
            });

            await sessionManager.createSession();
            sessionManager.startStatusMonitoring();
            sessionManager.startHealthMonitoring();
            sessionManager.scheduleReconnection();

            expect(sessionManager.sessionId).toBe('cleanup-session-123');
            expect(sessionManager.isStatusMonitoring).toBe(true);
            expect(sessionManager.isHealthMonitoring).toBe(true);
            expect(sessionManager.reconnectTimer).toBeDefined();

            // Reset session
            await sessionManager.reset();

            expect(sessionManager.sessionId).toBeNull();
            expect(sessionManager.sessionStatus).toBe('disconnected');
            expect(sessionManager.isStatusMonitoring).toBe(false);
            expect(sessionManager.isHealthMonitoring).toBe(false);
            expect(sessionManager.reconnectTimer).toBeNull();
        });

        test('should cleanup resources on session manager destruction', async () => {
            mockWasenderClient.createSession.mockResolvedValue({
                sessionId: 'destroy-session-123',
                sessionName: 'test_session'
            });

            await sessionManager.createSession();
            sessionManager.sessionStatus = 'connected';
            sessionManager.startStatusMonitoring();

            mockWasenderClient.disconnectSession.mockResolvedValue({
                success: true,
                message: 'Session disconnected'
            });

            await sessionManager.cleanup();

            expect(mockWasenderClient.disconnectSession).toHaveBeenCalledWith('destroy-session-123');
            expect(sessionManager.isStatusMonitoring).toBe(false);
        });
    });

    describe('Error Recovery and Resilience', () => {
        test('should recover from API errors during session operations', async () => {
            // Mock API error followed by success
            mockWasenderClient.createSession
                .mockRejectedValueOnce(new Error('API temporarily unavailable'))
                .mockResolvedValueOnce({
                    sessionId: 'recovery-session-123',
                    sessionName: 'test_session'
                });

            // First attempt should fail
            await expect(sessionManager.createSession()).rejects.toThrow('API temporarily unavailable');
            expect(sessionManager.connectionFailures).toBe(1);

            // Second attempt should succeed
            const result = await sessionManager.createSession();
            expect(result.sessionId).toBe('recovery-session-123');
            expect(sessionManager.reconnectAttempts).toBe(0); // Reset on success
        });

        test('should handle malformed webhook events gracefully', async () => {
            const malformedEvents = [
                { type: 'session.status', data: null },
                { type: 'connection.update', data: { sessionId: null } },
                { type: 'qrcode.updated', data: { qrCode: '' } },
                null,
                undefined,
                { type: 'unknown.event', data: {} }
            ];

            for (const event of malformedEvents) {
                // Should not throw errors
                await expect(sessionManager.handleSessionEvents(event)).resolves.toBeUndefined();
            }

            // Session should remain in stable state
            expect(sessionManager.sessionStatus).toBe('disconnected');
        });
    });
});