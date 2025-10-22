const path = require('path');

/**
 * Production Configuration Service
 * Handles environment-specific configuration for production deployment
 */
class ProductionConfig {
    constructor() {
        this.environment = process.env.NODE_ENV || 'development';
        this.isProduction = this.environment === 'production';
        this.isDevelopment = this.environment === 'development';
    }

    /**
     * Get server configuration
     */
    getServerConfig() {
        return {
            port: parseInt(process.env.PORT) || 3000,
            environment: this.environment,
            cors: {
                origin: this.isProduction 
                    ? process.env.CORS_ORIGIN || false
                    : true,
                credentials: true
            },
            ssl: {
                enabled: process.env.SSL_ENABLED === 'true',
                certPath: process.env.SSL_CERT_PATH,
                keyPath: process.env.SSL_KEY_PATH
            }
        };
    }

    /**
     * Get database configuration with production optimizations
     */
    getDatabaseConfig() {
        return {
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: parseInt(process.env.DB_PORT) || 3306,
            dialect: 'mysql',
            logging: this.isProduction ? false : console.log,
            pool: {
                max: parseInt(process.env.DB_CONNECTION_LIMIT) || (this.isProduction ? 20 : 5),
                min: 0,
                acquire: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000,
                idle: parseInt(process.env.DB_TIMEOUT) || 60000
            },
            retry: {
                max: parseInt(process.env.DB_RETRY_MAX) || 3
            },
            dialectOptions: this.isProduction ? {
                connectTimeout: 60000,
                acquireTimeout: 60000,
                timeout: 60000
            } : {}
        };
    }

    /**
     * Get Wasender API configuration
     */
    getWasenderConfig() {
        const requiredFields = [
            'WASENDER_API_KEY',
            'WASENDER_PERSONAL_ACCESS_TOKEN',
            'WASENDER_WEBHOOK_SECRET'
            ]
;

        // Validate required environment variables in production
        if (this.isProduction) {
            const missing = requiredFields.filter(field => !process.env[field]);
            if (missing.length > 0) {
                throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
            }
        }

        return {
            apiKey: process.env.WASENDER_API_KEY,
            personalAccessToken: process.env.WASENDER_PERSONAL_ACCESS_TOKEN,
            webhookSecret: process.env.WASENDER_WEBHOOK_SECRET,
            baseURL: process.env.WASENDER_BASE_URL || 'https://wasenderapi.com',
            sessionName: process.env.WASENDER_SESSION_NAME || (this.isProduction ? 'production_group_monitor' : 'dev_group_monitor'),
            timeout: this.isProduction ? 30000 : 10000,
            retryAttempts: this.isProduction ? 3 : 1
        };
    }

