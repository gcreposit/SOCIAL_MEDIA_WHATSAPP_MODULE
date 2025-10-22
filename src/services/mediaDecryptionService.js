/**
 * Media Decryption Service
 * Handles WhatsApp media decryption using Wasender API decrypt-media endpoint
 * Supports image, video, audio, and document decryption with SHA-256 hash verification
 */

const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getServiceLogger, logMediaProcessing } = require('./loggingService');
const FileDownloadManager = require('./fileDownloadManager');

class MediaDecryptionService {
    constructor(wasenderClient = null) {
        this.wasenderClient = wasenderClient;
        this.logger = getServiceLogger('media');
        
        // Initialize FileDownloadManager for enhanced download capabilities
        this.fileDownloadManager = new FileDownloadManager();
        
        // Configuration
        this.baseAttachmentPath = process.env.ATTACHMENT_PATH || '/Users/apple1/Downloads/WHATSAPP_DOCS/';
        this.maxFileSize = this.parseFileSize(process.env.MAX_FILE_SIZE || '50MB');
        this.allowedMediaTypes = (process.env.ALLOWED_MEDIA_TYPES || 'image,video,audio,document').split(',');
        
        // Retry configuration
        this.maxRetries = 3;
        this.retryDelay = 1000;
        
        // Supported media types mapping
        this.mediaTypeMapping = {
            'image': ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
            'video': ['video/mp4', 'video/quicktime', 'video/webm', 'video/3gpp'],
            'audio': ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac', 'audio/mp4'],
            'document': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']
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
     * Initialize media directories
     */
    initializeDirectories() {
        try {
            const directories = ['IMAGES', 'VIDEOS', 'AUDIO', 'DOCUMENTS'];
            
            directories.forEach(dir => {
                const dirPath = path.join(this.baseAttachmentPath, dir);
                if (!fs.existsSync(dirPath)) {
                    fs.mkdirSync(dirPath, { recursive: true });
                    this.logger.info(`Created media directory: ${dirPath}`);
                }
            });
        } catch (error) {
            this.logger.error('Failed to initialize media directories', { error: error.message });
            throw error;
        }
    }

    /**
     * Decrypt media using Wasender API
     * @param {string} mediaUrl - Encrypted media URL from WhatsApp
     * @param {string} mediaKey - Media decryption key
     * @param {string} mediaType - Type of media (image, video, audio, document)
     * @param {Object} metadata - Additional metadata (filename, mimeType, etc.)
     * @returns {Object} - Decryption result with file path and metadata
     */
    async decryptMedia(mediaUrl, mediaKey, mediaType, metadata = {}) {
        const startTime = Date.now();
        
        try {
            this.logger.info('Starting media decryption', {
                mediaType,
                mediaUrl: this.sanitizeUrl(mediaUrl),
                hasMediaKey: !!mediaKey,
                metadata
            });

            // Validate inputs
            this.validateDecryptionInputs(mediaUrl, mediaKey, mediaType);

            // Check if media type is allowed
            if (!this.allowedMediaTypes.includes(mediaType)) {
                throw new Error(`Media type '${mediaType}' is not allowed`);
            }

            // Download encrypted media using enhanced FileDownloadManager
            const encryptedData = await this.fileDownloadManager.downloadEncryptedMedia(mediaUrl, {
                expectedContentType: this.getExpectedContentType(mediaType),
                maxSize: this.maxFileSize
            });
            
            // Validate file size
            if (encryptedData.length > this.maxFileSize) {
                throw new Error(`File size ${encryptedData.length} exceeds maximum allowed size ${this.maxFileSize}`);
            }

            // Decrypt the media using Wasender API
            const decryptedData = await this.decryptWithWasenderAPI(mediaUrl, mediaKey, mediaType);
            
            // Validate decrypted data with hash if provided
            if (metadata.fileSha256) {
                await this.validateMediaHash(decryptedData, metadata.fileSha256);
            }

            // Generate filename and save decrypted file using enhanced file operations
            const fileName = this.generateFileName(metadata.fileName || 'media', mediaType, metadata.mimeType);
            const filePath = await this.saveDecryptedFileEnhanced(decryptedData, fileName, mediaType);

            const processingTime = Date.now() - startTime;
            
            logMediaProcessing(mediaType, decryptedData.length, processingTime, true);
            
            this.logger.info('Media decryption completed successfully', {
                mediaType,
                fileName,
                filePath,
                fileSize: decryptedData.length,
                processingTime: `${processingTime}ms`
            });

            return {
                success: true,
                filePath,
                fileName,
                mediaType,
                fileSize: decryptedData.length,
                mimeType: metadata.mimeType,
                processingTime
            };

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            logMediaProcessing(mediaType, 0, processingTime, false, error);
            
            this.logger.error('Media decryption failed', {
                mediaType,
                mediaUrl: this.sanitizeUrl(mediaUrl),
                error: error.message,
                stack: error.stack,
                processingTime: `${processingTime}ms`
            });

            return {
                success: false,
                error: error.message,
                mediaType,
                processingTime
            };
        }
    }

    /**
     * Validate decryption inputs
     */
    validateDecryptionInputs(mediaUrl, mediaKey, mediaType) {
        if (!mediaUrl || typeof mediaUrl !== 'string') {
            throw new Error('Invalid media URL provided');
        }

        if (!mediaKey || typeof mediaKey !== 'string') {
            throw new Error('Invalid media key provided');
        }

        if (!mediaType || typeof mediaType !== 'string') {
            throw new Error('Invalid media type provided');
        }

        // Validate URL format
        try {
            new URL(mediaUrl);
        } catch {
            throw new Error('Invalid media URL format');
        }
    }

    /**
     * Download encrypted media from URL
     */
    async downloadEncryptedMedia(mediaUrl) {
        try {
            this.logger.debug('Downloading encrypted media', { 
                mediaUrl: this.sanitizeUrl(mediaUrl) 
            });

            const response = await axios.get(mediaUrl, {
                responseType: 'arraybuffer',
                timeout: 30000,
                maxContentLength: this.maxFileSize,
                maxBodyLength: this.maxFileSize
            });

            if (!response.data || response.data.length === 0) {
                throw new Error('Empty media file downloaded');
            }

            this.logger.debug('Media download completed', { 
                fileSize: response.data.length 
            });

            return Buffer.from(response.data);

        } catch (error) {
            if (error.code === 'ECONNABORTED') {
                throw new Error('Media download timeout');
            }
            if (error.response?.status === 404) {
                throw new Error('Media file not found');
            }
            throw new Error(`Failed to download media: ${error.message}`);
        }
    }

    /**
     * Decrypt media using Wasender API
     */
    async decryptWithWasenderAPI(mediaUrl, mediaKey, mediaType) {
        if (!this.wasenderClient) {
            throw new Error('Wasender client not initialized');
        }

        try {
            this.logger.debug('Calling Wasender API for media decryption', { mediaType });

            const response = await this.wasenderClient.decryptMedia(mediaUrl, mediaKey, mediaType);
            
            if (!response || !response.decryptedData) {
                throw new Error('Invalid response from Wasender API');
            }

            // Convert base64 data to buffer if needed
            let decryptedBuffer;
            if (typeof response.decryptedData === 'string') {
                decryptedBuffer = Buffer.from(response.decryptedData, 'base64');
            } else if (Buffer.isBuffer(response.decryptedData)) {
                decryptedBuffer = response.decryptedData;
            } else {
                throw new Error('Invalid decrypted data format from Wasender API');
            }

            this.logger.debug('Wasender API decryption completed', { 
                decryptedSize: decryptedBuffer.length 
            });

            return decryptedBuffer;

        } catch (error) {
            throw new Error(`Wasender API decryption failed: ${error.message}`);
        }
    }

    /**
     * Validate media hash using SHA-256
     */
    async validateMediaHash(data, expectedHash) {
        try {
            const actualHash = crypto.createHash('sha256').update(data).digest('hex');
            
            if (actualHash !== expectedHash) {
                throw new Error(`Media hash validation failed. Expected: ${expectedHash}, Actual: ${actualHash}`);
            }

            this.logger.debug('Media hash validation passed', { 
                hash: actualHash.substring(0, 16) + '...' 
            });

        } catch (error) {
            this.logger.error('Media hash validation failed', { 
                error: error.message,
                expectedHash: expectedHash?.substring(0, 16) + '...'
            });
            throw error;
        }
    }

    /**
     * Generate unique filename for media
     */
    generateFileName(originalName, mediaType, mimeType) {
        const timestamp = Date.now();
        const randomSuffix = crypto.randomBytes(4).toString('hex');
        
        // Extract extension from original name or derive from mime type
        let extension = '';
        if (originalName && originalName.includes('.')) {
            extension = path.extname(originalName);
        } else if (mimeType) {
            extension = this.getExtensionFromMimeType(mimeType);
        } else {
            extension = this.getDefaultExtension(mediaType);
        }

        // Clean original name
        const baseName = originalName 
            ? path.basename(originalName, path.extname(originalName)).replace(/[^a-zA-Z0-9_-]/g, '_')
            : 'media';

        return `${timestamp}_${randomSuffix}_${baseName}${extension}`;
    }

    /**
     * Get file extension from MIME type
     */
    getExtensionFromMimeType(mimeType) {
        const mimeToExt = {
            // Images
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            
            // Videos
            'video/mp4': '.mp4',
            'video/quicktime': '.mov',
            'video/webm': '.webm',
            'video/3gpp': '.3gp',
            
            // Audio
            'audio/mpeg': '.mp3',
            'audio/ogg': '.ogg',
            'audio/wav': '.wav',
            'audio/aac': '.aac',
            'audio/mp4': '.m4a',
            
            // Documents
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'text/plain': '.txt'
        };

        return mimeToExt[mimeType] || '.bin';
    }

    /**
     * Get default extension for media type
     */
    getDefaultExtension(mediaType) {
        const defaults = {
            'image': '.jpg',
            'video': '.mp4',
            'audio': '.mp3',
            'document': '.pdf'
        };

        return defaults[mediaType] || '.bin';
    }

    /**
     * Save decrypted file to appropriate directory (legacy method)
     */
    async saveDecryptedFile(data, fileName, mediaType) {
        try {
            const typeDir = this.getDirectoryForMediaType(mediaType);
            const targetDir = path.join(this.baseAttachmentPath, typeDir);
            const filePath = path.join(targetDir, fileName);

            // Ensure directory exists
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // Write file
            await fs.promises.writeFile(filePath, data);

            this.logger.debug('File saved successfully', { 
                filePath,
                fileSize: data.length 
            });

            // Return relative path for database storage
            return path.join(typeDir, fileName);

        } catch (error) {
            throw new Error(`Failed to save decrypted file: ${error.message}`);
        }
    }

    /**
     * Save decrypted file using enhanced file operations with proper error handling
     */
    async saveDecryptedFileEnhanced(data, fileName, mediaType) {
        try {
            const typeDir = this.getDirectoryForMediaType(mediaType);
            const relativePath = path.join(typeDir, fileName);
            const absolutePath = path.join(this.baseAttachmentPath, relativePath);

            // Use FileDownloadManager's atomic write operation
            await this.fileDownloadManager.writeFileAtomic(absolutePath, data);

            this.logger.debug('File saved with enhanced operations', { 
                relativePath,
                fileSize: data.length 
            });

            // Return relative path for database storage
            return relativePath;

        } catch (error) {
            throw new Error(`Failed to save decrypted file with enhanced operations: ${error.message}`);
        }
    }

    /**
     * Get directory name for media type
     */
    getDirectoryForMediaType(mediaType) {
        const dirMapping = {
            'image': 'IMAGES',
            'video': 'VIDEOS',
            'audio': 'AUDIO',
            'document': 'DOCUMENTS'
        };

        return dirMapping[mediaType] || 'DOCUMENTS';
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
     * Sanitize URL for logging (remove sensitive parts)
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
     * Get absolute path for relative file path
     */
    getAbsolutePath(relativePath) {
        if (!relativePath) return null;
        return path.join(this.baseAttachmentPath, relativePath);
    }

    /**
     * Check if file exists
     */
    async fileExists(relativePath) {
        try {
            const absolutePath = this.getAbsolutePath(relativePath);
            await fs.promises.access(absolutePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get file stats
     */
    async getFileStats(relativePath) {
        try {
            const absolutePath = this.getAbsolutePath(relativePath);
            return await fs.promises.stat(absolutePath);
        } catch (error) {
            throw new Error(`Failed to get file stats: ${error.message}`);
        }
    }

    /**
     * Delete file
     */
    async deleteFile(relativePath) {
        try {
            const absolutePath = this.getAbsolutePath(relativePath);
            await fs.promises.unlink(absolutePath);
            
            this.logger.info('File deleted successfully', { relativePath });
            return true;
        } catch (error) {
            this.logger.error('Failed to delete file', { 
                relativePath, 
                error: error.message 
            });
            return false;
        }
    }

    /**
     * Enhanced file operations using FileDownloadManager
     */

    /**
     * Get enhanced file information
     */
    async getFileInfoEnhanced(relativePath) {
        try {
            const absolutePath = this.getAbsolutePath(relativePath);
            return await this.fileDownloadManager.getFileInfo(absolutePath);
        } catch (error) {
            this.logger.error('Failed to get enhanced file info', { 
                relativePath, 
                error: error.message 
            });
            throw error;
        }
    }

    /**
     * Delete file with verification
     */
    async deleteFileEnhanced(relativePath) {
        try {
            const absolutePath = this.getAbsolutePath(relativePath);
            const result = await this.fileDownloadManager.deleteFileWithVerification(absolutePath);
            
            this.logger.info('File deleted with verification', { relativePath });
            return result;
        } catch (error) {
            this.logger.error('Failed to delete file with verification', { 
                relativePath, 
                error: error.message 
            });
            return false;
        }
    }

    /**
     * Copy file with verification
     */
    async copyFileEnhanced(sourceRelativePath, destRelativePath) {
        try {
            const sourceAbsolutePath = this.getAbsolutePath(sourceRelativePath);
            const destAbsolutePath = this.getAbsolutePath(destRelativePath);
            
            await this.fileDownloadManager.copyFileWithVerification(sourceAbsolutePath, destAbsolutePath);
            
            this.logger.info('File copied with verification', { 
                sourceRelativePath, 
                destRelativePath 
            });
            return true;
        } catch (error) {
            this.logger.error('Failed to copy file with verification', { 
                sourceRelativePath, 
                destRelativePath,
                error: error.message 
            });
            return false;
        }
    }

    /**
     * Move file with verification
     */
    async moveFileEnhanced(sourceRelativePath, destRelativePath) {
        try {
            const sourceAbsolutePath = this.getAbsolutePath(sourceRelativePath);
            const destAbsolutePath = this.getAbsolutePath(destRelativePath);
            
            await this.fileDownloadManager.moveFileWithVerification(sourceAbsolutePath, destAbsolutePath);
            
            this.logger.info('File moved with verification', { 
                sourceRelativePath, 
                destRelativePath 
            });
            return true;
        } catch (error) {
            this.logger.error('Failed to move file with verification', { 
                sourceRelativePath, 
                destRelativePath,
                error: error.message 
            });
            return false;
        }
    }

    /**
     * Get download statistics from FileDownloadManager
     */
    getDownloadStatistics() {
        return this.fileDownloadManager.getDownloadStatistics();
    }

    /**
     * Get service health status including FileDownloadManager
     */
    getHealthStatus() {
        const downloadManagerHealth = this.fileDownloadManager.getHealthStatus();
        
        return {
            mediaDecryptionService: {
                isHealthy: true,
                baseAttachmentPath: this.baseAttachmentPath,
                maxFileSize: this.maxFileSize,
                allowedMediaTypes: this.allowedMediaTypes,
                wasenderClientAvailable: !!this.wasenderClient
            },
            fileDownloadManager: downloadManagerHealth,
            overallHealth: downloadManagerHealth.isHealthy
        };
    }

    /**
     * Cleanup old media files (utility method) - Legacy version
     */
    async cleanupOldFiles(olderThanDays = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

            const directories = ['IMAGES', 'VIDEOS', 'AUDIO', 'DOCUMENTS'];
            let deletedCount = 0;

            for (const dir of directories) {
                const dirPath = path.join(this.baseAttachmentPath, dir);
                
                if (!fs.existsSync(dirPath)) continue;

                const files = await fs.promises.readdir(dirPath);
                
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const stats = await fs.promises.stat(filePath);
                    
                    if (stats.mtime < cutoffDate) {
                        await fs.promises.unlink(filePath);
                        deletedCount++;
                    }
                }
            }

            this.logger.info('Cleanup completed', { 
                deletedFiles: deletedCount,
                olderThanDays 
            });

            return deletedCount;

        } catch (error) {
            this.logger.error('Cleanup failed', { error: error.message });
            throw error;
        }
    }

    /**
     * Enhanced cleanup using FileDownloadManager with comprehensive options
     */
    async cleanupOldFilesEnhanced(options = {}) {
        try {
            this.logger.info('Starting enhanced media cleanup', options);
            
            const result = await this.fileDownloadManager.cleanupOldMediaFiles(options);
            
            this.logger.info('Enhanced cleanup completed', result);
            return result;

        } catch (error) {
            this.logger.error('Enhanced cleanup failed', { error: error.message });
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
            this.logger.error('Failed to get cleanup statistics', { error: error.message });
            throw error;
        }
    }
}

module.exports = MediaDecryptionService;