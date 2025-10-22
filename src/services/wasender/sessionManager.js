/**
 * Session Manager Service
 * Manages WhatsApp session via Wasender API with automatic reconnection logic
 */

const WasenderClient = require('./wasenderClient');
const logger = require('../loggingService');
const EventEmitter = require('events');

class SessionManager extends EventEmitter {
    constructor() {
        super();
        this.wasenderClient = new WasenderClient();
        this.sessionId = null;
        this.sessionStatus = 'disconnected';
        this.sessionName = process.env.WASENDER_SESSION_NAME || 'group_monitor_session';
        this.phoneNumber = process.env.WASENDER_PHONE_NUMBER || null;
        
        // Reconnection configuration
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 seconds base delay
        this.maxReconnectDelay = 300000; // 5 minutes max delay
        this.reconnectTimer = null;
        
        // Status monitoring configuration
        this.statusCheckInterval = 30000; // 30 seconds
        this.statusCheckTimer = null;
        this.lastStatusCheck = null;
        
        // Health monitoring configuration
        this.healthCheckInterval = 60000; // 1 minute
        this.healthCheckTimer = null;
        this.healthMetrics = {
            totalStatusChecks: 0,
            failedStatusChecks: 0,
            consecutiveFailures: 0,
            lastHealthCheck: null,
            healthScore: 100,
            uptime: null
        };
        
        // Session health tracking
        this.sessionCreatedAt = null;
        this.lastSuccessfulConnection = null;
        this.connectionFailures = 0;
        this.sessionUptime = null;
        
        // Administrator notification configuration
        this.notificationConfig = {
            enabled: process.env.ADMIN_NOTIFICATIONS_ENABLED === 'true',
            email: process.env.ADMIN_EMAIL || null,
            webhook: process.env.ADMIN_WEBHOOK_URL || null,
            cooldownPeriod: 300000, // 5 minutes between notifications
            lastNotificationSent: null,
            criticalThreshold: 3, // consecutive failures before critical alert
            warningThreshold: 2 // consecutive failures before warning alert
        };
        
        // Session event history for monitoring
        this.eventHistory = [];
        this.maxEventHistory = 100;
        
        // Performance tracking
        this.performanceMetrics = {
            averageResponseTime: 0,
            totalApiCalls: 0,
            failedApiCalls: 0,
            lastResponseTime: null
        };
        
        // Bind methods to preserve context
        this.handleSessionStatusChange = this.handleSessionStatusChange.bind(this);
        this.checkSessionHealth = this.checkSessionHealth.bind(this);
        this.performHealthCheck = this.performHealthCheck.bind(this);
        this.attemptReconnection = this.attemptReconnection.bind(this);
        this.sendAdminNotification = this.sendAdminNotification.bind(this);
    }

