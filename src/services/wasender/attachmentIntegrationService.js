/**
 * Attachment Integration Service for Wasender API Migration
 * Integrates AttachmentProcessingService with MediaDecryptionService and DatabaseService
 * Provides a unified interface for attachment processing in the Wasender ecosystem
 */

const AttachmentProcessingService = require('../attachmentProcessingService');
const MediaDecryptionService = require('../mediaDecryptionService');
const MediaFileManager = require('../mediaFileManager');
const { getServiceLogger } = require('../loggingService');

class AttachmentIntegrationService {
    constructor(databaseService = null, wasenderClient = null) {
        this.databaseService = databaseService;
        this.wasenderClient = wasenderClient;
        this.logger = getServiceLogger('attachment-integration');
        
        // Initialize comprehensive MediaFileManager for enhanced functionality
        this.mediaFileManager = new MediaFileManager(databaseService, wasenderClient);
        
        // Keep individual services for backward compatibility
        this.mediaDecryptionService = this.mediaFileManager.mediaDecryptionService;
        this.attachmentProcessingService = this.mediaFileManager.attachmentProcessingService;
        
        // Integrate with DatabaseService
        if (databaseService) {
            databaseService.setAttachmentProcessingService(this.attachmentProcessingService);
        }
        
        this.logger.info('AttachmentIntegrationService initialized with enhanced MediaFileManager');
    }

    /**
     * Process attachment from WhatsApp message with full integration
     * @param {Object} attachmentData - Raw attachment data from WhatsApp message
     * @param {number} postBankId - Foreign key to PostBank record
     * @param {Object} groupInfo - Group information for organized storage
     * @param {Object} userInfo - User information
     * @param {Object} transaction - Database transaction
     * @returns {Promise<Object>} Processing result
     */
    async processAttachment(attachmentData, postBankId, groupInfo, userInfo, transaction = null) {
        try {
            this.logger.info('Processing attachment with full integration', {
                attachmentType: attachmentData.type,
                postBankId,
                groupId: groupInfo?.groupId
            });

            const result = await this.attachmentProcessingService.processAndStoreAttachment(
                attachmentData,
                postBankId,
                groupInfo,
                userInfo,
                transaction
            );

            if (result.success) {
                this.logger.info('Attachment processed successfully', {
                    attachmentId: result.attachmentId,
                    filePath: result.filePath,
                    fileSize: result.fileSize
                });
            } else {
                this.logger.error('Attachment processing failed', {
                    error: result.error,
                    attachmentType: attachmentData.type
                });
            }

            return result;

        } catch (error) {
            this.logger.error('Attachment integration processing failed', {
                error: error.message,
                stack: error.stack,
                attachmentType: attachmentData.type
            });

            return {
                success: false,
                error: error.message,
                attachmentType: attachmentData.type
            };
        }
    }

    /**
     * Process multiple attachments from a message
     * @param {Array} attachmentsData - Array of attachment data
     * @param {number} postBankId - Foreign key to PostBank record
     * @param {Object} groupInfo - Group information
     * @param {Object} userInfo - User information
     * @param {Object} transaction - Database transaction
     * @returns {Promise<Array>} Array of processing results
     */
    async processMultipleAttachments(attachmentsData, postBankId, groupInfo, userInfo, transaction = null) {
        try {
            this.logger.info('Processing multiple attachments', {
                attachmentCount: attachmentsData.length,
                postBankId,
                groupId: groupInfo?.groupId
            });

            const results = await this.attachmentProcessingService.processMultipleAttachments(
                attachmentsData,
                postBankId,
                groupInfo,
                userInfo,
                transaction
            );

            const successCount = results.filter(r => r.success).length;
            const failedCount = results.filter(r => !r.success).length;

            this.logger.info('Multiple attachments processing completed', {
                totalAttachments: attachmentsData.length,
                successCount,
                failedCount
            });

            return results;

        } catch (error) {
            this.logger.error('Multiple attachments processing failed', {
                error: error.message,
                attachmentCount: attachmentsData.length
            });

            return attachmentsData.map(a => ({
                success: false,
                error: error.message,
                attachmentType: a.type
            }));
        }
    }

