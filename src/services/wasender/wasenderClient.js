/**
 * Wasender API Client Service
 * Handles all interactions with the Wasender API
 */

const axios = require('axios');
const logger = require('../loggingService');

class WasenderClient {
    constructor() {
        this.baseURL = process.env.WASENDER_BASE_URL;
        this.apiKey = process.env.WASENDER_API_KEY;
        this.personalAccessToken = process.env.WASENDER_PERSONAL_ACCESS_TOKEN;
        this.sessionName = process.env.WASENDER_SESSION_NAME;
        
        // Retry configuration
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second base delay
        this.retryableStatusCodes = [408, 429, 500, 502, 503, 504];
        
        // Create axios instance with default configuration
        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        // Add request interceptor to handle different authentication methods per endpoint
        this.client.interceptors.request.use((config) => {
            // Different endpoints require different authentication methods
            if (config.url.includes('/api/groups/') || config.url.includes('/api/decrypt-media')) {
                // Group metadata and media endpoints require API Key as Bearer token
                config.headers['Authorization'] = `Bearer ${this.apiKey}`;
                logger.debug('Using API Key authentication for endpoint', { url: config.url });
            } else {
                // Session management endpoints require Personal Access Token
                config.headers['Authorization'] = `Bearer ${this.personalAccessToken}`;
                logger.debug('Using Personal Access Token authentication for endpoint', { url: config.url });
            }
            return config;
        });

        // Add request/response interceptors for logging
        this.setupInterceptors();
    }

    setupInterceptors() {
        // Request interceptor
        this.client.interceptors.request.use(
            (config) => {
                logger.info('Wasender API Request', {
                    method: config.method,
                    url: config.url,
                    data: config.data ? JSON.stringify(config.data) : null
                });
                return config;
            },
            (error) => {
                logger.error('Wasender API Request Error', { error: error.message });
                return Promise.reject(error);
            }
        );

        // Response interceptor
        this.client.interceptors.response.use(
            (response) => {
                logger.info('Wasender API Response', {
                    status: response.status,
                    url: response.config.url,
                    responseTime: response.headers['x-response-time'] || 'unknown'
                });
                return response;
            },
            (error) => {
                logger.error('Wasender API Response Error', {
                    status: error.response?.status,
                    message: error.message,
                    url: error.config?.url,
                    data: error.response?.data
                });
                return Promise.reject(error);
            }
        );
    }

    /**
     * Execute API call with retry logic
     */
    async executeWithRetry(apiCall, retries = this.maxRetries) {
        try {
            return await apiCall();
        } catch (error) {
            const shouldRetry = this.shouldRetry(error, retries);
            
            if (shouldRetry) {
                const delay = this.calculateRetryDelay(this.maxRetries - retries + 1);
                
                logger.warn('API call failed, retrying', {
                    error: error.message,
                    status: error.response?.status,
                    retriesLeft: retries - 1,
                    retryDelay: delay
                });
                
                await this.sleep(delay);
                return this.executeWithRetry(apiCall, retries - 1);
            }
            
            throw error;
        }
    }

    /**
     * Check if error should be retried
     */
    shouldRetry(error, retriesLeft) {
        if (retriesLeft <= 0) return false;
        
        // Retry on network errors
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            return true;
        }
        
        // Retry on specific HTTP status codes
        if (error.response && this.retryableStatusCodes.includes(error.response.status)) {
            return true;
        }
        
        return false;
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    calculateRetryDelay(attempt) {
        return this.retryDelay * Math.pow(2, attempt - 1);
    }

    /**
     * Sleep utility function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Create a new WhatsApp session
     */
    async createSession(sessionName = this.sessionName, phoneNumber = null) {
        return this.executeWithRetry(async () => {
            try {
                const response = await this.client.post('/api/whatsapp-sessions', {
                    sessionName,
                    phoneNumber
                });
                
                logger.info('Session created successfully', { 
                    sessionName, 
                    sessionId: response.data.sessionId 
                });
                
                return response.data;
            } catch (error) {
                logger.error('Failed to create session', { 
                    sessionName, 
                    error: error.message 
                });
                throw error;
            }
        });
    }

