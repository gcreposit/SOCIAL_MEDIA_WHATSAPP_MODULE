const HealthCheckService = require('./healthCheckService');
const LoggingService = require('./loggingService');

/**
 * Monitoring Service
 * Provides comprehensive monitoring and alerting for the Wasender API migration system
 */
class MonitoringService {
    constructor(options = {}) {
        this.healthCheck = new HealthCheckService(options.healthCheck);
        this.logger = LoggingService.getLogger('monitoring');
        this.config = {
            healthCheckInterval: options.healthCheckInterval || 60000, // 1 minute
            metricsInterval: options.metricsInterval || 300000, // 5 minutes
            alertingEnabled: options.alertingEnabled !== false,
            ...options
        };
        
        this.intervals = new Map();
        this.isRunning = false;
        
        // Initialize health checks for core services
        this.initializeHealthChecks();
    }

    /**
     * Initialize health checks for all core services
     */
    initializeHealthChecks() {
        // Database health check
        this.healthCheck.registerService('database', async () => {
            try {
                const DatabaseService = require('./databaseService');
                const dbService = new DatabaseService();
                await dbService.testConnection();
                return { message: 'Database connection successful' };
            } catch (error) {
                throw new Error(`Database connection failed: ${error.message}`);
            }
        }, { critical: true, timeout: 10000 });

        // Wasender API health check
        this.healthCheck.registerService('wasender_api', async () => {
            try {
                const WasenderClient = require('./wasender/wasenderClient');
                const client = new WasenderClient();
                const status = await client.getStatus();
                return { 
                    message: 'Wasender API connection successful',
                    data: { status: status.status }
                };
            } catch (error) {
                throw new Error(`Wasender API connection failed: ${error.message}`);
            }
        }, { critical: true, timeout: 15000 });

        // Session health check
        this.healthCheck.registerService('whatsapp_session', async () => {
            try {
                const SessionManager = require('./wasender/sessionManager');
                const sessionManager = new SessionManager();
                const status = await sessionManager.getSessionStatus();
                
                if (status.status !== 'connected') {
                    throw new Error(`Session not connected: ${status.status}`);
                }
                
                return { 
                    message: 'WhatsApp session is connected',
                    data: { status: status.status, sessionName: status.sessionName }
                };
            } catch (error) {
                throw new Error(`Session health check failed: ${error.message}`);
            }
        }, { critical: true, timeout: 10000 });

        // Webhook endpoint health check
        this.healthCheck.registerService('webhook_endpoint', async () => {
            try {
                const axios = require('axios');
                const response = await axios.get('http://localhost:3000/health', { timeout: 5000 });
                
                if (response.status !== 200) {
                    throw new Error(`Webhook endpoint returned status ${response.status}`);
                }
                
                return { message: 'Webhook endpoint is responding' };
            } catch (error) {
                throw new Error(`Webhook endpoint health check failed: ${error.message}`);
            }
        }, { critical: true, timeout: 8000 });

        // File system health check
        this.healthCheck.registerService('file_system', async () => {
            try {
                const fs = require('fs').promises;
                const path = require('path');
                const wasenderConfig = require('../config/wasenderConfig');
                
                const attachmentPath = wasenderConfig.fileStorage.attachmentPath;
                
                // Check if attachment directory exists and is writable
                await fs.access(attachmentPath, fs.constants.F_OK | fs.constants.W_OK);
                
                // Test write operation
                const testFile = path.join(attachmentPath, '.health_check_test');
                await fs.writeFile(testFile, 'health check test');
                await fs.unlink(testFile);
                
                return { message: 'File system is accessible and writable' };
            } catch (error) {
                throw new Error(`File system health check failed: ${error.message}`);
            }
        }, { critical: false, timeout: 5000 });

        // Memory usage health check
        this.healthCheck.registerService('memory_usage', async () => {
            const memUsage = process.memoryUsage();
            const totalMemory = memUsage.heapTotal;
            const usedMemory = memUsage.heapUsed;
            const memoryUsagePercent = (usedMemory / totalMemory) * 100;
            
            if (memoryUsagePercent > 90) {
                throw new Error(`High memory usage: ${memoryUsagePercent.toFixed(2)}%`);
            }
            
            return { 
                message: `Memory usage is normal: ${memoryUsagePercent.toFixed(2)}%`,
                data: { 
                    usedMemory: Math.round(usedMemory / 1024 / 1024),
                    totalMemory: Math.round(totalMemory / 1024 / 1024),
                    usagePercent: memoryUsagePercent.toFixed(2)
                }
            };
        }, { critical: false, timeout: 1000 });

        // Disk space health check
        this.healthCheck.registerService('disk_space', async () => {
            try {
                const { execSync } = require('child_process');
                const wasenderConfig = require('../config/wasenderConfig');
                const attachmentPath = wasenderConfig.fileStorage.attachmentPath;
                
                // Get disk usage for attachment directory
                const output = execSync(`df -h "${attachmentPath}"`, { encoding: 'utf8' });
                const lines = output.trim().split('\n');
                const diskInfo = lines[1].split(/\s+/);
                const usagePercent = parseInt(diskInfo[4].replace('%', ''));
                
                if (usagePercent > 85) {
                    throw new Error(`High disk usage: ${usagePercent}%`);
                }
                
                return { 
                    message: `Disk usage is normal: ${usagePercent}%`,
                    data: { 
                        total: diskInfo[1],
                        used: diskInfo[2],
                        available: diskInfo[3],
                        usagePercent
                    }
                };
            } catch (error) {
                // Fallback for systems where df command is not available
                return { message: 'Disk space check not available on this system' };
            }
        }, { critical: false, timeout: 5000 });
    }