    /**
     * Initialize session manager
     */
    async initialize() {
        try {
            logger.info('Initializing Session Manager', { sessionName: this.sessionName });
            
            // Start status monitoring
            this.startStatusMonitoring();
            
            // Try to get existing session or create new one
            await this.initializeSession();
            
            logger.info('Session Manager initialized successfully');
            this.emit('initialized');
            
        } catch (error) {
            logger.error('Failed to initialize Session Manager', { error: error.message });
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Initialize or create session
     */
    async initializeSession() {
        try {
            // First, try to get existing session status
            if (this.sessionId) {
                const status = await this.getSessionStatus();
                if (status && status.status === 'connected') {
                    logger.info('Existing session is connected', { sessionId: this.sessionId });
                    this.sessionStatus = 'connected';
                    this.lastSuccessfulConnection = new Date();
                    return;
                }
            }
            
            // Create new session if none exists or existing is disconnected
            await this.createSession();
            
        } catch (error) {
            logger.error('Failed to initialize session', { error: error.message });
            // Schedule reconnection attempt
            this.scheduleReconnection();
            throw error;
        }
    }

    /**
     * Create a new WhatsApp session
     */
    async createSession(sessionName = this.sessionName, phoneNumber = this.phoneNumber) {
        try {
            logger.info('Creating new session', { sessionName, phoneNumber });
            
            const response = await this.wasenderClient.createSession(sessionName, phoneNumber);
            
            if (response && response.sessionId) {
                this.sessionId = response.sessionId;
                this.sessionStatus = 'created';
                this.sessionCreatedAt = new Date();
                this.reconnectAttempts = 0; // Reset reconnect attempts on successful creation
                
                logger.info('Session created successfully', { 
                    sessionId: this.sessionId,
                    sessionName 
                });
                
                this.emit('sessionCreated', {
                    sessionId: this.sessionId,
                    sessionName,
                    createdAt: this.sessionCreatedAt
                });
                
                return response;
            } else {
                throw new Error('Invalid response from session creation');
            }
            
        } catch (error) {
            logger.error('Failed to create session', { 
                sessionName, 
                error: error.message 
            });
            this.connectionFailures++;
            this.emit('sessionError', error);
            throw error;
        }
    }

    /**
     * Get QR code for session authentication
     */
    async getQRCode() {
        try {
            if (!this.sessionId) {
                throw new Error('No active session ID available');
            }
            
            logger.info('Retrieving QR code', { sessionId: this.sessionId });
            
            const response = await this.wasenderClient.getQRCode(this.sessionId);
            
            if (response && response.qrCode) {
                logger.info('QR code retrieved successfully', { sessionId: this.sessionId });
                
                this.emit('qrCodeReceived', {
                    sessionId: this.sessionId,
                    qrCode: response.qrCode,
                    timestamp: new Date()
                });
                
                return response;
            } else {
                throw new Error('Invalid QR code response');
            }
            
        } catch (error) {
            logger.error('Failed to get QR code', { 
                sessionId: this.sessionId, 
                error: error.message 
            });
            this.emit('qrCodeError', error);
            throw error;
        }
    }

    /**
     * Get session status
     */
    async getSessionStatus() {
        try {
            if (!this.sessionId) {
                return { status: 'no_session', message: 'No session ID available' };
            }
            
            const response = await this.wasenderClient.getSessionStatus(this.sessionId);
            this.lastStatusCheck = new Date();
            
            if (response && response.status) {
                const previousStatus = this.sessionStatus;
                this.sessionStatus = response.status;
                
                // Emit status change event if status changed
                if (previousStatus !== this.sessionStatus) {
                    this.handleSessionStatusChange(previousStatus, this.sessionStatus);
                }
                
                return response;
            } else {
                throw new Error('Invalid status response');
            }
            
        } catch (error) {
            logger.error('Failed to get session status', { 
                sessionId: this.sessionId, 
                error: error.message 
            });
            
            // Consider session as disconnected if we can't get status
            if (this.sessionStatus !== 'disconnected') {
                this.handleSessionStatusChange(this.sessionStatus, 'disconnected');
                this.sessionStatus = 'disconnected';
            }
            
            return { status: 'error', error: error.message };
        }
    }

    /**
     * Connect session
     */
    async connectSession() {
        try {
            if (!this.sessionId) {
                throw new Error('No session ID available for connection');
            }
            
            logger.info('Connecting session', { sessionId: this.sessionId });
            
            const response = await this.wasenderClient.connectSession(this.sessionId);
            
            if (response) {
                this.sessionStatus = 'connecting';
                this.reconnectAttempts = 0; // Reset on successful connection attempt
                
                logger.info('Session connection initiated', { sessionId: this.sessionId });
                
                this.emit('sessionConnecting', {
                    sessionId: this.sessionId,
                    timestamp: new Date()
                });
                
                return response;
            } else {
                throw new Error('Invalid connection response');
            }
            
        } catch (error) {
            logger.error('Failed to connect session', { 
                sessionId: this.sessionId, 
                error: error.message 
            });
            this.connectionFailures++;
            this.emit('connectionError', error);
            throw error;
        }
    }

    /**
     * Disconnect session
     */
    async disconnectSession() {
        try {
            if (!this.sessionId) {
                logger.warn('No session ID available for disconnection');
                return { success: true, message: 'No active session to disconnect' };
            }
            
            logger.info('Disconnecting session', { sessionId: this.sessionId });
            
            // Stop monitoring and reconnection attempts
            this.stopStatusMonitoring();
            this.stopReconnectionAttempts();
            
            const response = await this.wasenderClient.disconnectSession(this.sessionId);
            
            this.sessionStatus = 'disconnected';
            
            logger.info('Session disconnected successfully', { sessionId: this.sessionId });
            
            this.emit('sessionDisconnected', {
                sessionId: this.sessionId,
                timestamp: new Date()
            });
            
            return response;
            
        } catch (error) {
            logger.error('Failed to disconnect session', { 
                sessionId: this.sessionId, 
                error: error.message 
            });
            this.emit('disconnectionError', error);
            throw error;
        }
    }

    /**
     * Handle session status changes
     */
    handleSessionStatusChange(previousStatus, newStatus) {
        logger.info('Session status changed', { 
            sessionId: this.sessionId,
            previousStatus, 
            newStatus,
            timestamp: new Date()
        });
        
        this.emit('statusChanged', {
            sessionId: this.sessionId,
            previousStatus,
            newStatus,
            timestamp: new Date()
        });
        
        // Handle specific status transitions
        switch (newStatus) {
            case 'connected':
                this.lastSuccessfulConnection = new Date();
                this.reconnectAttempts = 0;
                this.connectionFailures = 0;
                this.stopReconnectionAttempts();
                this.emit('sessionConnected', {
                    sessionId: this.sessionId,
                    timestamp: this.lastSuccessfulConnection
                });
                break;
                
            case 'disconnected':
                if (previousStatus === 'connected') {
                    logger.warn('Session unexpectedly disconnected', { sessionId: this.sessionId });
                    this.scheduleReconnection();
                }
                break;
                
            case 'qr':
                this.emit('qrRequired', {
                    sessionId: this.sessionId,
                    timestamp: new Date()
                });
                break;
                
            case 'error':
                this.connectionFailures++;
                this.scheduleReconnection();
                break;
        }
    }

    /**
     * Start status monitoring
     */
    startStatusMonitoring() {
        if (this.statusCheckTimer) {
            clearInterval(this.statusCheckTimer);
        }
        
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        
        logger.info('Starting session status monitoring', { 
            statusInterval: this.statusCheckInterval,
            healthInterval: this.healthCheckInterval
        });
        
        // Start basic status monitoring
        this.statusCheckTimer = setInterval(this.checkSessionHealth, this.statusCheckInterval);
        
        // Start comprehensive health monitoring
        this.healthCheckTimer = setInterval(this.performHealthCheck, this.healthCheckInterval);
        
        // Initialize health metrics
        this.healthMetrics.uptime = Date.now();
        this.sessionUptime = Date.now();
    }

    /**
     * Stop status monitoring
     */
    stopStatusMonitoring() {
        if (this.statusCheckTimer) {
            clearInterval(this.statusCheckTimer);
            this.statusCheckTimer = null;
        }
        
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
        
        logger.info('Session status and health monitoring stopped');
    }

    /**
     * Check session health (basic status check)
     */
    async checkSessionHealth() {
        const startTime = Date.now();
        
        try {
            this.healthMetrics.totalStatusChecks++;
            
            const status = await this.getSessionStatus();
            const responseTime = Date.now() - startTime;
            
            // Update performance metrics
            this.updatePerformanceMetrics(responseTime, true);
            
            // Reset consecutive failures on success
            this.healthMetrics.consecutiveFailures = 0;
            
            logger.debug('Session health check successful', { 
                status: status.status,
                responseTime: `${responseTime}ms`,
                sessionId: this.sessionId
            });
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            
            this.healthMetrics.failedStatusChecks++;
            this.healthMetrics.consecutiveFailures++;
            
            // Update performance metrics
            this.updatePerformanceMetrics(responseTime, false);
            
            logger.error('Session health check failed', { 
                error: error.message,
                consecutiveFailures: this.healthMetrics.consecutiveFailures,
                responseTime: `${responseTime}ms`
            });
            
            // Check if we need to send admin notifications
            await this.checkNotificationThresholds();
            
            // If we can't check status, consider scheduling reconnection
            if (this.sessionStatus === 'connected') {
                this.scheduleReconnection();
            }
        }
    }

    /**
     * Schedule reconnection attempt
     */
    scheduleReconnection() {
        // Don't schedule if already scheduled or if we've exceeded max attempts
        if (this.reconnectTimer || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                logger.error('Maximum reconnection attempts reached', { 
                    attempts: this.reconnectAttempts,
                    maxAttempts: this.maxReconnectAttempts
                });
                this.emit('maxReconnectAttemptsReached', {
                    attempts: this.reconnectAttempts,
                    sessionId: this.sessionId
                });
            }
            return;
        }
        
        const delay = this.calculateReconnectDelay();
        
        logger.info('Scheduling reconnection attempt', { 
            attempt: this.reconnectAttempts + 1,
            delay,
            sessionId: this.sessionId
        });
        
        this.reconnectTimer = setTimeout(this.attemptReconnection, delay);
        
        this.emit('reconnectionScheduled', {
            attempt: this.reconnectAttempts + 1,
            delay,
            sessionId: this.sessionId
        });
    }

    /**
     * Calculate reconnection delay with exponential backoff
     */
    calculateReconnectDelay() {
        const exponentialDelay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
        return Math.min(exponentialDelay, this.maxReconnectDelay);
    }

    /**
     * Attempt reconnection
     */
    async attemptReconnection() {
        this.reconnectTimer = null;
        this.reconnectAttempts++;
        
        logger.info('Attempting reconnection', { 
            attempt: this.reconnectAttempts,
            sessionId: this.sessionId
        });
        
        try {
            // First check current status
            const status = await this.getSessionStatus();
            
            if (status.status === 'connected') {
                logger.info('Session already connected during reconnection attempt');
                return;
            }
            
            // If no session exists, create new one
            if (!this.sessionId || status.status === 'no_session') {
                await this.createSession();
            }
            
            // Try to connect
            await this.connectSession();
            
            logger.info('Reconnection attempt successful', { 
                attempt: this.reconnectAttempts,
                sessionId: this.sessionId
            });
            
        } catch (error) {
            logger.error('Reconnection attempt failed', { 
                attempt: this.reconnectAttempts,
                error: error.message,
                sessionId: this.sessionId
            });
            
            // Schedule next attempt if we haven't reached max attempts
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.scheduleReconnection();
            } else {
                logger.error('All reconnection attempts exhausted', {
                    totalAttempts: this.reconnectAttempts
                });
                this.emit('reconnectionFailed', {
                    totalAttempts: this.reconnectAttempts,
                    sessionId: this.sessionId
                });
            }
        }
    }