    /**
     * Get QR code for session authentication
     */
    async getQRCode(sessionId) {
        return this.executeWithRetry(async () => {
            try {
                const response = await this.client.get(`/api/whatsapp-sessions/${sessionId}/qrcode`);
                
                logger.info('QR code retrieved successfully', { sessionId });
                
                return response.data;
            } catch (error) {
                logger.error('Failed to get QR code', { 
                    sessionId, 
                    error: error.message 
                });
                throw error;
            }
        });
    }

    /**
     * Get session status
     */
    async getSessionStatus(sessionId) {
        return this.executeWithRetry(async () => {
            try {
                // Get all sessions and find the specific one
                const response = await this.client.get('/api/whatsapp-sessions');
                
                if (response.data && response.data.success && response.data.data) {
                    const sessions = response.data.data;
                    const session = sessions.find(s => s.name === sessionId);
                    
                    if (session) {
                        logger.info('Session status retrieved successfully', {
                            sessionId,
                            status: session.status,
                            lastActive: session.last_active_at
                        });
                        
                        return {
                            success: true,
                            status: session.status,
                            sessionData: session,
                            timestamp: new Date().toISOString()
                        };
                    } else {
                        logger.warn('Session not found in sessions list', { sessionId });
                        return {
                            success: false,
                            status: 'not_found',
                            message: `Session ${sessionId} not found`,
                            timestamp: new Date().toISOString()
                        };
                    }
                } else {
                    logger.error('Invalid response from sessions API', { response: response.data });
                    throw new Error('Invalid response from sessions API');
                }
            } catch (error) {
                logger.error('Failed to get session status', { 
                    sessionId, 
                    error: error.message,
                    status: error.response?.status
                });
                throw error;
            }
        });
    }

    /**
     * Connect session
     */
    async connectSession(sessionId) {
        return this.executeWithRetry(async () => {
            try {
                const response = await this.client.post(`/api/whatsapp-sessions/${sessionId}/connect`);
                
                logger.info('Session connected successfully', { sessionId });
                
                return response.data;
            } catch (error) {
                logger.error('Failed to connect session', { 
                    sessionId, 
                    error: error.message 
                });
                throw error;
            }
        });
    }

    /**
     * Disconnect session
     */
    async disconnectSession(sessionId) {
        return this.executeWithRetry(async () => {
            try {
                const response = await this.client.post(`/api/whatsapp-sessions/${sessionId}/disconnect`);
                
                logger.info('Session disconnected successfully', { sessionId });
                
                return response.data;
            } catch (error) {
                logger.error('Failed to disconnect session', { 
                    sessionId, 
                    error: error.message 
                });
                throw error;
            }
        });
    }

    /**
     * Decrypt media using Wasender API
     */
    async decryptMedia(mediaUrl, mediaKey, mediaType) {
        return this.executeWithRetry(async () => {
            try {
                const response = await this.client.post('/api/decrypt-media', {
                    mediaUrl,
                    mediaKey,
                    mediaType
                });
                
                logger.info('Media decrypted successfully', { 
                    mediaType, 
                    mediaUrl: mediaUrl.substring(0, 50) + '...' 
                });
                
                return response.data;
            } catch (error) {
                logger.error('Failed to decrypt media', { 
                    mediaType, 
                    error: error.message 
                });
                throw error;
            }
        });
    }

    /**
     * Update webhook URL
     */
    async updateWebhookUrl(webhookUrl) {
        return this.executeWithRetry(async () => {
            try {
                const response = await this.client.post('/api/webhook/update', {
                    url: webhookUrl,
                    events: [
                        'messages.upsert',
                        'messages.update',
                        'session.status',
                        'qrcode.updated'
                    ]
                });
                
                logger.info('Webhook URL updated successfully', { webhookUrl });
                
                return response.data;
            } catch (error) {
                logger.error('Failed to update webhook URL', { 
                    webhookUrl, 
                    error: error.message 
                });
                throw error;
            }
        });
    }
}

module.exports = WasenderClient;