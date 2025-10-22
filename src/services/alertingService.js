const LoggingService = require('./loggingService');

/**
 * Alerting Service
 * Handles system alerts and notifications for monitoring events
 */
class AlertingService {
    constructor(options = {}) {
        this.logger = LoggingService.getLogger('alerting');
        this.config = {
            enabled: options.enabled !== false,
            channels: options.channels || ['console', 'log'],
            rateLimiting: {
                enabled: options.rateLimiting?.enabled !== false,
                windowMs: options.rateLimiting?.windowMs || 300000, // 5 minutes
                maxAlerts: options.rateLimiting?.maxAlerts || 10
            },
            ...options
        };
        
        this.alertHistory = new Map();
        this.rateLimitTracker = new Map();
        
        // Initialize alert channels
        this.initializeChannels();
    }

    /**
     * Initialize alert channels
     */
    initializeChannels() {
        this.channels = {
            console: this.sendConsoleAlert.bind(this),
            log: this.sendLogAlert.bind(this),
            webhook: this.sendWebhookAlert.bind(this),
            email: this.sendEmailAlert.bind(this),
            slack: this.sendSlackAlert.bind(this)
        };
    }

    /**
     * Send alert through configured channels
     */
    async sendAlert(alert) {
        if (!this.config.enabled) {
            return;
        }

        // Check rate limiting
        if (this.isRateLimited(alert)) {
            this.logger.warn('Alert rate limited', { 
                alertType: alert.type,
                serviceName: alert.serviceName 
            });
            return;
        }

        // Add alert to history
        this.addToHistory(alert);

        // Send through configured channels
        const promises = this.config.channels.map(async (channelName) => {
            try {
                const channel = this.channels[channelName];
                if (channel) {
                    await channel(alert);
                } else {
                    this.logger.warn(`Unknown alert channel: ${channelName}`);
                }
            } catch (error) {
                this.logger.error(`Failed to send alert via ${channelName}`, {
                    error: error.message,
                    alert: alert.id
                });
            }
        });

        await Promise.allSettled(promises);
        
        this.logger.info('Alert sent', {
            alertId: alert.id,
            type: alert.type,
            serviceName: alert.serviceName,
            channels: this.config.channels
        });
    }

    /**
     * Check if alert is rate limited
     */
    isRateLimited(alert) {
        if (!this.config.rateLimiting.enabled) {
            return false;
        }

        const key = `${alert.type}_${alert.serviceName}`;
        const now = Date.now();
        const windowStart = now - this.config.rateLimiting.windowMs;

        // Get or create rate limit tracker for this alert type
        if (!this.rateLimitTracker.has(key)) {
            this.rateLimitTracker.set(key, []);
        }

        const tracker = this.rateLimitTracker.get(key);
        
        // Remove old entries outside the window
        const validEntries = tracker.filter(timestamp => timestamp > windowStart);
        this.rateLimitTracker.set(key, validEntries);

        // Check if we've exceeded the limit
        if (validEntries.length >= this.config.rateLimiting.maxAlerts) {
            return true;
        }

        // Add current alert to tracker
        validEntries.push(now);
        this.rateLimitTracker.set(key, validEntries);

        return false;
    }

    /**
     * Add alert to history
     */
    addToHistory(alert) {
        const key = `${alert.type}_${alert.serviceName}`;
        
        if (!this.alertHistory.has(key)) {
            this.alertHistory.set(key, []);
        }

        const history = this.alertHistory.get(key);
        history.push({
            ...alert,
            sentAt: new Date()
        });

        // Keep only last 50 alerts per type
        if (history.length > 50) {
            history.splice(0, history.length - 50);
        }
    }

    /**
     * Console alert channel
     */
    async sendConsoleAlert(alert) {
        const severity = alert.severity || 'medium';
        const color = severity === 'high' ? '\x1b[31m' : 
                     severity === 'medium' ? '\x1b[33m' : '\x1b[36m';
        const reset = '\x1b[0m';

        console.error(`${color}[ALERT ${severity.toUpperCase()}]${reset} ${alert.message}`);
        console.error(`Service: ${alert.serviceName}`);
        console.error(`Time: ${alert.timestamp}`);
        if (alert.error) {
            console.error(`Error: ${alert.error}`);
        }
        console.error('---');
    }

    /**
     * Log alert channel
     */
    async sendLogAlert(alert) {
        this.logger.error('System Alert', {
            alertId: alert.id,
            type: alert.type,
            severity: alert.severity,
            serviceName: alert.serviceName,
            message: alert.message,
            error: alert.error,
            timestamp: alert.timestamp
        });
    }

