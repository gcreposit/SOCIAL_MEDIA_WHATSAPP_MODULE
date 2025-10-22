/**
 * Attachment Processing Service for Wasender API Migration
 * Handles attachment data processing for CommonAttachment model with organized file storage
 * Implements proper file naming to avoid conflicts and duplicates
 * Requirements: 4.2, 4.4, 4.5
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getServiceLogger } = require('./loggingService');

class AttachmentProcessingService {
    constructor(databaseService = null, mediaDecryptionService = null) {
        this.databaseService = databaseService;
        this.mediaDecryptionService = mediaDecryptionService;
        this.logger = getServiceLogger('attachment');
        
        // Configuration
        this.baseAttachmentPath = process.env.ATTACHMENT_PATH || '/Users/apple1/Downloads/WHATSAPP_DOCS/';
        this.maxFileSize = this.parseFileSize(process.env.MAX_FILE_SIZE || '50MB');
        
        // Directory structure configuration
        this.directoryStructure = {
            images: 'IMAGES',
            videos: 'VIDEOS', 
            audio: 'AUDIO',
            documents: 'DOCUMENTS'
        };
        
        // File naming configuration
        this.fileNamingConfig = {
            timestampFormat: 'YYYYMMDD_HHmmss',
            randomSuffixLength: 8,
            maxBaseNameLength: 50
        };
        
        // Supported file types
        this.supportedTypes = {
            image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'],
            video: ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', '3gp', 'mkv'],
            audio: ['mp3', 'wav', 'aac', 'ogg', 'flac', 'm4a', 'wma'],
            document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf']
        };
        
        this.initializeDirectories();
    }

    /**
     * Parse file size string to bytes
     */
    parseFileSize(sizeStr) {
        const units = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
        const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
        if (!match) return 50 * 1024 * 1024; // Default 50MB
        return parseFloat(match[1]) * units[match[2].toUpperCase()];
    }

    /**
     * Initialize organized directory structure by date and group
     */
    initializeDirectories() {
        try {
            // Create base attachment directory
            if (!fs.existsSync(this.baseAttachmentPath)) {
                fs.mkdirSync(this.baseAttachmentPath, { recursive: true });
                this.logger.info(`Created base attachment directory: ${this.baseAttachmentPath}`);
            }

            // Create main type directories
            Object.values(this.directoryStructure).forEach(dirName => {
                const dirPath = path.join(this.baseAttachmentPath, dirName);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                    this.logger.info(`Created directory: ${dirPath}`);
                }
            });

            this.logger.info('Attachment directories initialized successfully');
        } catch (error) {
            this.logger.error('Failed to initialize attachment directories', { error: error.message });
            throw error;
        }
    }

    /**
     * Process and store attachment from WhatsApp message
     * Creates attachment data processing for CommonAttachment model
     * @param {Object} attachmentData - Raw attachment data from WhatsApp message
     * @param {number} postBankId - Foreign key to PostBank record
     * @param {Object} groupInfo - Group information for organized storage
     * @param {Object} userInfo - User information
     * @param {Object} transaction - Database transaction
     * @returns {Promise<Object>} Processing result with CommonAttachment record
     */
    async processAndStoreAttachment(attachmentData, postBankId, groupInfo, userInfo, transaction = null) {
        const startTime = Date.now();
        
        try {
            this.logger.info('Starting attachment processing', {
                attachmentType: attachmentData.type,
                postBankId,
                groupId: groupInfo?.groupId,
                hasMediaKey: !!attachmentData.mediaKey
            });

            // Validate attachment data
            this.validateAttachmentData(attachmentData);

            // Decrypt media if needed
            let decryptedData = null;
            let filePath = null;
            let fileName = null;

            if (attachmentData.url && attachmentData.mediaKey) {
                // Decrypt media using MediaDecryptionService
                const decryptionResult = await this.decryptAttachmentMedia(attachmentData);
                
                if (!decryptionResult.success) {
                    throw new Error(`Media decryption failed: ${decryptionResult.error}`);
                }

                decryptedData = decryptionResult.data;
                fileName = decryptionResult.fileName;
            } else if (attachmentData.data) {
                // Direct attachment data (already decrypted)
                decryptedData = attachmentData.data;
                fileName = attachmentData.fileName || 'attachment';
            } else {
                throw new Error('No attachment data or media URL provided');
            }

            // Generate organized file path with proper naming
            const organizedPath = await this.generateOrganizedFilePath(
                fileName,
                attachmentData.type,
                groupInfo,
                attachmentData.mimeType
            );

            // Save file to organized directory structure
            const savedPath = await this.saveAttachmentFile(
                decryptedData,
                organizedPath,
                attachmentData.type
            );

            // Create CommonAttachment record with comprehensive data
            const attachmentRecord = await this.createAttachmentRecord(
                attachmentData,
                postBankId,
                savedPath,
                groupInfo,
                userInfo,
                transaction
            );

            const processingTime = Date.now() - startTime;

            this.logger.info('Attachment processing completed successfully', {
                attachmentId: attachmentRecord.id,
                attachmentType: attachmentData.type,
                filePath: savedPath,
                fileSize: decryptedData?.length || 0,
                processingTime: `${processingTime}ms`
            });

            return {
                success: true,
                attachmentId: attachmentRecord.id,
                filePath: savedPath,
                fileName: path.basename(savedPath),
                attachmentType: attachmentData.type,
                fileSize: decryptedData?.length || 0,
                processingTime
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.logger.error('Attachment processing failed', {
                attachmentType: attachmentData.type,
                postBankId,
                error: error.message,
                stack: error.stack,
                processingTime: `${processingTime}ms`
            });

            // Create failed attachment record for tracking
            try {
                await this.createFailedAttachmentRecord(
                    attachmentData,
                    postBankId,
                    error.message,
                    groupInfo,
                    userInfo,
                    transaction
                );
            } catch (recordError) {
                this.logger.error('Failed to create failed attachment record', {
                    error: recordError.message
                });
            }

            return {
                success: false,
                error: error.message,
                attachmentType: attachmentData.type,
                processingTime
            };
        }
    }

    /**
     * Validate attachment data before processing
     */
    validateAttachmentData(attachmentData) {
        if (!attachmentData || typeof attachmentData !== 'object') {
            throw new Error('Invalid attachment data provided');
        }

        if (!attachmentData.type) {
            throw new Error('Attachment type is required');
        }

        if (!this.isValidAttachmentType(attachmentData.type)) {
            throw new Error(`Unsupported attachment type: ${attachmentData.type}`);
        }

        if (!attachmentData.url && !attachmentData.data) {
            throw new Error('Either attachment URL or data is required');
        }

        if (attachmentData.url && !attachmentData.mediaKey) {
            throw new Error('Media key is required for encrypted attachments');
        }
    }

    /**
     * Check if attachment type is valid
     */
    isValidAttachmentType(type) {
        return Object.keys(this.supportedTypes).includes(type);
    }

    /**
     * Decrypt attachment media using MediaDecryptionService
     */
    async decryptAttachmentMedia(attachmentData) {
        if (!this.mediaDecryptionService) {
            throw new Error('MediaDecryptionService not available');
        }

        try {
            const metadata = {
                fileName: attachmentData.fileName,
                mimeType: attachmentData.mimeType,
                fileSha256: attachmentData.fileSha256
            };

            const result = await this.mediaDecryptionService.decryptMedia(
                attachmentData.url,
                attachmentData.mediaKey,
                attachmentData.type,
                metadata
            );

            if (!result.success) {
                throw new Error(result.error);
            }

            // Read the decrypted file
            const absolutePath = this.mediaDecryptionService.getAbsolutePath(result.filePath);
            const data = await fs.promises.readFile(absolutePath);

            return {
                success: true,
                data,
                fileName: result.fileName,
                filePath: result.filePath
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Generate organized file path with date and group structure
     * Implements organized file storage structure by date and group
     */
    generateOrganizedFilePath(originalFileName, attachmentType, groupInfo, mimeType) {
        try {
            // Generate date-based directory structure
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            
            // Clean group name for directory usage
            const groupName = this.sanitizeForDirectory(
                groupInfo?.groupName || groupInfo?.name || 'unknown_group'
            );
            
            // Create organized directory path: TYPE/YYYY/MM/DD/GROUP_NAME/
            const typeDir = this.directoryStructure[attachmentType] || 'DOCUMENTS';
            const organizedDir = path.join(
                typeDir,
                year.toString(),
                month,
                day,
                groupName
            );

            // Generate unique filename to avoid conflicts and duplicates
            const uniqueFileName = this.generateUniqueFileName(
                originalFileName,
                attachmentType,
                mimeType
            );

            return path.join(organizedDir, uniqueFileName);

        } catch (error) {
            this.logger.error('Error generating organized file path', { error: error.message });
            // Fallback to simple structure
            const typeDir = this.directoryStructure[attachmentType] || 'DOCUMENTS';
            const uniqueFileName = this.generateUniqueFileName(originalFileName, attachmentType, mimeType);
            return path.join(typeDir, uniqueFileName);
        }
    }

    /**
     * Generate unique filename to avoid conflicts and duplicates
     * Implements proper file naming to avoid conflicts and duplicates
     */
    generateUniqueFileName(originalFileName, attachmentType, mimeType) {
        try {
            // Extract base name and extension
            let baseName = 'attachment';
            let extension = '';

            if (originalFileName) {
                const parsed = path.parse(originalFileName);
                baseName = parsed.name;
                extension = parsed.ext;
            }

            // If no extension, derive from mime type or attachment type
            if (!extension) {
                extension = this.getExtensionFromMimeType(mimeType) || 
                           this.getDefaultExtension(attachmentType);
            }

            // Sanitize base name
            baseName = this.sanitizeFileName(baseName);
            
            // Limit base name length
            if (baseName.length > this.fileNamingConfig.maxBaseNameLength) {
                baseName = baseName.substring(0, this.fileNamingConfig.maxBaseNameLength);
            }

            // Generate timestamp
            const now = new Date();
            const timestamp = now.getFullYear() +
                String(now.getMonth() + 1).padStart(2, '0') +
                String(now.getDate()).padStart(2, '0') + '_' +
                String(now.getHours()).padStart(2, '0') +
                String(now.getMinutes()).padStart(2, '0') +
                String(now.getSeconds()).padStart(2, '0');

            // Generate random suffix for uniqueness
            const randomSuffix = crypto.randomBytes(this.fileNamingConfig.randomSuffixLength / 2)
                .toString('hex');

            // Combine all parts: timestamp_randomSuffix_baseName.extension
            return `${timestamp}_${randomSuffix}_${baseName}${extension}`;

        } catch (error) {
            this.logger.error('Error generating unique filename', { error: error.message });
            // Fallback to simple unique name
            const timestamp = Date.now();
            const randomSuffix = crypto.randomBytes(4).toString('hex');
            const extension = this.getDefaultExtension(attachmentType);
            return `${timestamp}_${randomSuffix}_attachment${extension}`;
        }
    }

    /**
     * Sanitize string for directory usage
     */
    sanitizeForDirectory(str) {
        return str
            .replace(/[<>:"/\\|?*]/g, '_')  // Replace invalid characters
            .replace(/\s+/g, '_')           // Replace spaces with underscores
            .replace(/_{2,}/g, '_')         // Replace multiple underscores with single
            .replace(/^_+|_+$/g, '')        // Remove leading/trailing underscores
            .toLowerCase()
            .substring(0, 50);              // Limit length
    }

    /**
     * Sanitize filename
     */
    sanitizeFileName(fileName) {
        return fileName
            .replace(/[<>:"/\\|?*]/g, '_')  // Replace invalid characters
            .replace(/\s+/g, '_')           // Replace spaces with underscores
            .replace(/_{2,}/g, '_')         // Replace multiple underscores with single
            .replace(/^_+|_+$/g, '');       // Remove leading/trailing underscores
    }

    /**
     * Get file extension from MIME type
     */
    getExtensionFromMimeType(mimeType) {
        if (!mimeType) return null;

        const mimeToExt = {
            // Images
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/bmp': '.bmp',
            'image/tiff': '.tiff',
            
            // Videos
            'video/mp4': '.mp4',
            'video/quicktime': '.mov',
            'video/x-msvideo': '.avi',
            'video/webm': '.webm',
            'video/3gpp': '.3gp',
            'video/x-matroska': '.mkv',
            
            // Audio
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/aac': '.aac',
            'audio/ogg': '.ogg',
            'audio/flac': '.flac',
            'audio/mp4': '.m4a',
            
            // Documents
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/vnd.ms-excel': '.xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
            'text/plain': '.txt',
            'application/rtf': '.rtf'
        };

        return mimeToExt[mimeType] || null;
    }

    /**
     * Get default extension for attachment type
     */
    getDefaultExtension(attachmentType) {
        const defaults = {
            image: '.jpg',
            video: '.mp4',
            audio: '.mp3',
            document: '.pdf'
        };

        return defaults[attachmentType] || '.bin';
    }

    /**
     * Save attachment file to organized directory structure
     */
    async saveAttachmentFile(data, relativePath, attachmentType) {
        try {
            const absolutePath = path.join(this.baseAttachmentPath, relativePath);

            // Check file size
            if (data.length > this.maxFileSize) {
                throw new Error(`File size ${data.length} exceeds maximum allowed size ${this.maxFileSize}`);
            }

            // Use enhanced file operations if MediaDecryptionService is available
            if (this.mediaDecryptionService && this.mediaDecryptionService.fileDownloadManager) {
                await this.mediaDecryptionService.fileDownloadManager.writeFileAtomic(absolutePath, data);
            } else {
                // Fallback to basic file operations
                const directory = path.dirname(absolutePath);

                // Ensure directory exists
                if (!fs.existsSync(directory)) {
                    fs.mkdirSync(directory, { recursive: true });
                    this.logger.debug(`Created directory: ${directory}`);
                }

                // Write file
                await fs.promises.writeFile(absolutePath, data);

                // Verify file was written correctly
                const stats = await fs.promises.stat(absolutePath);
                if (stats.size !== data.length) {
                    throw new Error('File size mismatch after writing');
                }
            }

            this.logger.debug('File saved successfully', {
                relativePath,
                fileSize: data.length,
                attachmentType
            });

            return relativePath;

        } catch (error) {
            this.logger.error('Failed to save attachment file', {
                relativePath,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Create CommonAttachment record with comprehensive data
     */
    async createAttachmentRecord(attachmentData, postBankId, filePath, groupInfo, userInfo, transaction) {
        if (!this.databaseService) {
            throw new Error('DatabaseService not available');
        }

        try {
            const attachmentRecord = {
                post_bank_id: postBankId,
                attachment_type: attachmentData.type,
                platform_name: 'whatsapp',
                mime_type: attachmentData.mimeType,
                timestamp: new Date(),
                group_id: groupInfo?.groupId || groupInfo?.id,
                mobile_number: userInfo?.phoneNumber,
                download_status: 'DOWNLOADED',
                processing_status: 'PROCESSED',
                created_at: new Date(),
                updated_at: new Date()
            };

            // Set appropriate path field based on attachment type
            switch (attachmentData.type) {
                case 'image':
                    attachmentRecord.image_attachment_path = filePath;
                    break;
                case 'video':
                    attachmentRecord.video_attachment_path = filePath;
                    break;
                case 'audio':
                    attachmentRecord.audio_attachment_path = filePath;
                    break;
                case 'document':
                    attachmentRecord.document_attachment_path = filePath;
                    break;
                default:
                    attachmentRecord.document_attachment_path = filePath;
            }

            const record = await this.databaseService.models.CommonAttachment.create(
                attachmentRecord,
                { transaction }
            );

            this.logger.info('Created CommonAttachment record', {
                attachmentId: record.id,
                attachmentType: attachmentData.type,
                filePath
            });

            return record;

        } catch (error) {
            this.logger.error('Failed to create attachment record', {
                postBankId,
                attachmentType: attachmentData.type,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Create failed attachment record for tracking
     */
    async createFailedAttachmentRecord(attachmentData, postBankId, errorMessage, groupInfo, userInfo, transaction) {
        if (!this.databaseService) {
            return;
        }

        try {
            const failedRecord = {
                post_bank_id: postBankId,
                attachment_type: attachmentData.type,
                platform_name: 'whatsapp',
                mime_type: attachmentData.mimeType,
                timestamp: new Date(),
                group_id: groupInfo?.groupId || groupInfo?.id,
                mobile_number: userInfo?.phoneNumber,
                download_status: 'FAILED',
                processing_status: 'FAILED',
                error_message: errorMessage,
                created_at: new Date(),
                updated_at: new Date()
            };

            await this.databaseService.models.CommonAttachment.create(
                failedRecord,
                { transaction }
            );

            this.logger.info('Created failed attachment record for tracking', {
                attachmentType: attachmentData.type,
                errorMessage
            });

        } catch (error) {
            this.logger.error('Failed to create failed attachment record', {
                error: error.message
            });
        }
    }

    /**
     * Process multiple attachments from a single message
     */
    async processMultipleAttachments(attachmentsData, postBankId, groupInfo, userInfo, transaction) {
        const results = [];
        
        for (const attachmentData of attachmentsData) {
            try {
                const result = await this.processAndStoreAttachment(
                    attachmentData,
                    postBankId,
                    groupInfo,
                    userInfo,
                    transaction
                );
                results.push(result);
            } catch (error) {
                this.logger.error('Failed to process attachment in batch', {
                    attachmentType: attachmentData.type,
                    error: error.message
                });
                results.push({
                    success: false,
                    error: error.message,
                    attachmentType: attachmentData.type
                });
            }
        }

        return results;
    }

    /**
     * Get attachment statistics
     */
    async getAttachmentStatistics(groupId = null, dateRange = null) {
        if (!this.databaseService) {
            throw new Error('DatabaseService not available');
        }

        try {
            const whereClause = { platform_name: 'whatsapp' };
            
            if (groupId) {
                whereClause.group_id = groupId;
            }
            
            if (dateRange && dateRange.start && dateRange.end) {
                whereClause.timestamp = {
                    [this.databaseService.models.Sequelize.Op.between]: [dateRange.start, dateRange.end]
                };
            }

            const stats = await this.databaseService.models.CommonAttachment.findAll({
                attributes: [
                    'attachment_type',
                    'processing_status',
                    [this.databaseService.models.sequelize.fn('COUNT', this.databaseService.models.sequelize.col('id')), 'count']
                ],
                where: whereClause,
                group: ['attachment_type', 'processing_status'],
                raw: true
            });

            return stats;

        } catch (error) {
            this.logger.error('Failed to get attachment statistics', { error: error.message });
            throw error;
        }
    }

    /**
     * Cleanup old attachment files (legacy method)
     */
    async cleanupOldAttachments(olderThanDays = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

            let deletedCount = 0;
            const directories = Object.values(this.directoryStructure);

            for (const dir of directories) {
                const dirPath = path.join(this.baseAttachmentPath, dir);
                if (fs.existsSync(dirPath)) {
                    deletedCount += await this.cleanupDirectory(dirPath, cutoffDate);
                }
            }

            this.logger.info('Attachment cleanup completed', {
                deletedFiles: deletedCount,
                olderThanDays
            });

            return deletedCount;

        } catch (error) {
            this.logger.error('Attachment cleanup failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Enhanced cleanup using MediaDecryptionService's FileDownloadManager
     */
    async cleanupOldAttachmentsEnhanced(options = {}) {
        try {
            if (this.mediaDecryptionService && this.mediaDecryptionService.cleanupOldFilesEnhanced) {
                this.logger.info('Using enhanced cleanup via MediaDecryptionService', options);
                return await this.mediaDecryptionService.cleanupOldFilesEnhanced(options);
            } else {
                // Fallback to legacy cleanup
                this.logger.info('Falling back to legacy cleanup method');
                return await this.cleanupOldAttachments(options.olderThanDays || 30);
            }
        } catch (error) {
            this.logger.error('Enhanced attachment cleanup failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Get cleanup statistics
     */
    async getCleanupStatistics() {
        try {
            if (this.mediaDecryptionService && this.mediaDecryptionService.getCleanupStatistics) {
                return await this.mediaDecryptionService.getCleanupStatistics();
            } else {
                // Provide basic statistics
                return await this.getBasicCleanupStatistics();
            }
        } catch (error) {
            this.logger.error('Failed to get cleanup statistics', { error: error.message });
            throw error;
        }
    }

    /**
     * Get basic cleanup statistics (fallback method)
     */
    async getBasicCleanupStatistics() {
        const stats = {
            totalFiles: 0,
            totalSize: 0,
            oldFiles: 0,
            oldFilesSize: 0,
            directories: {}
        };

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30); // Default 30 days

        try {
            for (const [type, dirName] of Object.entries(this.directoryStructure)) {
                const dirPath = path.join(this.baseAttachmentPath, dirName);
                
                if (fs.existsSync(dirPath)) {
                    const dirStats = await this.getDirectoryStats(dirPath, cutoffDate);
                    stats.totalFiles += dirStats.totalFiles;
                    stats.totalSize += dirStats.totalSize;
                    stats.oldFiles += dirStats.oldFiles;
                    stats.oldFilesSize += dirStats.oldFilesSize;
                    stats.directories[type] = dirStats;
                }
            }
        } catch (error) {
            this.logger.error('Error getting basic cleanup statistics', { error: error.message });
        }

        return stats;
    }

    /**
     * Get directory statistics
     */
    async getDirectoryStats(dirPath, cutoffDate) {
        const stats = {
            totalFiles: 0,
            totalSize: 0,
            oldFiles: 0,
            oldFilesSize: 0
        };

        try {
            const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(dirPath, item.name);

                if (item.isDirectory()) {
                    const subStats = await this.getDirectoryStats(itemPath, cutoffDate);
                    stats.totalFiles += subStats.totalFiles;
                    stats.totalSize += subStats.totalSize;
                    stats.oldFiles += subStats.oldFiles;
                    stats.oldFilesSize += subStats.oldFilesSize;
                } else if (item.isFile()) {
                    try {
                        const fileStats = await fs.promises.stat(itemPath);
                        stats.totalFiles++;
                        stats.totalSize += fileStats.size;

                        if (fileStats.mtime < cutoffDate) {
                            stats.oldFiles++;
                            stats.oldFilesSize += fileStats.size;
                        }
                    } catch (fileError) {
                        // Skip files that can't be accessed
                    }
                }
            }
        } catch (error) {
            this.logger.error('Error getting directory stats', {
                dirPath,
                error: error.message
            });
        }

        return stats;
    }

    /**
     * Recursively cleanup directory
     */
    async cleanupDirectory(dirPath, cutoffDate) {
        let deletedCount = 0;

        try {
            const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(dirPath, item.name);

                if (item.isDirectory()) {
                    deletedCount += await this.cleanupDirectory(itemPath, cutoffDate);
                    
                    // Remove empty directories
                    const remainingItems = await fs.promises.readdir(itemPath);
                    if (remainingItems.length === 0) {
                        await fs.promises.rmdir(itemPath);
                        this.logger.debug(`Removed empty directory: ${itemPath}`);
                    }
                } else if (item.isFile()) {
                    const stats = await fs.promises.stat(itemPath);
                    if (stats.mtime < cutoffDate) {
                        await fs.promises.unlink(itemPath);
                        deletedCount++;
                        this.logger.debug(`Deleted old file: ${itemPath}`);
                    }
                }
            }

        } catch (error) {
            this.logger.error('Error cleaning up directory', {
                dirPath,
                error: error.message
            });
        }

        return deletedCount;
    }

    /**
     * Get absolute path for relative attachment path
     */
    getAbsolutePath(relativePath) {
        if (!relativePath) return null;
        return path.join(this.baseAttachmentPath, relativePath);
    }

    /**
     * Check if attachment file exists
     */
    async attachmentExists(relativePath) {
        try {
            const absolutePath = this.getAbsolutePath(relativePath);
            await fs.promises.access(absolutePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get attachment file stats
     */
    async getAttachmentStats(relativePath) {
        try {
            const absolutePath = this.getAbsolutePath(relativePath);
            return await fs.promises.stat(absolutePath);
        } catch (error) {
            throw new Error(`Failed to get attachment stats: ${error.message}`);
        }
    }
}

module.exports = AttachmentProcessingService;