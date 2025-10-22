/**
 * SessionManager Tests
 * Tests for the SessionManager service functionality
 */

const SessionManager = require('../../../src/services/wasender/sessionManager');
const WasenderClient = require('../../../src/services/wasender/wasenderClient');

// Mock the WasenderClient
jest.mock('../../../src/services/wasender/wasenderClient');
jest.mock('../../../src/services/loggingService', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
}));

describe('SessionManager', () => {
    let sessionManager;
    let mockWasenderClient;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Mock environment variables first
        process.env.WASENDER_SESSION_NAME = 'test_session';
        process.env.WASENDER_PHONE_NUMBER = '+1234567890';
        
        // Create mock WasenderClient instance
        mockWasenderClient = {
            createSession: jest.fn(),
            getQRCode: jest.fn(),
            getSessionStatus: jest.fn(),
            connectSession: jest.fn(),
            disconnectSession: jest.fn()
        };
        
        WasenderClient.mockImplementation(() => mockWasenderClient);
        
        // Create new SessionManager instance
        sessionManager = new SessionManager();
    });

    afterEach(async () => {
        // Cleanup session manager
        if (sessionManager) {
            await sessionManager.cleanup();
        }
        
        // Clear timers
        jest.clearAllTimers();
    });

    describe('Constructor', () => {
        test('should initialize with default values', () => {
            expect(sessionManager.sessionId).toBeNull();
            expect(sessionManager.sessionStatus).toBe('disconnected');
            expect(sessionManager.sessionName).toBe('test_session');
            expect(sessionManager.reconnectAttempts).toBe(0);
            expect(sessionManager.maxReconnectAttempts).toBe(5);
        });

        test('should create WasenderClient instance', () => {
            expect(WasenderClient).toHaveBeenCalled();
            expect(sessionManager.wasenderClient).toBe(mockWasenderClient);
        });
    });

    describe('createSession', () => {
        test('should create session successfully', async () => {
            const mockResponse = {
                sessionId: 'test-session-123',
                sessionName: 'test_session'
            };
            
            mockWasenderClient.createSession.mockResolvedValue(mockResponse);
            
            const result = await sessionManager.createSession();
            
            expect(mockWasenderClient.createSession).toHaveBeenCalledWith('test_session', '+1234567890');
            expect(sessionManager.sessionId).toBe('test-session-123');
            expect(sessionManager.sessionStatus).toBe('created');
            expect(sessionManager.sessionCreatedAt).toBeInstanceOf(Date);
            expect(result).toEqual(mockResponse);
        });

        test('should handle session creation failure', async () => {
            const mockError = new Error('API Error');
            mockWasenderClient.createSession.mockRejectedValue(mockError);
            
            await expect(sessionManager.createSession()).rejects.toThrow('API Error');
            expect(sessionManager.connectionFailures).toBe(1);
        });

        test('should reset reconnect attempts on successful creation', async () => {
            sessionManager.reconnectAttempts = 3;
            
            const mockResponse = {
                sessionId: 'test-session-123',
                sessionName: 'test_session'
            };
            
            mockWasenderClient.createSession.mockResolvedValue(mockResponse);
            
            await sessionManager.createSession();
            
            expect(sessionManager.reconnectAttempts).toBe(0);
        });
    });

    describe('getQRCode', () => {
        beforeEach(() => {
            sessionManager.sessionId = 'test-session-123';
        });

        test('should get QR code successfully', async () => {
            const mockResponse = {
                qrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...'
            };
            
            mockWasenderClient.getQRCode.mockResolvedValue(mockResponse);
            
            const result = await sessionManager.getQRCode();
            
            expect(mockWasenderClient.getQRCode).toHaveBeenCalledWith('test-session-123');
            expect(result).toEqual(mockResponse);
        });

        test('should throw error when no session ID', async () => {
            sessionManager.sessionId = null;
            
            await expect(sessionManager.getQRCode()).rejects.toThrow('No active session ID available');
        });

        test('should handle QR code retrieval failure', async () => {
            const mockError = new Error('QR Code Error');
            mockWasenderClient.getQRCode.mockRejectedValue(mockError);
            
            await expect(sessionManager.getQRCode()).rejects.toThrow('QR Code Error');
        });
    });

    describe('getSessionStatus', () => {
        beforeEach(() => {
            sessionManager.sessionId = 'test-session-123';
        });

        test('should get session status successfully', async () => {
            const mockResponse = {
                status: 'connected',
                timestamp: new Date().toISOString()
            };
            
            mockWasenderClient.getSessionStatus.mockResolvedValue(mockResponse);
            
            const result = await sessionManager.getSessionStatus();
            
            expect(mockWasenderClient.getSessionStatus).toHaveBeenCalledWith('test-session-123');
            expect(sessionManager.sessionStatus).toBe('connected');
            expect(sessionManager.lastStatusCheck).toBeInstanceOf(Date);
            expect(result).toEqual(mockResponse);
        });

        test('should return no_session when no session ID', async () => {
            sessionManager.sessionId = null;
            
            const result = await sessionManager.getSessionStatus();
            
            expect(result).toEqual({
                status: 'no_session',
                message: 'No session ID available'
            });
        });

        test('should handle status check failure', async () => {
            const mockError = new Error('Status Error');
            mockWasenderClient.getSessionStatus.mockRejectedValue(mockError);
            
            const result = await sessionManager.getSessionStatus();
            
            expect(result).toEqual({
                status: 'error',
                error: 'Status Error'
            });
            expect(sessionManager.sessionStatus).toBe('disconnected');
        });
    });

    describe('connectSession', () => {
        beforeEach(() => {
            sessionManager.sessionId = 'test-session-123';
        });

        test('should connect session successfully', async () => {
            const mockResponse = {
                success: true,
                message: 'Session connected'
            };
            
            mockWasenderClient.connectSession.mockResolvedValue(mockResponse);
            
            const result = await sessionManager.connectSession();
            
            expect(mockWasenderClient.connectSession).toHaveBeenCalledWith('test-session-123');
            expect(sessionManager.sessionStatus).toBe('connecting');
            expect(sessionManager.reconnectAttempts).toBe(0);
            expect(result).toEqual(mockResponse);
        });

        test('should throw error when no session ID', async () => {
            sessionManager.sessionId = null;
            
            await expect(sessionManager.connectSession()).rejects.toThrow('No session ID available for connection');
        });

        test('should handle connection failure', async () => {
            const mockError = new Error('Connection Error');
            mockWasenderClient.connectSession.mockRejectedValue(mockError);
            
            await expect(sessionManager.connectSession()).rejects.toThrow('Connection Error');
            expect(sessionManager.connectionFailures).toBe(1);
        });
    });

    describe('disconnectSession', () => {
        beforeEach(() => {
            sessionManager.sessionId = 'test-session-123';
            sessionManager.sessionStatus = 'connected';
        });

        test('should disconnect session successfully', async () => {
            const mockResponse = {
                success: true,
                message: 'Session disconnected'
            };
            
            mockWasenderClient.disconnectSession.mockResolvedValue(mockResponse);
            
            const result = await sessionManager.disconnectSession();
            
            expect(mockWasenderClient.disconnectSession).toHaveBeenCalledWith('test-session-123');
            expect(sessionManager.sessionStatus).toBe('disconnected');
            expect(result).toEqual(mockResponse);
        });

        test('should handle no session ID gracefully', async () => {
            sessionManager.sessionId = null;
            
            const result = await sessionManager.disconnectSession();
            
            expect(result).toEqual({
                success: true,
                message: 'No active session to disconnect'
            });
        });

        test('should handle disconnection failure', async () => {
            const mockError = new Error('Disconnection Error');
            mockWasenderClient.disconnectSession.mockRejectedValue(mockError);
            
            await expect(sessionManager.disconnectSession()).rejects.toThrow('Disconnection Error');
        });
    });

    describe('Status Change Handling', () => {
        test('should handle status change from disconnected to connected', () => {
            const statusChangeSpy = jest.fn();
            sessionManager.on('statusChanged', statusChangeSpy);
            
            sessionManager.handleSessionStatusChange('disconnected', 'connected');
            
            expect(statusChangeSpy).toHaveBeenCalledWith({
                sessionId: sessionManager.sessionId,
                previousStatus: 'disconnected',
                newStatus: 'connected',
                timestamp: expect.any(Date)
            });
            
            expect(sessionManager.lastSuccessfulConnection).toBeInstanceOf(Date);
            expect(sessionManager.reconnectAttempts).toBe(0);
            expect(sessionManager.connectionFailures).toBe(0);
        });

        test('should schedule reconnection when status changes to disconnected', () => {
            jest.useFakeTimers();
            sessionManager.sessionId = 'test-session-123';
            
            const scheduleReconnectionSpy = jest.spyOn(sessionManager, 'scheduleReconnection');
            
            sessionManager.handleSessionStatusChange('connected', 'disconnected');
            
            expect(scheduleReconnectionSpy).toHaveBeenCalled();
            
            jest.useRealTimers();
        });
    });

    describe('Reconnection Logic', () => {
        test('should calculate reconnection delay with exponential backoff', () => {
            sessionManager.reconnectAttempts = 0;
            expect(sessionManager.calculateReconnectDelay()).toBe(5000); // Base delay
            
            sessionManager.reconnectAttempts = 1;
            expect(sessionManager.calculateReconnectDelay()).toBe(10000); // 2x base delay
            
            sessionManager.reconnectAttempts = 2;
            expect(sessionManager.calculateReconnectDelay()).toBe(20000); // 4x base delay
        });

        test('should not exceed maximum reconnection delay', () => {
            sessionManager.reconnectAttempts = 10; // High number
            const delay = sessionManager.calculateReconnectDelay();
            
            expect(delay).toBeLessThanOrEqual(sessionManager.maxReconnectDelay);
        });

        test('should not schedule reconnection if max attempts reached', () => {
            sessionManager.reconnectAttempts = sessionManager.maxReconnectAttempts;
            
            const maxAttemptsReachedSpy = jest.fn();
            sessionManager.on('maxReconnectAttemptsReached', maxAttemptsReachedSpy);
            
            sessionManager.scheduleReconnection();
            
            expect(sessionManager.reconnectTimer).toBeNull();
            expect(maxAttemptsReachedSpy).toHaveBeenCalled();
        });
    });

    describe('Session Information', () => {
        test('should return complete session information', () => {
            sessionManager.sessionId = 'test-session-123';
            sessionManager.sessionStatus = 'connected';
            sessionManager.sessionCreatedAt = new Date();
            sessionManager.lastSuccessfulConnection = new Date();
            sessionManager.reconnectAttempts = 2;
            sessionManager.connectionFailures = 1;
            
            const info = sessionManager.getSessionInfo();
            
            expect(info).toEqual({
                session: {
                    sessionId: 'test-session-123',
                    sessionName: 'test_session',
                    status: 'connected',
                    createdAt: expect.any(Date),
                    lastSuccessfulConnection: expect.any(Date),
                    lastStatusCheck: null,
                    uptime: expect.any(Number),
                    sessionUptime: expect.any(Number)
                },
                monitoring: {
                    isStatusMonitoring: false,
                    isHealthMonitoring: false,
                    statusCheckInterval: 30000,
                    healthCheckInterval: 60000
                },
                health: {
                    totalStatusChecks: 0,
                    failedStatusChecks: 0,
                    consecutiveFailures: 0,
                    lastHealthCheck: null,
                    healthScore: 100,
                    uptime: expect.any(Number)
                },
                performance: {
                    averageResponseTime: 0,
                    totalApiCalls: 0,
                    failedApiCalls: 0,
                    lastResponseTime: null
                },
                reconnection: {
                    attempts: 2,
                    maxAttempts: 5,
                    isScheduled: false,
                    connectionFailures: 1
                },
                notifications: {
                    enabled: false,
                    email: false,
                    webhook: false,
                    lastNotificationSent: null,
                    cooldownPeriod: 300000
                },
                events: {
                    recentEvents: expect.any(Array),
                    totalEvents: 0
                }
            });
        });
    });

    describe('Reset and Cleanup', () => {
        test('should reset session manager state', async () => {
            sessionManager.sessionId = 'test-session-123';
            sessionManager.sessionStatus = 'connected';
            sessionManager.sessionCreatedAt = new Date();
            sessionManager.reconnectAttempts = 3;
            
            const resetSpy = jest.fn();
            sessionManager.on('reset', resetSpy);
            
            await sessionManager.reset();
            
            expect(sessionManager.sessionId).toBeNull();
            expect(sessionManager.sessionStatus).toBe('disconnected');
            expect(sessionManager.sessionCreatedAt).toBeNull();
            expect(sessionManager.reconnectAttempts).toBe(0);
            expect(resetSpy).toHaveBeenCalled();
        });

        test('should cleanup resources properly', async () => {
            sessionManager.sessionId = 'test-session-123';
            sessionManager.sessionStatus = 'connected';
            
            mockWasenderClient.disconnectSession.mockResolvedValue({ success: true });
            
            await sessionManager.cleanup();
            
            expect(mockWasenderClient.disconnectSession).toHaveBeenCalledWith('test-session-123');
        });
    });
});