const express = require('express');
const router = express.Router();

/**
 * Health Check and Monitoring Routes
 * Provides endpoints for system health monitoring and metrics
 */

let monitoringService = null;

// Initialize monitoring service
const initializeMonitoring = () => {
    if (!monitoringService) {
        const MonitoringService = require('../services/monitoringService');
        monitoringService = new MonitoringService();
    }
    return monitoringService;
};

/**
 * Basic health check endpoint
 * Returns simple OK status for load balancers
 */
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0'
    });
});

/**
 * Detailed health check endpoint
 * Returns comprehensive health status of all services
 */
router.get('/health/detailed', async (req, res) => {
    try {
        const monitoring = initializeMonitoring();
        const healthStatus = await monitoring.getHealthStatus();
        
        const statusCode = healthStatus.status === 'healthy' ? 200 : 
                          healthStatus.status === 'degraded' ? 200 : 503;
        
        res.status(statusCode).json({
            ...healthStatus,
            version: process.env.npm_package_version || '1.0.0'
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Health check failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Service-specific health check
 * Returns health status for a specific service
 */
router.get('/health/service/:serviceName', async (req, res) => {
    try {
        const { serviceName } = req.params;
        const monitoring = initializeMonitoring();
        const serviceHealth = await monitoring.checkService(serviceName);
        
        const statusCode = serviceHealth.status === 'healthy' ? 200 : 503;
        
        res.status(statusCode).json({
            service: serviceName,
            ...serviceHealth
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: `Health check failed for service: ${req.params.serviceName}`,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * System metrics endpoint
 * Returns detailed system and service metrics
 */
router.get('/metrics', (req, res) => {
    try {
        const monitoring = initializeMonitoring();
        const metrics = monitoring.getMetrics();
        
        res.status(200).json({
            ...metrics,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve metrics',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Prometheus-compatible metrics endpoint
 * Returns metrics in Prometheus format
 */
router.get('/metrics/prometheus', (req, res) => {
    try {
        const monitoring = initializeMonitoring();
        const metrics = monitoring.getMetrics();
        
        let prometheusMetrics = '';
        
        // System metrics
        prometheusMetrics += `# HELP wasender_uptime_seconds System uptime in seconds\n`;
        prometheusMetrics += `# TYPE wasender_uptime_seconds counter\n`;
        prometheusMetrics += `wasender_uptime_seconds ${metrics.system.uptime}\n\n`;
        
        prometheusMetrics += `# HELP wasender_memory_usage_bytes Memory usage in bytes\n`;
        prometheusMetrics += `# TYPE wasender_memory_usage_bytes gauge\n`;
        prometheusMetrics += `wasender_memory_usage_bytes{type="heap_used"} ${metrics.system.memory.heapUsed}\n`;
        prometheusMetrics += `wasender_memory_usage_bytes{type="heap_total"} ${metrics.system.memory.heapTotal}\n`;
        prometheusMetrics += `wasender_memory_usage_bytes{type="rss"} ${metrics.system.memory.rss}\n\n`;
        
        prometheusMetrics += `# HELP wasender_health_checks_total Total number of health checks performed\n`;
        prometheusMetrics += `# TYPE wasender_health_checks_total counter\n`;
        prometheusMetrics += `wasender_health_checks_total ${metrics.system.healthCheckCount}\n\n`;
        
        // Service metrics
        Object.entries(metrics.services).forEach(([serviceName, serviceMetrics]) => {
            prometheusMetrics += `# HELP wasender_service_status Service status (1=healthy, 0=unhealthy)\n`;
            prometheusMetrics += `# TYPE wasender_service_status gauge\n`;
            prometheusMetrics += `wasender_service_status{service="${serviceName}"} ${serviceMetrics.status === 'healthy' ? 1 : 0}\n\n`;
            
            prometheusMetrics += `# HELP wasender_service_checks_total Total service health checks\n`;
            prometheusMetrics += `# TYPE wasender_service_checks_total counter\n`;
            prometheusMetrics += `wasender_service_checks_total{service="${serviceName}"} ${serviceMetrics.metrics.totalChecks}\n\n`;
            
            prometheusMetrics += `# HELP wasender_service_failures_total Total service health check failures\n`;
            prometheusMetrics += `# TYPE wasender_service_failures_total counter\n`;
            prometheusMetrics += `wasender_service_failures_total{service="${serviceName}"} ${serviceMetrics.metrics.failedChecks}\n\n`;
            
            if (serviceMetrics.metrics.averageResponseTime > 0) {
                prometheusMetrics += `# HELP wasender_service_response_time_ms Average service response time in milliseconds\n`;
                prometheusMetrics += `# TYPE wasender_service_response_time_ms gauge\n`;
                prometheusMetrics += `wasender_service_response_time_ms{service="${serviceName}"} ${serviceMetrics.metrics.averageResponseTime}\n\n`;
            }
        });
        
        // Active alerts
        prometheusMetrics += `# HELP wasender_active_alerts_total Number of active alerts\n`;
        prometheusMetrics += `# TYPE wasender_active_alerts_total gauge\n`;
        prometheusMetrics += `wasender_active_alerts_total ${metrics.alerts.filter(alert => !alert.resolved).length}\n\n`;
        
        res.set('Content-Type', 'text/plain');
        res.status(200).send(prometheusMetrics);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to generate Prometheus metrics',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Active alerts endpoint
 * Returns current active alerts
 */
router.get('/alerts', (req, res) => {
    try {
        const monitoring = initializeMonitoring();
        const alerts = monitoring.getActiveAlerts();
        
        res.status(200).json({
            alerts,
            count: alerts.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve alerts',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Service control endpoint
 * Enable/disable monitoring for specific services
 */
router.post('/service/:serviceName/toggle', (req, res) => {
    try {
        const { serviceName } = req.params;
        const { enabled } = req.body;
        
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({
                status: 'error',
                message: 'enabled field must be a boolean'
            });
        }
        
        const monitoring = initializeMonitoring();
        monitoring.setServiceEnabled(serviceName, enabled);
        
        res.status(200).json({
            status: 'success',
            message: `Service ${serviceName} ${enabled ? 'enabled' : 'disabled'}`,
            service: serviceName,
            enabled,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to toggle service',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Export monitoring data
 * Returns complete monitoring data for external systems
 */
router.get('/export', (req, res) => {
    try {
        const monitoring = initializeMonitoring();
        const exportData = monitoring.exportData();
        
        res.status(200).json(exportData);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Failed to export monitoring data',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Readiness probe endpoint
 * Returns 200 when all critical services are healthy
 */
router.get('/ready', async (req, res) => {
    try {
        const monitoring = initializeMonitoring();
        const healthStatus = await monitoring.getHealthStatus();
        
        // Check if any critical services are unhealthy
        const criticalServicesUnhealthy = Object.entries(healthStatus.services).some(([serviceName, result]) => {
            const service = monitoring.healthCheck.services.get(serviceName);
            return service?.critical && result.status === 'unhealthy';
        });
        
        if (criticalServicesUnhealthy) {
            return res.status(503).json({
                status: 'not_ready',
                message: 'Critical services are unhealthy',
                timestamp: new Date().toISOString()
            });
        }
        
        res.status(200).json({
            status: 'ready',
            message: 'All critical services are healthy',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'not_ready',
            message: 'Readiness check failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * Liveness probe endpoint
 * Returns 200 if the application is running
 */
router.get('/live', (req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        pid: process.pid
    });
});

module.exports = router;