/**
 * Comprehensive Logging Service
 * Provides structured logging with Winston for all Wasender services
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

class LoggingService {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'info';
        this.logFilePath = process.env.LOG_FILE_PATH || './logs/wasender-migration.log';
        this.logRotation = process.env.LOG_ROTATION || 'daily';
        this.maxFiles = process.env.LOG_MAX_FILES || '30';
        
        // Ensure logs directory exists
        this.ensureLogDirectory();
        
        // Create logger instance
        this.logger = this.createLogger();
        
        // Create service-specific loggers
        this.serviceLoggers = this.createServiceLoggers();
    }

    /**
     * Ensure log directory exists
     */
    ensureLogDirectory() {
        const logDir = path.dirname(this.logFilePath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    /**
     * Create main logger instance
     */
    createLogger() {
        const logger = winston.createLogger({
            level: this.logLevel,
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.errors({ stack: true }),
                winston.format.json(),
                winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
                    const serviceTag = service ? `[${service}]` : '';
                    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
                    return `${timestamp} ${level.toUpperCase()} ${serviceTag} ${message} ${metaStr}`;
                })
            ),
            defaultMeta: { service: 'wasender-migration' },
            transports: [
                // Console transport for development
                new winston.transports.Console({
                    format: winston.format.combine(
                        winston.format.colorize(),
                        winston.format.simple()
                    )
                }),
                
                // Daily rotate file transport
                new DailyRotateFile({
                    filename: this.logFilePath.replace('.log', '-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    zippedArchive: true,
                    maxSize: '20m',
                    maxFiles: this.maxFiles
                }),
                
                // Error-only file transport
                new DailyRotateFile({
                    filename: this.logFilePath.replace('.log', '-error-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    level: 'error',
                    zippedArchive: true,
                    maxSize: '20m',
                    maxFiles: this.maxFiles
                })
            ]
        });

        // Handle logging errors
        logger.on('error', (error) => {
            console.error('Logger error:', error);
        });

        return logger;
    }

    /**
     * Create service-specific loggers
     */
    createServiceLoggers() {
        const services = [
            'webhook',
            'media',
            'database',
            'session',
            'ngrok',
            'wasender-client'
        ];

        const serviceLoggers = {};

        services.forEach(service => {
            serviceLoggers[service] = this.logger.child({ service });
        });

        return serviceLoggers;
    }

    /**
     * Get service-specific logger
     */
    getServiceLogger(serviceName) {
        return this.serviceLoggers[serviceName] || this.logger.child({ service: serviceName });
    }

    /**
     * Main logger methods
     */
    info(message, meta = {}) {
        this.logger.info(message, meta);
    }

    error(message, meta = {}) {
        this.logger.error(message, meta);
    }

    warn(message, meta = {}) {
        this.logger.warn(message, meta);
    }

    debug(message, meta = {}) {
        this.logger.debug(message, meta);
    }

    /**
     * Log API request/response
     */
    logApiCall(method, url, requestData, responseData, responseTime) {
        this.info('API Call', {
            method,
            url,
            requestSize: requestData ? JSON.stringify(requestData).length : 0,
            responseSize: responseData ? JSON.stringify(responseData).length : 0,
            responseTime: `${responseTime}ms`
        });
    }

    /**
     * Log webhook event
     */
    logWebhookEvent(eventType, payloadSize, processingTime, success = true) {
        const level = success ? 'info' : 'error';
        this[level]('Webhook Event Processed', {
            eventType,
            payloadSize,
            processingTime: `${processingTime}ms`,
            success
        });
    }

    /**
     * Log database operation
     */
    logDatabaseOperation(operation, table, recordId, success = true, error = null) {
        const level = success ? 'info' : 'error';
        const meta = {
            operation,
            table,
            recordId,
            success
        };

        if (error) {
            meta.error = error.message;
            meta.stack = error.stack;
        }

        this[level]('Database Operation', meta);
    }

    /**
     * Log media processing
     */
    logMediaProcessing(mediaType, fileSize, processingTime, success = true, error = null) {
        const level = success ? 'info' : 'error';
        const meta = {
            mediaType,
            fileSize,
            processingTime: `${processingTime}ms`,
            success
        };

        if (error) {
            meta.error = error.message;
        }

        this[level]('Media Processing', meta);
    }

    /**
     * Log session event
     */
    logSessionEvent(sessionId, event, status, message = null) {
        this.info('Session Event', {
            sessionId,
            event,
            status,
            message
        });
    }

    /**
     * Log performance metrics
     */
    logPerformanceMetrics(metrics) {
        this.info('Performance Metrics', metrics);
    }

    /**
     * Log system health
     */
    logSystemHealth(healthData) {
        this.info('System Health Check', healthData);
    }
}

// Create singleton instance
const loggingService = new LoggingService();

// Export both the service instance and individual logger methods for convenience
module.exports = loggingService.logger;
module.exports.service = loggingService;
module.exports.getServiceLogger = (serviceName) => loggingService.getServiceLogger(serviceName);
module.exports.logApiCall = (...args) => loggingService.logApiCall(...args);
module.exports.logWebhookEvent = (...args) => loggingService.logWebhookEvent(...args);
module.exports.logDatabaseOperation = (...args) => loggingService.logDatabaseOperation(...args);
module.exports.logMediaProcessing = (...args) => loggingService.logMediaProcessing(...args);
module.exports.logSessionEvent = (...args) => loggingService.logSessionEvent(...args);
module.exports.logPerformanceMetrics = (...args) => loggingService.logPerformanceMetrics(...args);
module.exports.logSystemHealth = (...args) => loggingService.logSystemHealth(...args);