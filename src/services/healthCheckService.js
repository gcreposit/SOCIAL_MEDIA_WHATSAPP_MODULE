const { performance } = require('perf_hooks');
const fs = require('fs').promises;
const path = require('path');

/**
 * Health Check Service
 * Provides comprehensive health monitoring for all system components
 */
class HealthCheckService {
    constructor(options = {}) {
        this.services = new Map();
        this.metrics = new Map();
        this.alerts = [];
        this.config = {
            timeout: options.timeout || 5000,
            retryAttempts: options.retryAttempts || 2,
            alertThreshold: options.alertThreshold || 3,
            metricsRetention: options.metricsRetention || 24 * 60 * 60 * 1000, // 24 hours
            ...options
        };
        
        // Initialize core metrics
        this.initializeMetrics();
    }

    /**
     * Initialize core system metrics
     */
    initializeMetrics() {
        this.metrics.set('system', {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            startTime: Date.now(),
            lastHealthCheck: null,
            healthCheckCount: 0,
            errors: []
        });
    }

    /**
     * Register a service for health monitoring
     */
    registerService(name, healthCheckFunction, options = {}) {
        this.services.set(name, {
            name,
            healthCheck: healthCheckFunction,
            enabled: options.enabled !== false,
            timeout: options.timeout || this.config.timeout,
            retryAttempts: options.retryAttempts || this.config.retryAttempts,
            critical: options.critical !== false,
            lastCheck: null,
            status: 'unknown',
            consecutiveFailures: 0,
            metrics: {
                totalChecks: 0,
                successfulChecks: 0,
                failedChecks: 0,
                averageResponseTime: 0,
                lastResponseTime: 0
            }
        });
    }

    /**
     * Perform health check for a specific service
     */
    async checkService(serviceName) {
        const service = this.services.get(serviceName);
        if (!service || !service.enabled) {
            return { status: 'disabled', message: 'Service disabled or not found' };
        }

        const startTime = performance.now();
        let attempt = 0;
        let lastError;

        while (attempt < service.retryAttempts) {
            try {
                const result = await Promise.race([
                    service.healthCheck(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Health check timeout')), service.timeout)
                    )
                ]);

                const responseTime = performance.now() - startTime;
                
                // Update service metrics
                service.lastCheck = new Date();
                service.status = 'healthy';
                service.consecutiveFailures = 0;
                service.metrics.totalChecks++;
                service.metrics.successfulChecks++;
                service.metrics.lastResponseTime = responseTime;
                service.metrics.averageResponseTime = 
                    (service.metrics.averageResponseTime * (service.metrics.successfulChecks - 1) + responseTime) / 
                    service.metrics.successfulChecks;

                return {
                    status: 'healthy',
                    responseTime,
                    message: result?.message || 'Service is healthy',
                    data: result?.data || null,
                    timestamp: service.lastCheck
                };

            } catch (error) {
                lastError = error;
                attempt++;
                
                if (attempt < service.retryAttempts) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
                }
            }
        }

        // All attempts failed
        const responseTime = performance.now() - startTime;
        service.lastCheck = new Date();
        service.status = 'unhealthy';
        service.consecutiveFailures++;
        service.metrics.totalChecks++;
        service.metrics.failedChecks++;
        service.metrics.lastResponseTime = responseTime;

        // Check if alert should be triggered
        if (service.consecutiveFailures >= this.config.alertThreshold && service.critical) {
            this.triggerAlert(serviceName, lastError);
        }