    /**
     * Get webhook configuration
     */
    getWebhookConfig() {
        return {
            port: parseInt(process.env.WEBHOOK_PORT) || parseInt(process.env.PORT) || 3000,
            path: process.env.WEBHOOK_PATH || '/webhook/wasender',
            url: this.isProduction 
                ? process.env.WEBHOOK_URL 
                : null, // Will use ngrok in development
            rateLimiting: {
                windowMs: parseInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS) || 900000,
                max: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX_REQUESTS) || (this.isProduction ? 2000 : 1000)
            },
            security: {
                ipWhitelist: process.env.WEBHOOK_IP_WHITELIST 
                    ? process.env.WEBHOOK_IP_WHITELIST.split(',').map(ip => ip.trim())
                    : (this.isProduction ? [] : ['127.0.0.1', '::1'])
            }
        };
    }

    /**
     * Get file storage configuration
     */
    getStorageConfig() {
        const basePath = process.env.ATTACHMENT_PATH || (this.isProduction ? '/var/app/attachments/' : './attachments/');
        
        return {
            attachmentPath: basePath,
            backupPath: process.env.ATTACHMENT_BACKUP_PATH || path.join(basePath, 'backup'),
            maxFileSize: this.parseSize(process.env.MAX_FILE_SIZE) || (this.isProduction ? 100 * 1024 * 1024 : 50 * 1024 * 1024),
            allowedTypes: process.env.ALLOWED_MEDIA_TYPES 
                ? process.env.ALLOWED_MEDIA_TYPES.split(',').map(type => type.trim())
                : ['image', 'video', 'audio', 'document'],
            cleanup: {
                enabled: this.isProduction,
                retentionDays: this.isProduction ? 180 : 30,
                scheduleHour: 2 // 2 AM cleanup
            }
        };
    }

    /**
     * Get logging configuration
     */
    getLoggingConfig() {
        return {
            level: process.env.LOG_LEVEL || (this.isProduction ? 'warn' : 'info'),
            filePath: process.env.LOG_FILE_PATH || './logs/wasender-migration.log',
            errorFilePath: process.env.LOG_ERROR_FILE_PATH || './logs/wasender-migration-error.log',
            rotation: process.env.LOG_ROTATION || 'daily',
            maxFiles: parseInt(process.env.LOG_MAX_FILES) || (this.isProduction ? 90 : 30),
            maxSize: process.env.LOG_MAX_SIZE || (this.isProduction ? '100m' : '20m'),
            format: this.isProduction ? 'json' : 'simple'
        };
    }

    /**
     * Get session management configuration
     */
    getSessionConfig() {
        return {
            healthCheckInterval: parseInt(process.env.SESSION_HEALTH_CHECK_INTERVAL) || (this.isProduction ? 180000 : 300000),
            reconnectMaxAttempts: parseInt(process.env.SESSION_RECONNECT_MAX_ATTEMPTS) || (this.isProduction ? 10 : 5),
            reconnectDelay: parseInt(process.env.SESSION_RECONNECT_DELAY) || (this.isProduction ? 60000 : 30000),
            qrCodeTimeout: this.isProduction ? 120000 : 60000
        };
    }

    /**
     * Get monitoring configuration
     */
    getMonitoringConfig() {
        return {
            healthCheck: {
                enabled: process.env.HEALTH_CHECK_ENABLED === 'true' || this.isProduction,
                path: process.env.HEALTH_CHECK_PATH || '/health',
                timeout: 5000
            },
            metrics: {
                enabled: process.env.METRICS_ENABLED === 'true' || this.isProduction,
                path: process.env.METRICS_PATH || '/metrics'
            }
        };
    }

    /**
     * Get PM2 configuration for production
     */
    getPM2Config() {
        return {
            name: 'wasender-migration',
            script: 'src/index.js',
            instances: process.env.PM2_INSTANCES || 'max',
            exec_mode: 'cluster',
            max_memory_restart: process.env.PM2_MAX_MEMORY_RESTART || '1000M',
            log_date_format: process.env.PM2_LOG_DATE_FORMAT || 'YYYY-MM-DD HH:mm:ss Z',
            error_file: '/var/log/wasender-migration/pm2-error.log',
            out_file: '/var/log/wasender-migration/pm2-out.log',
            log_file: '/var/log/wasender-migration/pm2-combined.log',
            env: {
                NODE_ENV: 'production'
            },
            env_production: {
                NODE_ENV: 'production'
            }
        };
    }

    /**
     * Parse size string to bytes
     */
    parseSize(sizeStr) {
        if (!sizeStr) return null;
        
        const units = {
            'B': 1,
            'KB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024
        };
        
        const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([A-Z]{1,2})$/i);
        if (!match) return null;
        
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        
        return Math.floor(value * (units[unit] || 1));
    }

    /**
     * Validate production configuration
     */
    validateProductionConfig() {
        if (!this.isProduction) return { valid: true };

        const errors = [];
        
        try {
            this.getWasenderConfig();
        } catch (error) {
            errors.push(`Wasender Config: ${error.message}`);
        }

        const dbConfig = this.getDatabaseConfig();
        if (!dbConfig.host || !dbConfig.user || !dbConfig.password || !dbConfig.database) {
            errors.push('Database configuration incomplete');
        }

        const webhookConfig = this.getWebhookConfig();
        if (!webhookConfig.url) {
            errors.push('Production webhook URL not configured');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

module.exports = ProductionConfig;