    /**
     * Stop reconnection attempts
     */
    stopReconnectionAttempts() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
            logger.info('Reconnection attempts stopped');
        }
    }

    /**
     * Perform comprehensive health check
     */
    async performHealthCheck() {
        const healthCheckStart = Date.now();
        
        try {
            this.healthMetrics.lastHealthCheck = new Date();
            
            // Calculate health score based on various metrics
            const healthScore = this.calculateHealthScore();
            this.healthMetrics.healthScore = healthScore;
            
            // Log health status
            const healthStatus = {
                sessionId: this.sessionId,
                status: this.sessionStatus,
                healthScore,
                uptime: this.getUptime(),
                sessionUptime: this.getSessionUptime(),
                consecutiveFailures: this.healthMetrics.consecutiveFailures,
                totalStatusChecks: this.healthMetrics.totalStatusChecks,
                failedStatusChecks: this.healthMetrics.failedStatusChecks,
                averageResponseTime: this.performanceMetrics.averageResponseTime,
                lastSuccessfulConnection: this.lastSuccessfulConnection
            };
            
            logger.info('Session health check completed', healthStatus);
            
            // Emit health check event
            this.emit('healthCheck', healthStatus);
            
            // Check if health score is critically low
            if (healthScore < 30) {
                await this.sendAdminNotification('critical', 
                    `Session health critically low: ${healthScore}%`, 
                    healthStatus
                );
            } else if (healthScore < 60) {
                await this.sendAdminNotification('warning', 
                    `Session health degraded: ${healthScore}%`, 
                    healthStatus
                );
            }
            
        } catch (error) {
            logger.error('Health check failed', { 
                error: error.message,
                duration: Date.now() - healthCheckStart
            });
        }
    }

    /**
     * Calculate health score based on various metrics
     */
    calculateHealthScore() {
        let score = 100;
        
        // Deduct points for consecutive failures
        score -= (this.healthMetrics.consecutiveFailures * 15);
        
        // Deduct points for overall failure rate
        const failureRate = this.healthMetrics.totalStatusChecks > 0 
            ? (this.healthMetrics.failedStatusChecks / this.healthMetrics.totalStatusChecks) * 100
            : 0;
        score -= (failureRate * 0.5);
        
        // Deduct points for connection failures
        score -= (this.connectionFailures * 10);
        
        // Deduct points if session is not connected
        if (this.sessionStatus !== 'connected') {
            score -= 30;
        }
        
        // Deduct points for slow response times
        if (this.performanceMetrics.averageResponseTime > 5000) {
            score -= 20;
        } else if (this.performanceMetrics.averageResponseTime > 2000) {
            score -= 10;
        }
        
        // Ensure score doesn't go below 0
        return Math.max(0, Math.round(score));
    }

    /**
     * Update performance metrics
     */
    updatePerformanceMetrics(responseTime, success) {
        this.performanceMetrics.totalApiCalls++;
        this.performanceMetrics.lastResponseTime = responseTime;
        
        if (!success) {
            this.performanceMetrics.failedApiCalls++;
        }
        
        // Calculate rolling average response time
        const totalCalls = this.performanceMetrics.totalApiCalls;
        const currentAverage = this.performanceMetrics.averageResponseTime;
        this.performanceMetrics.averageResponseTime = 
            ((currentAverage * (totalCalls - 1)) + responseTime) / totalCalls;
    }

    /**
     * Check notification thresholds and send alerts if needed
     */
    async checkNotificationThresholds() {
        const failures = this.healthMetrics.consecutiveFailures;
        
        if (failures >= this.notificationConfig.criticalThreshold) {
            await this.sendAdminNotification('critical', 
                `Session experiencing ${failures} consecutive failures`,
                {
                    sessionId: this.sessionId,
                    consecutiveFailures: failures,
                    lastError: 'Status check failed',
                    timestamp: new Date()
                }
            );
        } else if (failures >= this.notificationConfig.warningThreshold) {
            await this.sendAdminNotification('warning', 
                `Session experiencing ${failures} consecutive failures`,
                {
                    sessionId: this.sessionId,
                    consecutiveFailures: failures,
                    timestamp: new Date()
                }
            );
        }
    }

    /**
     * Send administrator notification
     */
    async sendAdminNotification(level, message, details = {}) {
        try {
            // Check if notifications are enabled
            if (!this.notificationConfig.enabled) {
                logger.debug('Admin notifications disabled, skipping notification');
                return;
            }
            
            // Check cooldown period
            const now = Date.now();
            if (this.notificationConfig.lastNotificationSent && 
                (now - this.notificationConfig.lastNotificationSent) < this.notificationConfig.cooldownPeriod) {
                logger.debug('Notification cooldown active, skipping notification');
                return;
            }
            
            const notification = {
                level,
                message,
                details,
                timestamp: new Date().toISOString(),
                sessionId: this.sessionId,
                sessionName: this.sessionName,
                service: 'wasender-session-manager'
            };
            
            logger.warn(`Admin notification [${level.toUpperCase()}]: ${message}`, notification);
            
            // Send email notification if configured
            if (this.notificationConfig.email) {
                await this.sendEmailNotification(notification);
            }
            
            // Send webhook notification if configured
            if (this.notificationConfig.webhook) {
                await this.sendWebhookNotification(notification);
            }
            
            // Update last notification time
            this.notificationConfig.lastNotificationSent = now;
            
            // Emit notification event
            this.emit('adminNotification', notification);
            
        } catch (error) {
            logger.error('Failed to send admin notification', { 
                error: error.message,
                level,
                message
            });
        }
    }

    /**
     * Send email notification (placeholder - would integrate with email service)
     */
    async sendEmailNotification(notification) {
        // This would integrate with an email service like SendGrid, AWS SES, etc.
        logger.info('Email notification would be sent', {
            to: this.notificationConfig.email,
            subject: `[${notification.level.toUpperCase()}] WhatsApp Session Alert`,
            notification
        });
        
        // For now, just log the notification
        // In a real implementation, you would integrate with your email service
    }

    /**
     * Send webhook notification
     */
    async sendWebhookNotification(notification) {
        try {
            const axios = require('axios');
            
            await axios.post(this.notificationConfig.webhook, notification, {
                timeout: 5000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Wasender-Session-Manager/1.0'
                }
            });
            
            logger.info('Webhook notification sent successfully', {
                webhook: this.notificationConfig.webhook,
                level: notification.level
            });
            
        } catch (error) {
            logger.error('Failed to send webhook notification', {
                error: error.message,
                webhook: this.notificationConfig.webhook
            });
        }
    }

    /**
     * Add event to history for monitoring
     */
    addEventToHistory(eventType, eventData) {
        const event = {
            type: eventType,
            data: eventData,
            timestamp: new Date(),
            sessionId: this.sessionId
        };
        
        this.eventHistory.unshift(event);
        
        // Keep only the last N events
        if (this.eventHistory.length > this.maxEventHistory) {
            this.eventHistory = this.eventHistory.slice(0, this.maxEventHistory);
        }
    }

    /**
     * Get system uptime
     */
    getUptime() {
        if (!this.healthMetrics.uptime) return 0;
        return Date.now() - this.healthMetrics.uptime;
    }

    /**
     * Get session uptime
     */
    getSessionUptime() {
        if (!this.sessionUptime) return 0;
        return Date.now() - this.sessionUptime;
    }

    /**
     * Handle session events from webhooks
     */
    async handleSessionEvents(eventData) {
        try {
            logger.info('Handling session event', { 
                eventType: eventData.type,
                sessionId: this.sessionId
            });
            
            // Add event to history
            this.addEventToHistory(eventData.type, eventData);
            
            switch (eventData.type) {
                case 'session.status':
                    await this.handleSessionStatusEvent(eventData);
                    break;
                    
                case 'qrcode.updated':
                    await this.handleQRCodeEvent(eventData);
                    break;
                    
                case 'connection.update':
                    await this.handleConnectionUpdateEvent(eventData);
                    break;
                    
                case 'auth.failure':
                    await this.handleAuthFailureEvent(eventData);
                    break;
                    
                case 'auth.success':
                    await this.handleAuthSuccessEvent(eventData);
                    break;
                    
                default:
                    logger.warn('Unknown session event type', { 
                        eventType: eventData.type 
                    });
            }
            
        } catch (error) {
            logger.error('Failed to handle session event', { 
                eventType: eventData.type,
                error: error.message 
            });
        }
    }

    /**
     * Handle session status event from webhook
     */
    async handleSessionStatusEvent(eventData) {
        const { status, sessionId } = eventData.data || {};
        
        if (sessionId === this.sessionId) {
            const previousStatus = this.sessionStatus;
            this.sessionStatus = status;
            
            this.handleSessionStatusChange(previousStatus, status);
        }
    }

    /**
     * Handle QR code event from webhook
     */
    async handleQRCodeEvent(eventData) {
        const { qrCode, sessionId } = eventData.data || {};
        
        if (sessionId === this.sessionId && qrCode) {
            logger.info('QR code updated via webhook', { sessionId: this.sessionId });
            
            this.emit('qrCodeUpdated', {
                sessionId: this.sessionId,
                qrCode,
                timestamp: new Date()
            });
        }
    }

    /**
     * Handle connection update event from webhook
     */
    async handleConnectionUpdateEvent(eventData) {
        const { connection, lastDisconnect, qr, sessionId } = eventData.data || {};
        
        if (sessionId === this.sessionId) {
            logger.info('Connection update received', {
                sessionId: this.sessionId,
                connection,
                lastDisconnect,
                hasQR: !!qr
            });
            
            // Update session status based on connection state
            if (connection === 'open') {
                const previousStatus = this.sessionStatus;
                this.sessionStatus = 'connected';
                this.handleSessionStatusChange(previousStatus, 'connected');
            } else if (connection === 'close') {
                const previousStatus = this.sessionStatus;
                this.sessionStatus = 'disconnected';
                this.handleSessionStatusChange(previousStatus, 'disconnected');
                
                // Send notification for unexpected disconnection
                if (previousStatus === 'connected') {
                    await this.sendAdminNotification('warning', 
                        'Session unexpectedly disconnected',
                        { connection, lastDisconnect, sessionId: this.sessionId }
                    );
                }
            }
            
            this.emit('connectionUpdate', {
                sessionId: this.sessionId,
                connection,
                lastDisconnect,
                qr,
                timestamp: new Date()
            });
        }
    }

    /**
     * Handle authentication failure event from webhook
     */
    async handleAuthFailureEvent(eventData) {
        const { reason, sessionId } = eventData.data || {};
        
        if (sessionId === this.sessionId) {
            logger.error('Authentication failure received', {
                sessionId: this.sessionId,
                reason
            });
            
            this.connectionFailures++;
            
            // Send critical notification for auth failures
            await this.sendAdminNotification('critical', 
                'WhatsApp authentication failed',
                { reason, sessionId: this.sessionId, timestamp: new Date() }
            );
            
            this.emit('authFailure', {
                sessionId: this.sessionId,
                reason,
                timestamp: new Date()
            });
            
            // Schedule reconnection after auth failure
            this.scheduleReconnection();
        }
    }

    /**
     * Handle authentication success event from webhook
     */
    async handleAuthSuccessEvent(eventData) {
        const { user, sessionId } = eventData.data || {};
        
        if (sessionId === this.sessionId) {
            logger.info('Authentication success received', {
                sessionId: this.sessionId,
                user: user ? { id: user.id, name: user.name } : null
            });
            
            // Reset failure counters on successful auth
            this.connectionFailures = 0;
            this.healthMetrics.consecutiveFailures = 0;
            this.lastSuccessfulConnection = new Date();
            
            // Send success notification
            await this.sendAdminNotification('info', 
                'WhatsApp authentication successful',
                { user, sessionId: this.sessionId, timestamp: new Date() }
            );
            
            this.emit('authSuccess', {
                sessionId: this.sessionId,
                user,
                timestamp: new Date()
            });
        }
    }

    /**
     * Get comprehensive session information
     */
    getSessionInfo() {
        return {
            session: {
                sessionId: this.sessionId,
                sessionName: this.sessionName,
                status: this.sessionStatus,
                createdAt: this.sessionCreatedAt,
                lastSuccessfulConnection: this.lastSuccessfulConnection,
                lastStatusCheck: this.lastStatusCheck,
                uptime: this.getUptime(),
                sessionUptime: this.getSessionUptime()
            },
            monitoring: {
                isStatusMonitoring: !!this.statusCheckTimer,
                isHealthMonitoring: !!this.healthCheckTimer,
                statusCheckInterval: this.statusCheckInterval,
                healthCheckInterval: this.healthCheckInterval
            },
            health: {
                ...this.healthMetrics,
                uptime: this.getUptime()
            },
            performance: {
                ...this.performanceMetrics
            },
            reconnection: {
                attempts: this.reconnectAttempts,
                maxAttempts: this.maxReconnectAttempts,
                isScheduled: !!this.reconnectTimer,
                connectionFailures: this.connectionFailures
            },
            notifications: {
                enabled: this.notificationConfig.enabled,
                email: !!this.notificationConfig.email,
                webhook: !!this.notificationConfig.webhook,
                lastNotificationSent: this.notificationConfig.lastNotificationSent,
                cooldownPeriod: this.notificationConfig.cooldownPeriod
            },
            events: {
                recentEvents: this.eventHistory.slice(0, 10), // Last 10 events
                totalEvents: this.eventHistory.length
            }
        };
    }

    /**
     * Get health status for monitoring endpoints
     */
    getHealthStatus() {
        const healthScore = this.calculateHealthScore();
        const isHealthy = healthScore >= 70;
        
        return {
            status: isHealthy ? 'healthy' : (healthScore >= 30 ? 'degraded' : 'critical'),
            score: healthScore,
            timestamp: new Date().toISOString(),
            session: {
                id: this.sessionId,
                status: this.sessionStatus,
                uptime: this.getSessionUptime(),
                lastConnection: this.lastSuccessfulConnection
            },
            metrics: {
                consecutiveFailures: this.healthMetrics.consecutiveFailures,
                totalChecks: this.healthMetrics.totalStatusChecks,
                failedChecks: this.healthMetrics.failedStatusChecks,
                averageResponseTime: this.performanceMetrics.averageResponseTime
            },
            monitoring: {
                statusMonitoring: !!this.statusCheckTimer,
                healthMonitoring: !!this.healthCheckTimer,
                lastHealthCheck: this.healthMetrics.lastHealthCheck
            }
        };
    }

    /**
     * Reset session manager
     */
    async reset() {
        logger.info('Resetting session manager');
        
        // Stop all timers
        this.stopStatusMonitoring();
        this.stopReconnectionAttempts();
        
        // Reset session state
        this.sessionId = null;
        this.sessionStatus = 'disconnected';
        this.sessionCreatedAt = null;
        this.lastSuccessfulConnection = null;
        this.reconnectAttempts = 0;
        this.connectionFailures = 0;
        this.lastStatusCheck = null;
        this.sessionUptime = null;
        
        // Reset health metrics
        this.healthMetrics = {
            totalStatusChecks: 0,
            failedStatusChecks: 0,
            consecutiveFailures: 0,
            lastHealthCheck: null,
            healthScore: 100,
            uptime: Date.now()
        };
        
        // Reset performance metrics
        this.performanceMetrics = {
            averageResponseTime: 0,
            totalApiCalls: 0,
            failedApiCalls: 0,
            lastResponseTime: null
        };
        
        // Clear event history
        this.eventHistory = [];
        
        // Reset notification cooldown
        this.notificationConfig.lastNotificationSent = null;
        
        this.emit('reset');
        
        logger.info('Session manager reset complete');
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        logger.info('Cleaning up session manager');
        
        try {
            // Disconnect session if connected
            if (this.sessionStatus === 'connected') {
                await this.disconnectSession();
            }
            
            // Stop all monitoring
            this.stopStatusMonitoring();
            this.stopReconnectionAttempts();
            
            // Remove all listeners
            this.removeAllListeners();
            
            logger.info('Session manager cleanup complete');
            
        } catch (error) {
            logger.error('Error during session manager cleanup', { error: error.message });
        }
    }
}

module.exports = SessionManager;