    /**
     * Start monitoring services
     */
    start() {
        if (this.isRunning) {
            this.logger.warn('Monitoring service is already running');
            return;
        }

        this.logger.info('Starting monitoring service');
        this.isRunning = true;

        // Start periodic health checks
        const healthCheckInterval = setInterval(async () => {
            try {
                const results = await this.healthCheck.checkAllServices();
                this.logger.debug('Health check completed', { 
                    status: results.status,
                    serviceCount: Object.keys(results.services).length
                });

                // Log any unhealthy services
                Object.entries(results.services).forEach(([serviceName, result]) => {
                    if (result.status === 'unhealthy') {
                        this.logger.warn(`Service ${serviceName} is unhealthy`, {
                            message: result.message,
                            consecutiveFailures: result.consecutiveFailures
                        });
                    }
                });

            } catch (error) {
                this.logger.error('Health check failed', { error: error.message });
            }
        }, this.config.healthCheckInterval);

        this.intervals.set('healthCheck', healthCheckInterval);

        // Start periodic metrics collection
        const metricsInterval = setInterval(() => {
            try {
                const metrics = this.healthCheck.getAllMetrics();
                this.logger.info('System metrics collected', {
                    uptime: metrics.system.uptime,
                    memoryUsage: Math.round(metrics.system.memory.heapUsed / 1024 / 1024),
                    healthCheckCount: metrics.system.healthCheckCount,
                    activeAlerts: this.healthCheck.getActiveAlerts().length
                });
            } catch (error) {
                this.logger.error('Metrics collection failed', { error: error.message });
            }
        }, this.config.metricsInterval);

        this.intervals.set('metrics', metricsInterval);

        this.logger.info('Monitoring service started successfully');
    }

    /**
     * Stop monitoring services
     */
    stop() {
        if (!this.isRunning) {
            this.logger.warn('Monitoring service is not running');
            return;
        }

        this.logger.info('Stopping monitoring service');
        this.isRunning = false;

        // Clear all intervals
        for (const [name, interval] of this.intervals) {
            clearInterval(interval);
            this.logger.debug(`Stopped ${name} interval`);
        }

        this.intervals.clear();
        this.logger.info('Monitoring service stopped');
    }

    /**
     * Get current health status
     */
    async getHealthStatus() {
        return await this.healthCheck.checkAllServices();
    }

    /**
     * Get service metrics
     */
    getMetrics() {
        return this.healthCheck.getAllMetrics();
    }

    /**
     * Get active alerts
     */
    getActiveAlerts() {
        return this.healthCheck.getActiveAlerts();
    }

    /**
     * Enable/disable a service
     */
    setServiceEnabled(serviceName, enabled) {
        this.healthCheck.setServiceEnabled(serviceName, enabled);
        this.logger.info(`Service ${serviceName} ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Trigger manual health check for a specific service
     */
    async checkService(serviceName) {
        return await this.healthCheck.checkService(serviceName);
    }

    /**
     * Export monitoring data for external systems
     */
    exportData() {
        return {
            ...this.healthCheck.exportHealthData(),
            monitoring: {
                isRunning: this.isRunning,
                intervals: Array.from(this.intervals.keys()),
                config: this.config
            }
        };
    }

    /**
     * Custom alert handler
     */
    setupCustomAlerting(alertHandler) {
        this.healthCheck.onAlert = alertHandler;
        this.logger.info('Custom alert handler configured');
    }
}

module.exports = MonitoringService;