    /**
     * Webhook alert channel
     */
    async sendWebhookAlert(alert) {
        if (!this.config.webhookUrl) {
            this.logger.warn('Webhook URL not configured for alerts');
            return;
        }

        try {
            const axios = require('axios');
            
            const payload = {
                alert_id: alert.id,
                type: alert.type,
                severity: alert.severity,
                service_name: alert.serviceName,
                message: alert.message,
                error: alert.error,
                timestamp: alert.timestamp,
                system: 'wasender-migration'
            };

            await axios.post(this.config.webhookUrl, payload, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'Wasender-Migration-Alerting/1.0'
                }
            });

        } catch (error) {
            throw new Error(`Webhook alert failed: ${error.message}`);
        }
    }

    /**
     * Email alert channel
     */
    async sendEmailAlert(alert) {
        if (!this.config.email?.enabled) {
            this.logger.warn('Email alerting not configured');
            return;
        }

        try {
            // This is a placeholder for email integration
            // You would integrate with your preferred email service here
            // (SendGrid, AWS SES, Nodemailer, etc.)
            
            const emailData = {
                to: this.config.email.recipients,
                subject: `[ALERT] ${alert.serviceName} - ${alert.type}`,
                html: this.generateEmailTemplate(alert)
            };

            this.logger.info('Email alert would be sent', { emailData });
            // await emailService.send(emailData);

        } catch (error) {
            throw new Error(`Email alert failed: ${error.message}`);
        }
    }

    /**
     * Slack alert channel
     */
    async sendSlackAlert(alert) {
        if (!this.config.slack?.webhookUrl) {
            this.logger.warn('Slack webhook URL not configured for alerts');
            return;
        }

        try {
            const axios = require('axios');
            
            const color = alert.severity === 'high' ? 'danger' : 
                         alert.severity === 'medium' ? 'warning' : 'good';

            const payload = {
                username: 'Wasender Migration Monitor',
                icon_emoji: ':warning:',
                attachments: [{
                    color,
                    title: `Alert: ${alert.serviceName}`,
                    text: alert.message,
                    fields: [
                        {
                            title: 'Service',
                            value: alert.serviceName,
                            short: true
                        },
                        {
                            title: 'Severity',
                            value: alert.severity || 'medium',
                            short: true
                        },
                        {
                            title: 'Time',
                            value: alert.timestamp,
                            short: true
                        },
                        {
                            title: 'Alert ID',
                            value: alert.id,
                            short: true
                        }
                    ],
                    footer: 'Wasender Migration System',
                    ts: Math.floor(new Date(alert.timestamp).getTime() / 1000)
                }]
            };

            if (alert.error) {
                payload.attachments[0].fields.push({
                    title: 'Error',
                    value: alert.error,
                    short: false
                });
            }

            await axios.post(this.config.slack.webhookUrl, payload, {
                timeout: 10000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

        } catch (error) {
            throw new Error(`Slack alert failed: ${error.message}`);
        }
    }

    /**
     * Generate email template for alerts
     */
    generateEmailTemplate(alert) {
        const severityColor = alert.severity === 'high' ? '#dc3545' : 
                             alert.severity === 'medium' ? '#ffc107' : '#17a2b8';

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
                .alert-container { max-width: 600px; margin: 0 auto; }
                .alert-header { background-color: ${severityColor}; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
                .alert-body { background-color: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; border-radius: 0 0 5px 5px; }
                .alert-field { margin-bottom: 10px; }
                .alert-label { font-weight: bold; color: #495057; }
                .alert-value { color: #212529; }
                .error-details { background-color: #fff; padding: 10px; border-left: 4px solid #dc3545; margin-top: 15px; }
            </style>
        </head>
        <body>
            <div class="alert-container">
                <div class="alert-header">
                    <h2>System Alert: ${alert.serviceName}</h2>
                </div>
                <div class="alert-body">
                    <div class="alert-field">
                        <span class="alert-label">Message:</span>
                        <span class="alert-value">${alert.message}</span>
                    </div>
                    <div class="alert-field">
                        <span class="alert-label">Service:</span>
                        <span class="alert-value">${alert.serviceName}</span>
                    </div>
                    <div class="alert-field">
                        <span class="alert-label">Severity:</span>
                        <span class="alert-value">${alert.severity || 'medium'}</span>
                    </div>
                    <div class="alert-field">
                        <span class="alert-label">Time:</span>
                        <span class="alert-value">${alert.timestamp}</span>
                    </div>
                    <div class="alert-field">
                        <span class="alert-label">Alert ID:</span>
                        <span class="alert-value">${alert.id}</span>
                    </div>
                    ${alert.error ? `
                    <div class="error-details">
                        <strong>Error Details:</strong><br>
                        ${alert.error}
                    </div>
                    ` : ''}
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Get alert history
     */
    getAlertHistory(serviceName = null, type = null) {
        if (serviceName && type) {
            const key = `${type}_${serviceName}`;
            return this.alertHistory.get(key) || [];
        }

        const allHistory = [];
        for (const [key, history] of this.alertHistory) {
            allHistory.push(...history);
        }

        return allHistory.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
    }

    /**
     * Clear alert history
     */
    clearAlertHistory(serviceName = null, type = null) {
        if (serviceName && type) {
            const key = `${type}_${serviceName}`;
            this.alertHistory.delete(key);
        } else {
            this.alertHistory.clear();
        }
    }

    /**
     * Update configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        this.logger.info('Alerting configuration updated', { config: this.config });
    }

    /**
     * Test alert functionality
     */
    async testAlert(channelName = null) {
        const testAlert = {
            id: `test_alert_${Date.now()}`,
            type: 'test',
            severity: 'low',
            serviceName: 'test_service',
            message: 'This is a test alert to verify alerting functionality',
            timestamp: new Date().toISOString(),
            error: null
        };

        if (channelName) {
            const channel = this.channels[channelName];
            if (channel) {
                await channel(testAlert);
                this.logger.info(`Test alert sent via ${channelName}`);
            } else {
                throw new Error(`Unknown channel: ${channelName}`);
            }
        } else {
            await this.sendAlert(testAlert);
        }
    }
}

module.exports = AlertingService;