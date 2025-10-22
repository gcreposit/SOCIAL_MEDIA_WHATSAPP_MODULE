/**
 * Media File Manager for Wasender API Migration
 * Comprehensive service that integrates FileDownloadManager, MediaDecryptionService, and AttachmentProcessingService
 * Provides unified interface for media download, decryption, storage, and maintenance
 * Requirements: 4.1, 4.2, 4.3
 */

const FileDownloadManager = require('./fileDownloadManager');
const MediaDecryptionService = require('./mediaDecryptionService');
const AttachmentProcessingService = require('./attachmentProcessingService');
const { getServiceLogger } = require('./loggingService');

class MediaFileManager {
    constructor(databaseService = null, wasenderClient = null) {
        this.databaseService = databaseService;
        this.wasenderClient = wasenderClient;
        this.logger = getServiceLogger('media-file-manager');
        
        // Initialize core services
        this.fileDownloadManager = new FileDownloadManager();
        this.mediaDecryptionService = new MediaDecryptionService(wasenderClient);
        this.attachmentProcessingService = new AttachmentProcessingService(
            databaseService,
            this.mediaDecryptionService
        );
        
        // Service integration
        this.integrateServices();
        
        this.logger.info('MediaFileManager initialized with all services integrated');
    }

    /**
     * Integrate all services for optimal functionality
     */
    integrateServices() {
        // Ensure MediaDecryptionService uses the same FileDownloadManager instance
        this.mediaDecryptionService.fileDownloadManager = this.fileDownloadManager;
        
        // Ensure AttachmentProcessingService has access to MediaDecryptionService
        this.attachmentProcessingService.mediaDecryptionService = this.mediaDecryptionService;
        
        this.logger.debug('Services integrated successfully');
    }