        return {
            status: 'unhealthy',
            responseTime,
            message: lastError?.message || 'Service health check failed',
            error: lastError?.stack,
            consecutiveFailures: service.consecutiveFailures,
            timestamp: service.lastCheck
        };
    }

    /**
     * Perform health check for all registered services
     */
    async checkAllServices() {
        const results = {};
        const promises = [];

        for (const [serviceName, service] of this.services) {
            if (service.enabled) {
                promises.push(
                    this.checkService(serviceName).then(result => {
                        results[serviceName] = result;
                    })
                );
            } else {
                results[serviceName] = { status: 'disabled' };
            }
        }

        await Promise.all(promises);

        // Update system metrics
        const systemMetrics = this.metrics.get('system');
        systemMetrics.lastHealthCheck = new Date();
        systemMetrics.healthCheckCount++;
        systemMetrics.uptime = process.uptime();
        systemMetrics.memory = process.memoryUsage();
        systemMetrics.cpu = process.cpuUsage();

        return {
            status: this.getOverallStatus(results),
            timestamp: systemMetrics.lastHealthCheck,
            services: results,
            system: {
                uptime: systemMetrics.uptime,
                memory: systemMetrics.memory,
                cpu: systemMetrics.cpu,
                startTime: new Date(systemMetrics.startTime),
                healthCheckCount: systemMetrics.healthCheckCount
            }
        };
    }

    /**
     * Get overall system status based on service results
     */
    getOverallStatus(serviceResults) {
        const statuses = Object.values(serviceResults).map(result => result.status);
        
        if (statuses.some(status => status === 'unhealthy')) {
            // Check if any critical services are unhealthy
            const criticalUnhealthy = Object.entries(serviceResults).some(([serviceName, result]) => {
                const service = this.services.get(serviceName);
                return service?.critical && result.status === 'unhealthy';
            });
            
            return criticalUnhealthy ? 'critical' : 'degraded';
        }
        
        if (statuses.every(status => status === 'healthy' || status === 'disabled')) {
            return 'healthy';
        }
        
        return 'unknown';
    }

    /**
     * Get service metrics
     */
    getServiceMetrics(serviceName) {
        const service = this.services.get(serviceName);
        if (!service) {
            throw new Error(`Service ${serviceName} not found`);
        }

        return {
            name: serviceName,
            status: service.status,
            lastCheck: service.lastCheck,
            consecutiveFailures: service.consecutiveFailures,
            metrics: service.metrics,
            enabled: service.enabled,
            critical: service.critical
        };
    }

    /**
     * Get all service metrics
     */
    getAllMetrics() {
        const serviceMetrics = {};
        
        for (const [serviceName] of this.services) {
            serviceMetrics[serviceName] = this.getServiceMetrics(serviceName);
        }

        return {
            system: this.metrics.get('system'),
            services: serviceMetrics,
            alerts: this.alerts.slice(-10) // Last 10 alerts
        };
    }

    /**
     * Trigger alert for service failure
     */
    triggerAlert(serviceName, error) {
        const alert = {
            id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            serviceName,
            type: 'service_failure',
            severity: 'high',
            message: `Service ${serviceName} has failed ${this.config.alertThreshold} consecutive times`,
            error: error?.message,
            timestamp: new Date(),
            resolved: false
        };

        this.alerts.push(alert);
        
        // Keep only recent alerts
        if (this.alerts.length > 100) {
            this.alerts = this.alerts.slice(-50);
        }

        // Emit alert event (can be extended to send notifications)
        this.onAlert(alert);
    }

    /**
     * Alert handler (override this method to implement custom alerting)
     */
    onAlert(alert) {
        console.error(`[ALERT] ${alert.message}`, {
            serviceName: alert.serviceName,
            error: alert.error,
            timestamp: alert.timestamp
        });
    }

    /**
     * Resolve an alert
     */
    resolveAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.resolved = true;
            alert.resolvedAt = new Date();
        }
    }

    /**
     * Get active (unresolved) alerts
     */
    getActiveAlerts() {
        return this.alerts.filter(alert => !alert.resolved);
    }

    /**
     * Enable/disable a service
     */
    setServiceEnabled(serviceName, enabled) {
        const service = this.services.get(serviceName);
        if (service) {
            service.enabled = enabled;
        }
    }

    /**
     * Reset service metrics
     */
    resetServiceMetrics(serviceName) {
        const service = this.services.get(serviceName);
        if (service) {
            service.metrics = {
                totalChecks: 0,
                successfulChecks: 0,
                failedChecks: 0,
                averageResponseTime: 0,
                lastResponseTime: 0
            };
            service.consecutiveFailures = 0;
        }
    }

    /**
     * Export health data for external monitoring systems
     */
    exportHealthData() {
        return {
            timestamp: new Date(),
            overall_status: this.getOverallStatus({}),
            services: Array.from(this.services.entries()).map(([name, service]) => ({
                name,
                status: service.status,
                enabled: service.enabled,
                critical: service.critical,
                last_check: service.lastCheck,
                consecutive_failures: service.consecutiveFailures,
                metrics: service.metrics
            })),
            system: this.metrics.get('system'),
            active_alerts: this.getActiveAlerts().length
        };
    }
}

module.exports = HealthCheckService;