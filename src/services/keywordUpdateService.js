/**
 * Keyword Update Service
 * 
 * Automatically fetches keyword data from API every 6 hours and updates the local JSON file
 * Only updates when there are actual changes to prevent unnecessary file writes and service reloads
 * 
 * Features:
 * - Scheduled API calls every 6 hours
 * - Smart change detection (only updates when data differs)
 * - Backup creation before updates
 * - Automatic service reload notification
 * - Comprehensive error handling and retry logic
 * - Detailed logging for monitoring
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const logger = require('./loggingService').getServiceLogger('keyword-update');

class KeywordUpdateService {
    constructor() {
        this.apiUrl = process.env.KEYWORD_API_URL || '94.136.189.241:2121/api/data/get-Keywords';
        this.jsonFilePath = path.join(process.cwd(), 'youtube_matrix_keywords.json');
        this.backupDir = path.join(process.cwd(), 'backups');
        this.updateInterval = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
        this.intervalId = null;
        this.isRunning = false;
        this.lastUpdateTime = null;
        this.lastDataHash = null;

        // Retry configuration
        this.maxRetries = 3;
        this.retryDelay = 5000; // 5 seconds

        // Statistics
        this.stats = {
            totalFetches: 0,
            successfulFetches: 0,
            failedFetches: 0,
            updatesApplied: 0,
            noChangeSkips: 0,
            lastError: null,
            lastSuccessTime: null,
            lastUpdateTime: null
        };

        logger.info('KeywordUpdateService initialized', {
            apiUrl: this.apiUrl,
            updateInterval: `${this.updateInterval / 1000 / 60 / 60} hours`,
            jsonFilePath: this.jsonFilePath
        });
    }

    /**
     * Start the scheduled keyword update service
     */
    async start() {
        if (this.isRunning) {
            logger.warn('KeywordUpdateService is already running');
            return;
        }

        try {
            // Ensure backup directory exists
            await this.ensureBackupDirectory();

            // Calculate initial hash of current data
            await this.calculateCurrentDataHash();

            // Perform initial update check
            logger.info('Performing initial keyword update check...');
            await this.performUpdate();

            // Start scheduled updates
            this.intervalId = setInterval(() => {
                this.performUpdate().catch(error => {
                    logger.error('Scheduled update failed', {
                        error: error.message,
                        stack: error.stack
                    });
                });
            }, this.updateInterval);

            this.isRunning = true;

            logger.info('KeywordUpdateService started successfully', {
                nextUpdateIn: `${this.updateInterval / 1000 / 60} minutes`,
                initialDataHash: this.lastDataHash?.substring(0, 8)
            });

        } catch (error) {
            logger.error('Failed to start KeywordUpdateService', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Stop the scheduled keyword update service
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;

        logger.info('KeywordUpdateService stopped', {
            totalFetches: this.stats.totalFetches,
            updatesApplied: this.stats.updatesApplied,
            lastUpdateTime: this.stats.lastUpdateTime
        });
    }

    /**
     * Perform keyword update check and apply if necessary
     */
    async performUpdate() {
        const startTime = Date.now();
        this.stats.totalFetches++;

        try {
            logger.info('Starting keyword update check', {
                attempt: this.stats.totalFetches,
                lastUpdate: this.stats.lastUpdateTime
            });

            // Fetch data from API with retry logic
            const apiData = await this.fetchKeywordsFromAPI();

            // Calculate hash of new data
            const newDataHash = this.calculateDataHash(apiData);

            // Check if data has changed
            if (this.lastDataHash && newDataHash === this.lastDataHash) {
                this.stats.noChangeSkips++;
                logger.info('No changes detected in keyword data - skipping update', {
                    currentHash: this.lastDataHash.substring(0, 8),
                    newHash: newDataHash.substring(0, 8),
                    noChangeSkips: this.stats.noChangeSkips
                });
                return { updated: false, reason: 'no_changes' };
            }

            // Data has changed - proceed with update
            logger.info('Changes detected in keyword data - proceeding with update', {
                oldHash: this.lastDataHash?.substring(0, 8) || 'none',
                newHash: newDataHash.substring(0, 8),
                recordCount: apiData.length
            });

            // Create backup of current file
            await this.createBackup();

            // Update the JSON file
            await this.updateJsonFile(apiData);

            // Update tracking variables
            this.lastDataHash = newDataHash;
            this.lastUpdateTime = new Date();
            this.stats.updatesApplied++;
            this.stats.successfulFetches++;
            this.stats.lastSuccessTime = new Date();

            const processingTime = Date.now() - startTime;

            logger.info('Keyword data updated successfully', {
                recordCount: apiData.length,
                newHash: newDataHash.substring(0, 8),
                processingTime: `${processingTime}ms`,
                updatesApplied: this.stats.updatesApplied
            });

            // Notify about the update (for service reloads)
            await this.notifyServicesOfUpdate();

            return {
                updated: true,
                recordCount: apiData.length,
                newHash: newDataHash,
                processingTime
            };

        } catch (error) {
            this.stats.failedFetches++;
            this.stats.lastError = {
                message: error.message,
                time: new Date(),
                stack: error.stack
            };

            logger.error('Keyword update failed', {
                error: error.message,
                attempt: this.stats.totalFetches,
                failedFetches: this.stats.failedFetches,
                stack: error.stack
            });

            throw error;
        }
    }

    /**
     * Fetch keywords from API with retry logic
     */
    async fetchKeywordsFromAPI() {
        let lastError;

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                logger.debug('Fetching keywords from API', {
                    url: this.apiUrl,
                    attempt,
                    maxRetries: this.maxRetries
                });

                const response = await axios.get(`http://${this.apiUrl}`, {
                    timeout: 30000, // 30 second timeout
                    headers: {
                        'User-Agent': 'WhatsApp-Keyword-Updater/1.0',
                        'Accept': 'application/json'
                    }
                });

                if (response.status !== 200) {
                    throw new Error(`API returned status ${response.status}`);
                }

                const data = response.data;

                // Validate response data
                if (!Array.isArray(data)) {
                    throw new Error('API response is not an array');
                }

                if (data.length === 0) {
                    throw new Error('API returned empty data array');
                }

                // Validate data structure
                this.validateApiData(data);

                logger.info('Successfully fetched keywords from API', {
                    recordCount: data.length,
                    attempt,
                    responseSize: JSON.stringify(data).length
                });

                return data;

            } catch (error) {
                lastError = error;

                logger.warn('API fetch attempt failed', {
                    attempt,
                    maxRetries: this.maxRetries,
                    error: error.message,
                    willRetry: attempt < this.maxRetries
                });

                if (attempt < this.maxRetries) {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                }
            }
        }

        throw new Error(`Failed to fetch keywords after ${this.maxRetries} attempts. Last error: ${lastError.message}`);
    }

    /**
     * Validate API data structure
     */
    validateApiData(data) {
        const requiredFields = ['id', 'hindiKeyword', 'englishKeyword', 'hinglishKeyword'];

        for (let i = 0; i < Math.min(data.length, 5); i++) { // Check first 5 records
            const record = data[i];

            for (const field of requiredFields) {
                if (!(field in record)) {
                    throw new Error(`Missing required field '${field}' in API data record ${i}`);
                }
            }
        }

        logger.debug('API data validation passed', {
            recordCount: data.length,
            sampleRecord: {
                id: data[0].id,
                hasHindi: !!data[0].hindiKeyword,
                hasEnglish: !!data[0].englishKeyword,
                hasHinglish: !!data[0].hinglishKeyword
            }
        });
    }

    /**
     * Calculate hash of data for change detection
     */
    calculateDataHash(data) {
        // Sort data by id to ensure consistent hashing
        const sortedData = [...data].sort((a, b) => a.id - b.id);

        // Create hash based on relevant fields only
        const hashData = sortedData.map(item => ({
            id: item.id,
            hindiKeyword: item.hindiKeyword || '',
            englishKeyword: item.englishKeyword || '',
            hinglishKeyword: item.hinglishKeyword || ''
        }));

        return crypto.createHash('sha256')
            .update(JSON.stringify(hashData))
            .digest('hex');
    }

    /**
     * Calculate hash of current JSON file data
     */
    async calculateCurrentDataHash() {
        try {
            const currentData = await fs.readFile(this.jsonFilePath, 'utf8');
            const parsedData = JSON.parse(currentData);
            this.lastDataHash = this.calculateDataHash(parsedData);

            logger.debug('Calculated current data hash', {
                hash: this.lastDataHash.substring(0, 8),
                recordCount: parsedData.length
            });
        } catch (error) {
            logger.warn('Could not calculate current data hash', {
                error: error.message,
                filePath: this.jsonFilePath
            });
            this.lastDataHash = null;
        }
    }

    /**
     * Create backup of current JSON file
     */
    async createBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFileName = `youtube_matrix_keywords_backup_${timestamp}.json`;
            const backupPath = path.join(this.backupDir, backupFileName);

            // Read current file
            const currentData = await fs.readFile(this.jsonFilePath, 'utf8');

            // Write backup
            await fs.writeFile(backupPath, currentData, 'utf8');

            logger.info('Backup created successfully', {
                backupPath,
                timestamp
            });

            // Clean old backups (keep only last 10)
            await this.cleanOldBackups();

        } catch (error) {
            logger.error('Failed to create backup', {
                error: error.message,
                backupDir: this.backupDir
            });
            // Don't throw - backup failure shouldn't stop the update
        }
    }

    /**
     * Clean old backup files (keep only last 10)
     */
    async cleanOldBackups() {
        try {
            const files = await fs.readdir(this.backupDir);
            const backupFiles = files
                .filter(file => file.startsWith('youtube_matrix_keywords_backup_'))
                .map(file => ({
                    name: file,
                    path: path.join(this.backupDir, file),
                    time: fs.stat(path.join(this.backupDir, file)).then(stats => stats.mtime)
                }));

            // Sort by modification time (newest first)
            const sortedFiles = await Promise.all(
                backupFiles.map(async file => ({
                    ...file,
                    time: await file.time
                }))
            );

            sortedFiles.sort((a, b) => b.time - a.time);

            // Delete files beyond the 10 most recent
            const filesToDelete = sortedFiles.slice(10);

            for (const file of filesToDelete) {
                await fs.unlink(file.path);
                logger.debug('Deleted old backup', { fileName: file.name });
            }

            if (filesToDelete.length > 0) {
                logger.info('Cleaned old backups', {
                    deletedCount: filesToDelete.length,
                    remainingCount: sortedFiles.length - filesToDelete.length
                });
            }

        } catch (error) {
            logger.warn('Failed to clean old backups', {
                error: error.message
            });
        }
    }

    /**
     * Update the JSON file with new data
     */
    async updateJsonFile(newData) {
        const tempFilePath = this.jsonFilePath + '.tmp';
        
        try {
            // Format the JSON with proper indentation
            const jsonContent = JSON.stringify(newData, null, 2);
            
            // Write to temporary file first (atomic operation)
            await fs.writeFile(tempFilePath, jsonContent, 'utf8');
            
            // Verify the temporary file was written correctly
            const writtenContent = await fs.readFile(tempFilePath, 'utf8');
            const parsedContent = JSON.parse(writtenContent);
            
            if (!Array.isArray(parsedContent) || parsedContent.length !== newData.length) {
                throw new Error('Temporary file verification failed');
            }
            
            // Atomic move: rename temp file to actual file
            await fs.rename(tempFilePath, this.jsonFilePath);

            logger.info('JSON file updated successfully with atomic operation', {
                filePath: this.jsonFilePath,
                recordCount: newData.length,
                fileSize: jsonContent.length,
                atomicUpdate: true
            });

        } catch (error) {
            // Clean up temporary file if it exists
            try {
                await fs.unlink(tempFilePath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
            
            logger.error('Failed to update JSON file', {
                error: error.message,
                filePath: this.jsonFilePath,
                tempFilePath,
                atomicUpdate: false
            });
            throw error;
        }
    }

    /**
     * Ensure backup directory exists
     */
    async ensureBackupDirectory() {
        try {
            await fs.mkdir(this.backupDir, { recursive: true });
            logger.debug('Backup directory ensured', { backupDir: this.backupDir });
        } catch (error) {
            logger.error('Failed to create backup directory', {
                error: error.message,
                backupDir: this.backupDir
            });
            throw error;
        }
    }

    /**
     * Notify services about keyword data update
     * This allows services to reload their keyword data
     */
    async notifyServicesOfUpdate() {
        try {
            // Create a simple notification file that services can watch
            const notificationPath = path.join(process.cwd(), '.keyword_update_notification');
            const notificationData = {
                timestamp: new Date().toISOString(),
                updateCount: this.stats.updatesApplied,
                dataHash: this.lastDataHash
            };

            await fs.writeFile(notificationPath, JSON.stringify(notificationData), 'utf8');

            logger.info('Services notified of keyword update', {
                notificationPath,
                updateCount: this.stats.updatesApplied
            });

        } catch (error) {
            logger.warn('Failed to notify services of update', {
                error: error.message
            });
        }
    }

    /**
     * Force an immediate update check (for manual triggers)
     */
    async forceUpdate() {
        logger.info('Force update requested');
        return await this.performUpdate();
    }

    /**
     * Get service statistics
     */
    getStats() {
        return {
            ...this.stats,
            isRunning: this.isRunning,
            nextUpdateIn: this.isRunning ?
                Math.max(0, this.updateInterval - (Date.now() - (this.stats.lastSuccessTime?.getTime() || 0))) : null,
            currentDataHash: this.lastDataHash?.substring(0, 8),
            apiUrl: this.apiUrl,
            updateInterval: this.updateInterval
        };
    }

    /**
     * Health check for the service
     */
    healthCheck() {
        const now = Date.now();
        const lastSuccessAge = this.stats.lastSuccessTime ?
            now - this.stats.lastSuccessTime.getTime() : null;

        // Consider unhealthy if no successful fetch in last 8 hours
        const isHealthy = !lastSuccessAge || lastSuccessAge < (8 * 60 * 60 * 1000);

        return {
            status: isHealthy ? 'healthy' : 'degraded',
            isRunning: this.isRunning,
            lastSuccessAge: lastSuccessAge ? `${Math.round(lastSuccessAge / 1000 / 60)} minutes ago` : 'never',
            stats: this.getStats(),
            issues: [
                ...(this.isRunning ? [] : ['Service not running']),
                ...(lastSuccessAge && lastSuccessAge > (8 * 60 * 60 * 1000) ? ['No successful update in over 8 hours'] : []),
                ...(this.stats.lastError ? [`Last error: ${this.stats.lastError.message}`] : [])
            ]
        };
    }
}

module.exports = KeywordUpdateService;