    /**
     * Complete media processing workflow
     * Downloads, decrypts, and stores media with full error handling
     */
    async processMediaComplete(mediaUrl, mediaKey, mediaType, metadata = {}, storageOptions = {}) {
        const startTime = Date.now();
        const processId = require('crypto').randomBytes(8).toString('hex');
        
        try {
            this.logger.info('Starting complete media processing', {
                processId,
                mediaType,
                mediaUrl: this.sanitizeUrl(mediaUrl),
                hasMetadata: Object.keys(metadata).length > 0
            });

            // Step 1: Download encrypted media
            this.logger.debug('Step 1: Downloading encrypted media', { processId });
            const encryptedData = await this.fileDownloadManager.downloadEncryptedMedia(mediaUrl, {
                expectedContentType: this.getExpectedContentType(mediaType),
                maxSize: this.mediaDecryptionService.maxFileSize
            });

            // Step 2: Decrypt media using Wasender API
            this.logger.debug('Step 2: Decrypting media', { processId });
            const decryptionResult = await this.mediaDecryptionService.decryptMedia(
                mediaUrl,
                mediaKey,
                mediaType,
                metadata
            );

            if (!decryptionResult.success) {
                throw new Error(`Media decryption failed: ${decryptionResult.error}`);
            }

            // Step 3: Store with organized structure if storage options provided
            let finalResult = decryptionResult;
            
            if (storageOptions.postBankId && storageOptions.groupInfo) {
                this.logger.debug('Step 3: Processing attachment for database storage', { processId });
                
                const attachmentData = {
                    type: mediaType,
                    mimeType: metadata.mimeType,
                    fileName: metadata.fileName || decryptionResult.fileName,
                    data: await this.readDecryptedFile(decryptionResult.filePath),
                    ...metadata
                };

                const attachmentResult = await this.attachmentProcessingService.processAndStoreAttachment(
                    attachmentData,
                    storageOptions.postBankId,
                    storageOptions.groupInfo,
                    storageOptions.userInfo,
                    storageOptions.transaction
                );

                finalResult = {
                    ...decryptionResult,
                    attachmentProcessing: attachmentResult
                };
            }

            const processingTime = Date.now() - startTime;

            this.logger.info('Complete media processing finished successfully', {
                processId,
                mediaType,
                processingTime: `${processingTime}ms`,
                fileSize: decryptionResult.fileSize,
                filePath: decryptionResult.filePath
            });

            return {
                success: true,
                processId,
                mediaType,
                filePath: decryptionResult.filePath,
                fileName: decryptionResult.fileName,
                fileSize: decryptionResult.fileSize,
                processingTime,
                attachmentId: finalResult.attachmentProcessing?.attachmentId,
                ...finalResult
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.logger.error('Complete media processing failed', {
                processId,
                mediaType,
                error: error.message,
                stack: error.stack,
                processingTime: `${processingTime}ms`
            });

            return {
                success: false,
                processId,
                mediaType,
                error: error.message,
                processingTime
            };
        }
    }

    /**
     * Batch process multiple media files
     */
    async processMultipleMedia(mediaItems, storageOptions = {}) {
        const startTime = Date.now();
        const batchId = require('crypto').randomBytes(8).toString('hex');
        
        try {
            this.logger.info('Starting batch media processing', {
                batchId,
                itemCount: mediaItems.length
            });

            const results = [];
            const concurrencyLimit = parseInt(process.env.MEDIA_PROCESSING_CONCURRENCY || '3');
            
            // Process in batches to avoid overwhelming the system
            for (let i = 0; i < mediaItems.length; i += concurrencyLimit) {
                const batch = mediaItems.slice(i, i + concurrencyLimit);
                
                const batchPromises = batch.map(async (item, index) => {
                    try {
                        const result = await this.processMediaComplete(
                            item.mediaUrl,
                            item.mediaKey,
                            item.mediaType,
                            item.metadata || {},
                            {
                                ...storageOptions,
                                postBankId: storageOptions.postBankId,
                                groupInfo: storageOptions.groupInfo,
                                userInfo: storageOptions.userInfo,
                                transaction: storageOptions.transaction
                            }
                        );
                        
                        return { index: i + index, ...result };
                    } catch (error) {
                        return {
                            index: i + index,
                            success: false,
                            error: error.message,
                            mediaType: item.mediaType
                        };
                    }
                });

                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);

                this.logger.debug('Batch processed', {
                    batchId,
                    batchNumber: Math.floor(i / concurrencyLimit) + 1,
                    batchSize: batch.length
                });
            }

            const processingTime = Date.now() - startTime;
            const successCount = results.filter(r => r.success).length;
            const failedCount = results.filter(r => !r.success).length;

            this.logger.info('Batch media processing completed', {
                batchId,
                totalItems: mediaItems.length,
                successCount,
                failedCount,
                processingTime: `${processingTime}ms`
            });

            return {
                success: true,
                batchId,
                totalItems: mediaItems.length,
                successCount,
                failedCount,
                results,
                processingTime
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.logger.error('Batch media processing failed', {
                batchId,
                error: error.message,
                processingTime: `${processingTime}ms`
            });

            return {
                success: false,
                batchId,
                error: error.message,
                processingTime
            };
        }
    }

    /**
     * Comprehensive cleanup with advanced options
     */
    async performComprehensiveCleanup(options = {}) {
        const startTime = Date.now();
        const cleanupId = require('crypto').randomBytes(8).toString('hex');
        
        try {
            this.logger.info('Starting comprehensive cleanup', {
                cleanupId,
                options
            });

            // Get cleanup statistics before cleanup
            const beforeStats = await this.getCleanupStatistics();

            // Perform cleanup using FileDownloadManager's advanced cleanup
            const cleanupResult = await this.fileDownloadManager.cleanupOldMediaFiles({
                olderThanDays: options.olderThanDays || 30,
                dryRun: options.dryRun || false,
                maxFilesToDelete: options.maxFilesToDelete || 1000,
                excludePatterns: options.excludePatterns || [],
                includeEmptyDirectories: options.includeEmptyDirectories !== false,
                ...options
            });

            // Get cleanup statistics after cleanup
            const afterStats = await this.getCleanupStatistics();

            const processingTime = Date.now() - startTime;

            const result = {
                success: true,
                cleanupId,
                ...cleanupResult,
                beforeStats,
                afterStats,
                processingTime
            };

            this.logger.info('Comprehensive cleanup completed', result);
            return result;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.logger.error('Comprehensive cleanup failed', {
                cleanupId,
                error: error.message,
                processingTime: `${processingTime}ms`
            });

            return {
                success: false,
                cleanupId,
                error: error.message,
                processingTime
            };
        }
    }

    /**
     * File integrity verification
     */
    async verifyFileIntegrity(filePath, expectedHash = null) {
        try {
            const fileInfo = await this.fileDownloadManager.getFileInfo(filePath);
            
            if (!fileInfo.exists) {
                return {
                    valid: false,
                    error: 'File does not exist',
                    filePath
                };
            }

            const result = {
                valid: true,
                filePath,
                fileSize: fileInfo.size,
                lastModified: fileInfo.modified,
                created: fileInfo.created
            };

            // Verify hash if provided
            if (expectedHash) {
                const fs = require('fs');
                const crypto = require('crypto');
                
                const data = await fs.promises.readFile(filePath);
                const actualHash = crypto.createHash('sha256').update(data).digest('hex');
                
                result.hashValid = actualHash === expectedHash;
                result.actualHash = actualHash;
                result.expectedHash = expectedHash;
                
                if (!result.hashValid) {
                    result.valid = false;
                    result.error = 'Hash verification failed';
                }
            }

            return result;

        } catch (error) {
            return {
                valid: false,
                error: error.message,
                filePath
            };
        }
    }

    /**
     * Get comprehensive statistics
     */
    async getComprehensiveStatistics() {
        try {
            const downloadStats = this.fileDownloadManager.getDownloadStatistics();
            const cleanupStats = await this.getCleanupStatistics();
            const healthStatus = this.getHealthStatus();

            return {
                download: downloadStats,
                cleanup: cleanupStats,
                health: healthStatus,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.logger.error('Failed to get comprehensive statistics', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get cleanup statistics
     */
    async getCleanupStatistics() {
        try {
            return await this.fileDownloadManager.getCleanupStatistics();
        } catch (error) {
            this.logger.error('Failed to get cleanup statistics', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Read decrypted file
     */
    async readDecryptedFile(relativePath) {
        try {
            const absolutePath = this.mediaDecryptionService.getAbsolutePath(relativePath);
            const fs = require('fs');
            return await fs.promises.readFile(absolutePath);
        } catch (error) {
            throw new Error(`Failed to read decrypted file: ${error.message}`);
        }
    }

    /**
     * Get expected content type for media type
     */
    getExpectedContentType(mediaType) {
        const contentTypeMapping = {
            'image': 'image/',
            'video': 'video/',
            'audio': 'audio/',
            'document': 'application/'
        };

        return contentTypeMapping[mediaType] || null;
    }

    /**
     * Sanitize URL for logging
     */
    sanitizeUrl(url) {
        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname.substring(0, 20)}...`;
        } catch {
            return url.substring(0, 50) + '...';
        }
    }

    /**
     * Get overall health status
     */
    getHealthStatus() {
        const downloadManagerHealth = this.fileDownloadManager.getHealthStatus();
        const mediaDecryptionHealth = this.mediaDecryptionService.getHealthStatus();
        
        return {
            mediaFileManager: {
                isHealthy: true,
                servicesIntegrated: true,
                databaseServiceAvailable: !!this.databaseService,
                wasenderClientAvailable: !!this.wasenderClient
            },
            fileDownloadManager: downloadManagerHealth,
            mediaDecryptionService: mediaDecryptionHealth,
            overallHealth: downloadManagerHealth.isHealthy && mediaDecryptionHealth.overallHealth
        };
    }

    /**
     * Maintenance operations
     */
    async performMaintenance(options = {}) {
        const maintenanceId = require('crypto').randomBytes(8).toString('hex');
        const startTime = Date.now();
        
        try {
            this.logger.info('Starting maintenance operations', {
                maintenanceId,
                options
            });

            const results = {
                maintenanceId,
                operations: []
            };

            // Cleanup old files
            if (options.cleanup !== false) {
                this.logger.info('Performing cleanup maintenance', { maintenanceId });
                const cleanupResult = await this.performComprehensiveCleanup({
                    olderThanDays: options.cleanupOlderThanDays || 30,
                    dryRun: options.dryRun || false
                });
                results.operations.push({
                    operation: 'cleanup',
                    ...cleanupResult
                });
            }

            // Reset statistics if requested
            if (options.resetStats) {
                this.logger.info('Resetting download statistics', { maintenanceId });
                this.fileDownloadManager.resetDownloadStatistics();
                results.operations.push({
                    operation: 'resetStats',
                    success: true
                });
            }

            // Verify file integrity for recent files if requested
            if (options.verifyIntegrity) {
                this.logger.info('Verifying file integrity', { maintenanceId });
                // This would be implemented based on specific requirements
                results.operations.push({
                    operation: 'verifyIntegrity',
                    success: true,
                    message: 'Integrity verification not implemented yet'
                });
            }

            const processingTime = Date.now() - startTime;
            results.processingTime = processingTime;
            results.success = results.operations.every(op => op.success);

            this.logger.info('Maintenance operations completed', {
                maintenanceId,
                processingTime: `${processingTime}ms`,
                operationsCount: results.operations.length
            });

            return results;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.logger.error('Maintenance operations failed', {
                maintenanceId,
                error: error.message,
                processingTime: `${processingTime}ms`
            });

            return {
                success: false,
                maintenanceId,
                error: error.message,
                processingTime
            };
        }
    }

    /**
     * Initialize MediaFileManager with dependencies
     */
    static async initialize(dependencies = {}) {
        const {
            databaseService,
            wasenderClient
        } = dependencies;

        const mediaFileManager = new MediaFileManager(databaseService, wasenderClient);
        
        // Verify initialization
        const health = mediaFileManager.getHealthStatus();
        if (!health.overallHealth) {
            throw new Error('MediaFileManager initialization failed - health check failed');
        }

        return mediaFileManager;
    }
}

module.exports = MediaFileManager;