    /**
     * Extract attachment data from WhatsApp message
     * @param {Object} messageData - WhatsApp message data from webhook
     * @returns {Array} Array of attachment data objects
     */
    extractAttachmentsFromMessage(messageData) {
        const message = messageData.message;
        const attachments = [];

        if (!message) {
            return attachments;
        }

        // Extract image attachment
        if (message.imageMessage) {
            attachments.push({
                type: 'image',
                mimeType: message.imageMessage.mimetype,
                url: message.imageMessage.url,
                mediaKey: message.imageMessage.mediaKey,
                fileSha256: message.imageMessage.fileSha256,
                fileName: message.imageMessage.caption || 'image',
                caption: message.imageMessage.caption
            });
        }

        // Extract video attachment
        if (message.videoMessage) {
            attachments.push({
                type: 'video',
                mimeType: message.videoMessage.mimetype,
                url: message.videoMessage.url,
                mediaKey: message.videoMessage.mediaKey,
                fileSha256: message.videoMessage.fileSha256,
                fileName: message.videoMessage.caption || 'video',
                caption: message.videoMessage.caption,
                duration: message.videoMessage.seconds
            });
        }

        // Extract audio attachment
        if (message.audioMessage) {
            attachments.push({
                type: 'audio',
                mimeType: message.audioMessage.mimetype,
                url: message.audioMessage.url,
                mediaKey: message.audioMessage.mediaKey,
                fileSha256: message.audioMessage.fileSha256,
                fileName: 'audio',
                duration: message.audioMessage.seconds,
                ptt: message.audioMessage.ptt // Push-to-talk indicator
            });
        }

        // Extract document attachment
        if (message.documentMessage) {
            attachments.push({
                type: 'document',
                mimeType: message.documentMessage.mimetype,
                url: message.documentMessage.url,
                mediaKey: message.documentMessage.mediaKey,
                fileSha256: message.documentMessage.fileSha256,
                fileName: message.documentMessage.fileName || 'document',
                caption: message.documentMessage.caption,
                title: message.documentMessage.title,
                pageCount: message.documentMessage.pageCount,
                fileLength: message.documentMessage.fileLength
            });
        }

        // Extract sticker as image
        if (message.stickerMessage) {
            attachments.push({
                type: 'image',
                mimeType: message.stickerMessage.mimetype || 'image/webp',
                url: message.stickerMessage.url,
                mediaKey: message.stickerMessage.mediaKey,
                fileSha256: message.stickerMessage.fileSha256,
                fileName: 'sticker',
                isSticker: true
            });
        }

        this.logger.debug('Extracted attachments from message', {
            messageId: messageData.key?.id,
            attachmentCount: attachments.length,
            types: attachments.map(a => a.type)
        });

        return attachments;
    }

    /**
     * Get attachment statistics
     * @param {string} groupId - Optional group ID filter
     * @param {Object} dateRange - Optional date range filter
     * @returns {Promise<Object>} Attachment statistics
     */
    async getAttachmentStatistics(groupId = null, dateRange = null) {
        try {
            return await this.attachmentProcessingService.getAttachmentStatistics(groupId, dateRange);
        } catch (error) {
            this.logger.error('Failed to get attachment statistics', { error: error.message });
            throw error;
        }
    }

