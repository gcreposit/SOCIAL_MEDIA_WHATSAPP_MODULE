/**
 * File Download Manager for Wasender API Migration
 * Implements encrypted media download from Wasender URLs with proper error handling
 * Provides file system operations and cleanup maintenance for old media files
 * Requirements: 4.1, 4.2, 4.3
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getServiceLogger } = require('./loggingService');

class FileDownloadManager {
    constructor() {
        this.logger = getServiceLogger('file-download');
        
        // Configuration
        this.baseAttachmentPath = process.env.ATTACHMENT_PATH || '/Users/apple1/Downloads/WHATSAPP_DOCS/';
        this.maxFileSize = this.parseFileSize(process.env.MAX_FILE_SIZE || '50MB');
        this.downloadTimeout = parseInt(process.env.DOWNLOAD_TIMEOUT || '30000');
        this.maxRetries = parseInt(process.env.MAX_DOWNLOAD_RETRIES || '3');
        this.retryDelay = parseInt(process.env.RETRY_DELAY || '1000');
        
        // Download statistics
        this.downloadStats = {
            totalDownloads: 0,
            successfulDownloads: 0,
            failedDownloads: 0,
            totalBytesDownloaded: 0,
            averageDownloadTime: 0
        };
        
        // Concurrent download limits
        this.maxConcurrentDownloads = parseInt(process.env.MAX_CONCURRENT_DOWNLOADS || '5');
        this.activeDownloads = new Map();
        
        this.logger.info('FileDownloadManager initialized', {
            baseAttachmentPath: this.baseAttachmentPath,
            maxFileSize: this.maxFileSize,
            downloadTimeout: this.downloadTimeout,
            maxRetries: this.maxRetries
        });
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
     * Download encrypted media from Wasender URLs with enhanced error handling
     * @param {string} mediaUrl - Encrypted media URL from WhatsApp
     * @param {Object} options - Download options
     * @returns {Promise<Buffer>} Downloaded encrypted data
     */
    async downloadEncryptedMedia(mediaUrl, options = {}) {
        const downloadId = crypto.randomBytes(8).toString('hex');
        const startTime = Date.now();
        
        try {
            this.logger.info('Starting encrypted media download', {
                downloadId,
                mediaUrl: this.sanitizeUrl(mediaUrl),
                options
            });

            // Validate URL
            this.validateMediaUrl(mediaUrl);

            // Check concurrent download limit
            await this.waitForDownloadSlot(downloadId);

            // Track active download
            this.activeDownloads.set(downloadId, {
                url: mediaUrl,
                startTime,
                status: 'downloading'
            });

            // Download with retry logic
            const encryptedData = await this.downloadWithRetry(mediaUrl, options, downloadId);

            // Update statistics
            const downloadTime = Date.now() - startTime;
            this.updateDownloadStats(true, encryptedData.length, downloadTime);

            this.logger.info('Encrypted media download completed', {
                downloadId,
                fileSize: encryptedData.length,
                downloadTime: `${downloadTime}ms`
            });

            return encryptedData;

        } catch (error) {
            const downloadTime = Date.now() - startTime;
            this.updateDownloadStats(false, 0, downloadTime);

            this.logger.error('Encrypted media download failed', {
                downloadId,
                mediaUrl: this.sanitizeUrl(mediaUrl),
                error: error.message,
                downloadTime: `${downloadTime}ms`
            });

            throw error;
        } finally {
            // Clean up active download tracking
            this.activeDownloads.delete(downloadId);
        }
    }

    /**
     * Validate media URL
     */
    validateMediaUrl(mediaUrl) {
        if (!mediaUrl || typeof mediaUrl !== 'string') {
            throw new Error('Invalid media URL provided');
        }

        try {
            const url = new URL(mediaUrl);
            
            // Check if URL is HTTPS
            if (url.protocol !== 'https:') {
                throw new Error('Media URL must use HTTPS protocol');
            }

            // Basic validation for WhatsApp media URLs
            if (!url.hostname.includes('whatsapp') && !url.hostname.includes('wasender')) {
                this.logger.warn('Media URL from unexpected domain', {
                    hostname: url.hostname
                });
            }

        } catch (urlError) {
            throw new Error(`Invalid media URL format: ${urlError.message}`);
        }
    }

    /**
     * Wait for available download slot
     */
    async waitForDownloadSlot(downloadId) {
        while (this.activeDownloads.size >= this.maxConcurrentDownloads) {
            this.logger.debug('Waiting for download slot', {
                downloadId,
                activeDownloads: this.activeDownloads.size,
                maxConcurrent: this.maxConcurrentDownloads
            });
            
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Download with retry logic and proper error handling
     */
    async downloadWithRetry(mediaUrl, options, downloadId) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                this.logger.debug('Download attempt', {
                    downloadId,
                    attempt,
                    maxRetries: this.maxRetries
                });

                const data = await this.performDownload(mediaUrl, options);
                
                if (attempt > 1) {
                    this.logger.info('Download succeeded after retry', {
                        downloadId,
                        attempt
                    });
                }
                
                return data;

            } catch (error) {
                lastError = error;
                
                this.logger.warn('Download attempt failed', {
                    downloadId,
                    attempt,
                    error: error.message
                });

                // Don't retry for certain error types
                if (this.isNonRetryableError(error)) {
                    throw error;
                }

                // Wait before retry (exponential backoff)
                if (attempt < this.maxRetries) {
                    const delay = this.retryDelay * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`Download failed after ${this.maxRetries} attempts: ${lastError.message}`);
    }

    /**
     * Perform the actual download
     */
    async performDownload(mediaUrl, options) {
        const downloadOptions = {
            responseType: 'arraybuffer',
            timeout: options.timeout || this.downloadTimeout,
            maxContentLength: options.maxSize || this.maxFileSize,
            maxBodyLength: options.maxSize || this.maxFileSize,
            headers: {
                'User-Agent': 'Wasender-Client/1.0',
                ...options.headers
            }
        };

        const response = await axios.get(mediaUrl, downloadOptions);

        if (!response.data || response.data.byteLength === 0) {
            throw new Error('Empty media file downloaded');
        }

        // Validate content type if provided
        if (options.expectedContentType) {
            const contentType = response.headers['content-type'];
            if (contentType && !contentType.includes(options.expectedContentType)) {
                this.logger.warn('Unexpected content type', {
                    expected: options.expectedContentType,
                    actual: contentType
                });
            }
        }

        return Buffer.from(response.data);
    }

    /**
     * Check if error is non-retryable
     */
    isNonRetryableError(error) {
        const nonRetryableErrors = [
            'ENOTFOUND',     // DNS resolution failed
            'ECONNREFUSED',  // Connection refused
            'Invalid media URL',
            'Empty media file'
        ];

        return nonRetryableErrors.some(errorType => 
            error.message.includes(errorType) || error.code === errorType
        ) || (error.response && error.response.status === 404);
    }

    /**
     * Update download statistics
     */
    updateDownloadStats(success, bytes, downloadTime) {
        this.downloadStats.totalDownloads++;
        
        if (success) {
            this.downloadStats.successfulDownloads++;
            this.downloadStats.totalBytesDownloaded += bytes;
        } else {
            this.downloadStats.failedDownloads++;
        }

        // Update average download time
        const totalTime = (this.downloadStats.averageDownloadTime * (this.downloadStats.totalDownloads - 1)) + downloadTime;
        this.downloadStats.averageDownloadTime = totalTime / this.downloadStats.totalDownloads;
    }

    /**
     * Enhanced file system operations with proper error handling
     */

    /**
     * Ensure directory exists with proper permissions
     */
    async ensureDirectory(dirPath) {
        try {
            await fs.promises.access(dirPath);
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                try {
                    await fs.promises.mkdir(dirPath, { 
                        recursive: true, 
                        mode: 0o755 
                    });
                    
                    this.logger.debug('Created directory', { dirPath });
                    return true;
                } catch (mkdirError) {
                    this.logger.error('Failed to create directory', {
                        dirPath,
                        error: mkdirError.message
                    });
                    throw new Error(`Failed to create directory ${dirPath}: ${mkdirError.message}`);
                }
            } else {
                throw new Error(`Directory access error ${dirPath}: ${error.message}`);
            }
        }
    }

    /**
     * Write file with atomic operation and proper error handling
     */
    async writeFileAtomic(filePath, data) {
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        
        try {
            // Ensure directory exists
            await this.ensureDirectory(path.dirname(filePath));

            // Write to temporary file first
            await fs.promises.writeFile(tempPath, data, { mode: 0o644 });

            // Verify file was written correctly
            const stats = await fs.promises.stat(tempPath);
            if (stats.size !== data.length) {
                throw new Error('File size mismatch after writing');
            }

            // Atomically move to final location
            await fs.promises.rename(tempPath, filePath);

            this.logger.debug('File written atomically', {
                filePath,
                fileSize: data.length
            });

            return filePath;

        } catch (error) {
            // Clean up temporary file if it exists
            try {
                await fs.promises.unlink(tempPath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }

            this.logger.error('Atomic file write failed', {
                filePath,
                tempPath,
                error: error.message
            });

            throw new Error(`Failed to write file ${filePath}: ${error.message}`);
        }
    }

    /**
     * Copy file with verification
     */
    async copyFileWithVerification(sourcePath, destPath) {
        try {
            // Ensure destination directory exists
            await this.ensureDirectory(path.dirname(destPath));

            // Copy file
            await fs.promises.copyFile(sourcePath, destPath);

            // Verify copy
            const sourceStats = await fs.promises.stat(sourcePath);
            const destStats = await fs.promises.stat(destPath);

            if (sourceStats.size !== destStats.size) {
                throw new Error('File size mismatch after copy');
            }

            this.logger.debug('File copied with verification', {
                sourcePath,
                destPath,
                fileSize: sourceStats.size
            });

            return destPath;

        } catch (error) {
            this.logger.error('File copy failed', {
                sourcePath,
                destPath,
                error: error.message
            });

            throw new Error(`Failed to copy file: ${error.message}`);
        }
    }

    /**
     * Move file with verification
     */
    async moveFileWithVerification(sourcePath, destPath) {
        try {
            // Ensure destination directory exists
            await this.ensureDirectory(path.dirname(destPath));

            // Get source file stats before move
            const sourceStats = await fs.promises.stat(sourcePath);

            // Move file
            await fs.promises.rename(sourcePath, destPath);

            // Verify move
            const destStats = await fs.promises.stat(destPath);

            if (sourceStats.size !== destStats.size) {
                throw new Error('File size mismatch after move');
            }

            this.logger.debug('File moved with verification', {
                sourcePath,
                destPath,
                fileSize: destStats.size
            });

            return destPath;

        } catch (error) {
            this.logger.error('File move failed', {
                sourcePath,
                destPath,
                error: error.message
            });

            throw new Error(`Failed to move file: ${error.message}`);
        }
    }

    /**
     * Delete file with proper error handling
     */
    async deleteFileWithVerification(filePath) {
        try {
            // Check if file exists
            await fs.promises.access(filePath);

            // Delete file
            await fs.promises.unlink(filePath);

            // Verify deletion
            try {
                await fs.promises.access(filePath);
                throw new Error('File still exists after deletion');
            } catch (accessError) {
                if (accessError.code !== 'ENOENT') {
                    throw accessError;
                }
            }

            this.logger.debug('File deleted with verification', { filePath });
            return true;

        } catch (error) {
            if (error.code === 'ENOENT') {
                this.logger.debug('File already deleted or does not exist', { filePath });
                return true;
            }

            this.logger.error('File deletion failed', {
                filePath,
                error: error.message
            });

            throw new Error(`Failed to delete file ${filePath}: ${error.message}`);
        }
    }

    /**
     * Get file information with error handling
     */
    async getFileInfo(filePath) {
        try {
            const stats = await fs.promises.stat(filePath);
            
            return {
                exists: true,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
                accessed: stats.atime,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                permissions: stats.mode
            };

        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    exists: false,
                    error: 'File not found'
                };
            }

            this.logger.error('Failed to get file info', {
                filePath,
                error: error.message
            });

            return {
                exists: false,
                error: error.message
            };
        }
    }

    /**
     * Enhanced cleanup and maintenance for old media files
     */

    /**
     * Cleanup old media files with comprehensive options
     */
    async cleanupOldMediaFiles(options = {}) {
        const startTime = Date.now();
        
        const cleanupOptions = {
            olderThanDays: options.olderThanDays || 30,
            dryRun: options.dryRun || false,
            maxFilesToDelete: options.maxFilesToDelete || 1000,
            excludePatterns: options.excludePatterns || [],
            includeEmptyDirectories: options.includeEmptyDirectories !== false,
            ...options
        };

        try {
            this.logger.info('Starting media files cleanup', cleanupOptions);

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - cleanupOptions.olderThanDays);

            const cleanupResult = {
                filesDeleted: 0,
                directoriesDeleted: 0,
                bytesFreed: 0,
                errors: [],
                processedDirectories: []
            };

            // Get all media directories
            const mediaDirectories = ['IMAGES', 'VIDEOS', 'AUDIO', 'DOCUMENTS'];

            for (const mediaDir of mediaDirectories) {
                const dirPath = path.join(this.baseAttachmentPath, mediaDir);
                
                if (await this.directoryExists(dirPath)) {
                    const dirResult = await this.cleanupDirectory(
                        dirPath, 
                        cutoffDate, 
                        cleanupOptions
                    );
                    
                    cleanupResult.filesDeleted += dirResult.filesDeleted;
                    cleanupResult.directoriesDeleted += dirResult.directoriesDeleted;
                    cleanupResult.bytesFreed += dirResult.bytesFreed;
                    cleanupResult.errors.push(...dirResult.errors);
                    cleanupResult.processedDirectories.push(mediaDir);
                }
            }

            const processingTime = Date.now() - startTime;

            this.logger.info('Media files cleanup completed', {
                ...cleanupResult,
                processingTime: `${processingTime}ms`,
                dryRun: cleanupOptions.dryRun
            });

            return cleanupResult;

        } catch (error) {
            const processingTime = Date.now() - startTime;
            
            this.logger.error('Media files cleanup failed', {
                error: error.message,
                processingTime: `${processingTime}ms`
            });

            throw error;
        }
    }

    /**
     * Cleanup specific directory recursively
     */
    async cleanupDirectory(dirPath, cutoffDate, options) {
        const result = {
            filesDeleted: 0,
            directoriesDeleted: 0,
            bytesFreed: 0,
            errors: []
        };

        try {
            const items = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const item of items) {
                const itemPath = path.join(dirPath, item.name);

                try {
                    if (item.isDirectory()) {
                        // Recursively cleanup subdirectory
                        const subResult = await this.cleanupDirectory(itemPath, cutoffDate, options);
                        
                        result.filesDeleted += subResult.filesDeleted;
                        result.directoriesDeleted += subResult.directoriesDeleted;
                        result.bytesFreed += subResult.bytesFreed;
                        result.errors.push(...subResult.errors);

                        // Remove empty directory if option is enabled
                        if (options.includeEmptyDirectories) {
                            const remainingItems = await fs.promises.readdir(itemPath);
                            if (remainingItems.length === 0) {
                                if (!options.dryRun) {
                                    await fs.promises.rmdir(itemPath);
                                }
                                result.directoriesDeleted++;
                                
                                this.logger.debug('Removed empty directory', { 
                                    itemPath, 
                                    dryRun: options.dryRun 
                                });
                            }
                        }

                    } else if (item.isFile()) {
                        // Check if file should be deleted
                        const shouldDelete = await this.shouldDeleteFile(
                            itemPath, 
                            cutoffDate, 
                            options
                        );

                        if (shouldDelete.delete) {
                            const fileSize = shouldDelete.fileSize || 0;
                            
                            if (!options.dryRun) {
                                await fs.promises.unlink(itemPath);
                            }
                            
                            result.filesDeleted++;
                            result.bytesFreed += fileSize;
                            
                            this.logger.debug('Deleted old file', { 
                                itemPath, 
                                fileSize,
                                dryRun: options.dryRun 
                            });
                        }

                        // Stop if we've reached the maximum files to delete
                        if (result.filesDeleted >= options.maxFilesToDelete) {
                            this.logger.info('Reached maximum files to delete limit', {
                                maxFiles: options.maxFilesToDelete
                            });
                            break;
                        }
                    }

                } catch (itemError) {
                    result.errors.push({
                        path: itemPath,
                        error: itemError.message
                    });
                    
                    this.logger.error('Error processing item during cleanup', {
                        itemPath,
                        error: itemError.message
                    });
                }
            }

        } catch (error) {
            result.errors.push({
                path: dirPath,
                error: error.message
            });
            
            this.logger.error('Error reading directory during cleanup', {
                dirPath,
                error: error.message
            });
        }

        return result;
    }

    /**
     * Determine if file should be deleted based on criteria
     */
    async shouldDeleteFile(filePath, cutoffDate, options) {
        try {
            const stats = await fs.promises.stat(filePath);
            
            // Check age
            if (stats.mtime >= cutoffDate) {
                return { delete: false, reason: 'File is not old enough' };
            }

            // Check exclude patterns
            const fileName = path.basename(filePath);
            for (const pattern of options.excludePatterns) {
                if (fileName.match(pattern)) {
                    return { delete: false, reason: `Matches exclude pattern: ${pattern}` };
                }
            }

            return { 
                delete: true, 
                fileSize: stats.size,
                lastModified: stats.mtime 
            };

        } catch (error) {
            return { 
                delete: false, 
                reason: `Error checking file: ${error.message}` 
            };
        }
    }

    /**
     * Check if directory exists
     */
    async directoryExists(dirPath) {
        try {
            const stats = await fs.promises.stat(dirPath);
            return stats.isDirectory();
        } catch {
            return false;
        }
    }

    /**
     * Get cleanup statistics
     */
    async getCleanupStatistics() {
        try {
            const stats = {
                totalFiles: 0,
                totalSize: 0,
                oldFiles: 0,
                oldFilesSize: 0,
                directories: {}
            };

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30); // Default 30 days

            const mediaDirectories = ['IMAGES', 'VIDEOS', 'AUDIO', 'DOCUMENTS'];

            for (const mediaDir of mediaDirectories) {
                const dirPath = path.join(this.baseAttachmentPath, mediaDir);
                
                if (await this.directoryExists(dirPath)) {
                    const dirStats = await this.getDirectoryStatistics(dirPath, cutoffDate);
                    
                    stats.totalFiles += dirStats.totalFiles;
                    stats.totalSize += dirStats.totalSize;
                    stats.oldFiles += dirStats.oldFiles;
                    stats.oldFilesSize += dirStats.oldFilesSize;
                    stats.directories[mediaDir] = dirStats;
                }
            }

            return stats;

        } catch (error) {
            this.logger.error('Failed to get cleanup statistics', {
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get statistics for a specific directory
     */
    async getDirectoryStatistics(dirPath, cutoffDate) {
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
                    const subStats = await this.getDirectoryStatistics(itemPath, cutoffDate);
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
            this.logger.error('Error getting directory statistics', {
                dirPath,
                error: error.message
            });
        }

        return stats;
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
     * Get download statistics
     */
    getDownloadStatistics() {
        return {
            ...this.downloadStats,
            activeDownloads: this.activeDownloads.size,
            maxConcurrentDownloads: this.maxConcurrentDownloads
        };
    }

    /**
     * Reset download statistics
     */
    resetDownloadStatistics() {
        this.downloadStats = {
            totalDownloads: 0,
            successfulDownloads: 0,
            failedDownloads: 0,
            totalBytesDownloaded: 0,
            averageDownloadTime: 0
        };
        
        this.logger.info('Download statistics reset');
    }

    /**
     * Get service health status
     */
    getHealthStatus() {
        return {
            isHealthy: true,
            baseAttachmentPath: this.baseAttachmentPath,
            maxFileSize: this.maxFileSize,
            downloadTimeout: this.downloadTimeout,
            maxRetries: this.maxRetries,
            activeDownloads: this.activeDownloads.size,
            downloadStats: this.downloadStats
        };
    }
}

module.exports = FileDownloadManager;