/**
 * Ngrok Tunnel Service
 * Manages ngrok tunnel for webhook development
 */

const ngrok = require('ngrok');
const logger = require('../loggingService');
const WasenderClient = require('./wasenderClient');

class NgrokService {
    constructor() {
        this.authToken = process.env.NGROK_AUTH_TOKEN;
        this.port = process.env.WEBHOOK_PORT || 3000;
        this.webhookPath = process.env.WEBHOOK_PATH || '/webhook/wasender';
        this.tunnelUrl = null;
        this.wasenderClient = new WasenderClient();
        this.healthCheckInterval = null;
    }

    /**
     * Start ngrok tunnel
     */
    async startTunnel(port = this.port) {
        try {
            // Set auth token if provided
            if (this.authToken) {
                await ngrok.authtoken(this.authToken);
            }

            // Start tunnel
            const url = await ngrok.connect({
                port: port,
                proto: 'http',
                region: 'us' // Can be configured via environment
            });

            this.tunnelUrl = url;
            const webhookUrl = `${url}${this.webhookPath}`;

            logger.info('Ngrok tunnel started successfully', {
                tunnelUrl: url,
                webhookUrl,
                port
            });

            // Update webhook URL in Wasender API
            await this.updateWebhookUrl(webhookUrl);

            // Start health monitoring
            this.startHealthMonitoring();

            return {
                tunnelUrl: url,
                webhookUrl
            };

        } catch (error) {
            logger.error('Failed to start ngrok tunnel', {
                error: error.message,
                port
            });
            throw error;
        }
    }

    /**
     * Get current tunnel URL
     */
    getTunnelUrl() {
        return this.tunnelUrl;
    }

    /**
     * Update webhook URL in Wasender API
     */
    async updateWebhookUrl(webhookUrl) {
        try {
            await this.wasenderClient.updateWebhookUrl(webhookUrl);
            
            logger.info('Webhook URL updated in Wasender API', { webhookUrl });
            
        } catch (error) {
            logger.error('Failed to update webhook URL in Wasender API', {
                webhookUrl,
                error: error.message
            });
            // Don't throw error as tunnel is still functional
        }
    }

    /**
     * Stop ngrok tunnel
     */
    async stopTunnel() {
        try {
            // Stop health monitoring
            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }

            // Disconnect tunnel
            await ngrok.disconnect();
            await ngrok.kill();

            this.tunnelUrl = null;

            logger.info('Ngrok tunnel stopped successfully');

        } catch (error) {
            logger.error('Failed to stop ngrok tunnel', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Start health monitoring for tunnel
     */
    startHealthMonitoring() {
        // Check tunnel health every 30 seconds
        this.healthCheckInterval = setInterval(async () => {
            try {
                await this.checkTunnelHealth();
            } catch (error) {
                logger.error('Tunnel health check failed', {
                    error: error.message
                });
            }
        }, 30000);

        logger.info('Tunnel health monitoring started');
    }

    /**
     * Check tunnel health
     */
    async checkTunnelHealth() {
        try {
            const tunnels = await ngrok.getApi().listTunnels();
            
            if (tunnels.tunnels.length === 0) {
                logger.warn('No active tunnels found, attempting reconnection');
                await this.reconnectTunnel();
                return;
            }

            const activeTunnel = tunnels.tunnels.find(t => t.public_url === this.tunnelUrl);
            
            if (!activeTunnel) {
                logger.warn('Current tunnel not found in active tunnels, attempting reconnection');
                await this.reconnectTunnel();
                return;
            }

            logger.debug('Tunnel health check passed', {
                tunnelUrl: this.tunnelUrl,
                status: 'healthy'
            });

        } catch (error) {
            logger.error('Tunnel health check error', {
                error: error.message
            });
        }
    }

    /**
     * Reconnect tunnel
     */
    async reconnectTunnel() {
        try {
            logger.info('Attempting to reconnect ngrok tunnel');

            // Stop current tunnel
            await this.stopTunnel();

            // Wait a moment before reconnecting
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Start new tunnel
            await this.startTunnel();

            logger.info('Ngrok tunnel reconnected successfully');

        } catch (error) {
            logger.error('Failed to reconnect ngrok tunnel', {
                error: error.message
            });
        }
    }

    /**
     * Get tunnel status
     */
    async getTunnelStatus() {
        try {
            const tunnels = await ngrok.getApi().listTunnels();
            
            return {
                isActive: tunnels.tunnels.length > 0,
                tunnelUrl: this.tunnelUrl,
                activeTunnels: tunnels.tunnels.map(t => ({
                    name: t.name,
                    public_url: t.public_url,
                    proto: t.proto,
                    config: t.config
                }))
            };

        } catch (error) {
            logger.error('Failed to get tunnel status', {
                error: error.message
            });
            
            return {
                isActive: false,
                tunnelUrl: this.tunnelUrl,
                error: error.message
            };
        }
    }
}

module.exports = NgrokService;