    /**
     * Cleanup old attachments
     * @param {number} olderThanDays - Delete files older than this many days
     * @returns {Promise<number>} Number of files deleted
     */
    async cleanupOldAttachments(olderThanDays = 30) {
        try {
            this.logger.info('Starting attachment cleanup', { olderThanDays });
            
            const deletedCount = await this.attachmentProcessingService.cleanupOldAttachments(olderThanDays);
            
            this.logger.info('Attachment cleanup completed', { deletedCount });
            return deletedCount;
        } catch (error) {
            this.logger.error('Attachment cleanup failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Verify attachment file integrity
     * @param {string} relativePath - Relative path to attachment file
     * @returns {Promise<Object>} Verification result
     */
    async verifyAttachmentIntegrity(relativePath) {
        try {
            const exists = await this.attachmentProcessingService.attachmentExists(relativePath);
            
            if (!exists) {
                return {
                    valid: false,
                    error: 'File does not exist'
                };
            }

            const stats = await this.attachmentProcessingService.getAttachmentStats(relativePath);
            
            return {
                valid: true,
                fileSize: stats.size,
                lastModified: stats.mtime,
                created: stats.birthtime
            };

        } catch (error) {
            return {
                valid: false,
                error: error.message
            };
        }
    }

    /**
     * Process attachment with enhanced media file management
     * @param {string} mediaUrl - Encrypted media URL
     * @param {string} mediaKey - Media decryption key
     * @param {string} mediaType - Type of media
     * @param {Object} metadata - Media metadata
     * @param {Object} storageOptions - Storage options including postBankId, groupInfo, userInfo
     * @returns {Promise<Object>} Enhanced processing result
     */
    async processAttachmentEnhanced(mediaUrl, mediaKey, mediaType, metadata = {}, storageOptions = {}) {
        try {
            this.logger.info('Processing attachment with enhanced media file management', {
                mediaType,
                mediaUrl: this.sanitizeUrl(mediaUrl),
                hasStorageOptions: Object.keys(storageOptions).length > 0
            });

            const result = await this.mediaFileManager.processMediaComplete(
                mediaUrl,
                mediaKey,
                mediaType,
                metadata,
                storageOptions
            );

            if (result.success) {
                this.logger.info('Enhanced attachment processing completed successfully', {
                    attachmentId: result.attachmentId,
                    filePath: result.filePath,
                    fileSize: result.fileSize,
                    processingTime: result.processingTime
                });
            } else {
                this.logger.error('Enhanced attachment processing failed', {
                    error: result.error,
                    mediaType
                });
            }

            return result;

        } catch (error) {
            this.logger.error('Enhanced attachment processing error', {
                error: error.message,
                stack: error.stack,
                mediaType
            });

            return {
                success: false,
                error: error.message,
                mediaType
            };
        }
    }

    /**
     * Process multiple attachments with enhanced batch processing
     * @param {Array} mediaItems - Array of media items to process
     * @param {Object} storageOptions - Common storage options
     * @returns {Promise<Object>} Batch processing result
     */
    async processMultipleAttachmentsEnhanced(mediaItems, storageOptions = {}) {
        try {
            this.logger.info('Processing multiple attachments with enhanced batch processing', {
                itemCount: mediaItems.length
            });

            const result = await this.mediaFileManager.processMultipleMedia(mediaItems, storageOptions);

            this.logger.info('Enhanced batch processing completed', {
                totalItems: result.totalItems,
                successCount: result.successCount,
                failedCount: result.failedCount,
                processingTime: result.processingTime
            });

            return result;

        } catch (error) {
            this.logger.error('Enhanced batch processing failed', {
                error: error.message,
                itemCount: mediaItems.length
            });

            return {
                success: false,
                error: error.message,
                itemCount: mediaItems.length
            };
        }
    }

    /**
     * Perform comprehensive cleanup with advanced options
     * @param {Object} options - Cleanup options
     * @returns {Promise<Object>} Cleanup result
     */
    async performComprehensiveCleanup(options = {}) {
        try {
            this.logger.info('Performing comprehensive cleanup', options);
            
            const result = await this.mediaFileManager.performComprehensiveCleanup(options);
            
            this.logger.info('Comprehensive cleanup completed', {
                filesDeleted: result.filesDeleted,
                bytesFreed: result.bytesFreed,
                processingTime: result.processingTime
            });
            
            return result;
        } catch (error) {
            this.logger.error('Comprehensive cleanup failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Get comprehensive statistics
     * @returns {Promise<Object>} Comprehensive statistics
     */
    async getComprehensiveStatistics() {
        try {
            return await this.mediaFileManager.getComprehensiveStatistics();
        } catch (error) {
            this.logger.error('Failed to get comprehensive statistics', { error: error.message });
            throw error;
        }
    }

    /**
     * Verify file integrity
     * @param {string} filePath - Path to file to verify
     * @param {string} expectedHash - Expected hash for verification
     * @returns {Promise<Object>} Verification result
     */
    async verifyFileIntegrity(filePath, expectedHash = null) {
        try {
            return await this.mediaFileManager.verifyFileIntegrity(filePath, expectedHash);
        } catch (error) {
            this.logger.error('File integrity verification failed', { 
                filePath, 
                error: error.message 
            });
            throw error;
        }
    }

    /**
     * Perform maintenance operations
     * @param {Object} options - Maintenance options
     * @returns {Promise<Object>} Maintenance result
     */
    async performMaintenance(options = {}) {
        try {
            this.logger.info('Performing maintenance operations', options);
            
            const result = await this.mediaFileManager.performMaintenance(options);
            
            this.logger.info('Maintenance operations completed', {
                operationsCount: result.operations?.length || 0,
                success: result.success,
                processingTime: result.processingTime
            });
            
            return result;
        } catch (error) {
            this.logger.error('Maintenance operations failed', { error: error.message });
            throw error;
        }
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
     * Get service health status
     * @returns {Object} Health status of all integrated services
     */
    getHealthStatus() {
        const mediaFileManagerHealth = this.mediaFileManager.getHealthStatus();
        
        return {
            attachmentIntegrationService: {
                isHealthy: true,
                mediaFileManagerAvailable: !!this.mediaFileManager,
                databaseServiceAvailable: !!this.databaseService,
                wasenderClientAvailable: !!this.wasenderClient
            },
            mediaFileManager: mediaFileManagerHealth,
            // Legacy compatibility
            attachmentProcessingService: !!this.attachmentProcessingService,
            mediaDecryptionService: !!this.mediaDecryptionService,
            baseAttachmentPath: this.attachmentProcessingService?.baseAttachmentPath,
            isHealthy: mediaFileManagerHealth.overallHealth && !!this.databaseService
        };
    }

    /**
     * Initialize service with dependencies
     * @param {Object} dependencies - Service dependencies
     */
    static async initialize(dependencies = {}) {
        const {
            databaseService,
            wasenderClient
        } = dependencies;

        const integrationService = new AttachmentIntegrationService(databaseService, wasenderClient);
        
        // Verify initialization
        const health = integrationService.getHealthStatus();
        if (!health.isHealthy) {
            throw new Error('AttachmentIntegrationService initialization failed - missing dependencies');
        }

        return integrationService;
    }
}

module.exports = AttachmentIntegrationService;