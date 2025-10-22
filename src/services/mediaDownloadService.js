/**
 * Media Download Service
 * Downloads and stores WhatsApp media files using Wasender decrypt-media API
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { getServiceLogger } = require('./loggingService');

class MediaDownloadService {
    constructor() {
        this.logger = getServiceLogger('media-download');
        this.mediaDirectory = process.env.ATTACHMENT_PATH || './media';
        this.baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        this.wasenderApiKey = process.env.WASENDER_PERSONAL_ACCESS_TOKEN;
        this.wasenderBaseUrl = process.env.WASENDER_BASE_URL || 'https://wasenderapi.com';
        
        // Ensure media directory exists
        this.initializeDirectories();
    }

    /**
     * Initialize media storage directories
     */
    async initializeDirectories() {
        try {
            const directories = [
                this.mediaDirectory,
                path.join(this.mediaDirectory, 'images'),
                path.join(this.mediaDirectory, 'videos'),
                path.join(this.mediaDirectory, 'audio'),
                path.join(this.mediaDirectory, 'documents')
            ];

            for (const dir of directories) {
                await fs.mkdir(dir, { recursive: true });
            }

            this.logger.info('Media directories initialized', {
                baseDirectory: this.mediaDirectory
            });
        } catch (error) {
            this.logger.error('Failed to initialize media directories', {
                error: error.message
            });
        }
    }

    /**
     * Decrypt and download WhatsApp media using Wasender API
     * @param {Object} messageData - Complete message data from WhatsApp
     * @param {string} messageId - Message ID for unique naming
     * @returns {Promise<Object>} Download result with local path and relative path
     */
    async decryptAndDownloadMedia(messageData, messageId) {
        try {
            // Step 1: Call Wasender decrypt-media API
            const decryptResult = await this.decryptMediaWithWasender(messageData, messageId);
            
            if (!decryptResult.success) {
                throw new Error(`Decryption failed: ${decryptResult.error}`);
            }

            // Step 2: Download from temporary public URL
            const downloadResult = await this.downloadFromPublicUrl(
                decryptResult.publicUrl, 
                messageId, 
                decryptResult.mediaType,
                decryptResult.mimeType
            );

            return downloadResult;

        } catch (error) {
            this.logger.error('Failed to decrypt and download media', {
                error: error.message,
                messageId
            });

            return {
                success: false,
                error: error.message,
                localPath: null,
                relativePath: null
            };
        }
    }

    /**
     * Call Wasender decrypt-media API with retry logic
     * @param {Object} messageData - Complete message data
     * @param {string} messageId - Message ID
     * @returns {Promise<Object>} Decryption result
     */
    async decryptMediaWithWasender(messageData, messageId, retryCount = 0) {
        const maxRetries = 2;
        
        try {
            // Determine media type and extract media info
            const mediaInfo = this.extractMediaInfo(messageData.message);
            
            if (!mediaInfo) {
                throw new Error('No media found in message');
            }

            // Prepare payload for Wasender API
            const payload = {
                data: {
                    messages: {
                        key: {
                            id: messageId
                        },
                        message: {}
                    }
                }
            };

            // Add the specific media type to payload
            payload.data.messages.message[mediaInfo.messageType] = mediaInfo.mediaData;

            this.logger.info('Calling Wasender decrypt-media API', {
                messageId,
                mediaType: mediaInfo.type,
                hasMediaKey: !!mediaInfo.mediaData.mediaKey,
                attempt: retryCount + 1,
                maxRetries: maxRetries + 1
            });

            // Determine timeout based on media type
            const timeout = this.getTimeoutForMediaType(mediaInfo.type);

            // Call Wasender API
            const response = await axios({
                method: 'POST',
                url: `${this.wasenderBaseUrl}/api/decrypt-media`,
                headers: {
                    'Authorization': `Bearer ${this.wasenderApiKey}`,
                    'Content-Type': 'application/json'
                },
                data: payload,
                timeout: timeout
            });

            if (response.data && response.data.publicUrl) {
                this.logger.info('Media decrypted successfully', {
                    messageId,
                    mediaType: mediaInfo.type,
                    attempt: retryCount + 1,
                    publicUrl: response.data.publicUrl.substring(0, 50) + '...'
                });

                return {
                    success: true,
                    publicUrl: response.data.publicUrl,
                    mediaType: mediaInfo.type,
                    mimeType: mediaInfo.mediaData.mimetype
                };
            } else {
                throw new Error('Invalid response from decrypt-media API');
            }

        } catch (error) {
            this.logger.error('Wasender decrypt-media API failed', {
                error: error.message,
                messageId,
                attempt: retryCount + 1,
                status: error.response?.status,
                statusText: error.response?.statusText
            });

            // Retry logic for timeout errors
            if (retryCount < maxRetries && (
                error.code === 'ECONNABORTED' || 
                error.message.includes('timeout') ||
                error.response?.status >= 500
            )) {
                this.logger.info('Retrying decrypt-media API call', {
                    messageId,
                    attempt: retryCount + 2,
                    maxRetries: maxRetries + 1
                });
                
                // Wait before retry (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 2000));
                
                return this.decryptMediaWithWasender(messageData, messageId, retryCount + 1);
            }

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get appropriate timeout for different media types
     * @param {string} mediaType - Media type
     * @returns {number} Timeout in milliseconds
     */
    getTimeoutForMediaType(mediaType) {
        const timeouts = {
            'image': 60000,     // 1 minute
            'audio': 90000,     // 1.5 minutes
            'video': 180000,    // 3 minutes
            'document': 240000, // 4 minutes
            'sticker': 30000    // 30 seconds
        };

        return timeouts[mediaType] || 120000; // Default 2 minutes
    }

    /**
     * Extract media information from message
     * @param {Object} message - WhatsApp message object
     * @returns {Object|null} Media information
     */
    extractMediaInfo(message) {
        if (message.imageMessage) {
            return {
                type: 'image',
                messageType: 'imageMessage',
                mediaData: message.imageMessage
            };
        }
        
        if (message.videoMessage) {
            return {
                type: 'video',
                messageType: 'videoMessage',
                mediaData: message.videoMessage
            };
        }
        
        if (message.audioMessage) {
            return {
                type: 'audio',
                messageType: 'audioMessage',
                mediaData: message.audioMessage
            };
        }
        
        if (message.documentMessage) {
            return {
                type: 'document',
                messageType: 'documentMessage',
                mediaData: message.documentMessage
            };
        }
        
        if (message.stickerMessage) {
            return {
                type: 'sticker',
                messageType: 'stickerMessage',
                mediaData: message.stickerMessage
            };
        }

        return null;
    }

    /**
     * Download file from temporary public URL and save locally
     * @param {string} publicUrl - Temporary public URL from Wasender
     * @param {string} messageId - Message ID for naming
     * @param {string} mediaType - Media type (image, video, etc.)
     * @param {string} mimeType - MIME type
     * @returns {Promise<Object>} Download result
     */
    async downloadFromPublicUrl(publicUrl, messageId, mediaType, mimeType) {
        try {
            // Generate unique filename
            const fileExtension = this.getFileExtension(mimeType);
            const uniqueFileName = `${messageId}_${Date.now()}${fileExtension}`;
            
            // Determine subdirectory based on media type
            const subDirectory = this.getSubDirectory(mediaType);
            const absolutePath = path.join(this.mediaDirectory, subDirectory, uniqueFileName);
            const relativePath = path.join(subDirectory, uniqueFileName);
            
            this.logger.info('Downloading from public URL', {
                publicUrl: publicUrl.substring(0, 50) + '...',
                fileName: uniqueFileName,
                mediaType
            });

            // Download file
            const response = await axios({
                method: 'GET',
                url: publicUrl,
                responseType: 'stream',
                timeout: 180000 // 3 minutes for large file downloads
            });

            // Save file to local storage
            const writer = require('fs').createWriteStream(absolutePath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            // Get file stats
            const stats = await fs.stat(absolutePath);

            this.logger.info('Media file saved successfully', {
                absolutePath,
                relativePath,
                fileSize: stats.size
            });

            return {
                success: true,
                absolutePath,
                relativePath,
                fileName: uniqueFileName,
                mimeType,
                fileSize: stats.size
            };

        } catch (error) {
            this.logger.error('Failed to download from public URL', {
                error: error.message,
                publicUrl: publicUrl?.substring(0, 50) + '...'
            });

            return {
                success: false,
                error: error.message,
                absolutePath: null,
                relativePath: null
            };
        }
    }

    /**
     * Get file extension based on MIME type
     */
    getFileExtension(mimeType, fileName = null) {
        if (fileName && fileName.includes('.')) {
            return path.extname(fileName);
        }

        const mimeToExt = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'video/mp4': '.mp4',
            'video/avi': '.avi',
            'video/mov': '.mov',
            'video/quicktime': '.mov',
            'audio/mp3': '.mp3',
            'audio/mpeg': '.mp3',
            'audio/wav': '.wav',
            'audio/ogg': '.ogg',
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'text/plain': '.txt'
        };

        return mimeToExt[mimeType] || '.bin';
    }

    /**
     * Get subdirectory based on media type
     */
    getSubDirectory(type) {
        const typeMap = {
            'image': 'images',
            'video': 'videos',
            'audio': 'audio',
            'document': 'documents'
        };

        return typeMap[type] || 'documents';
    }

    /**
     * Serve media file as byte array
     * @param {string} filePath - Local file path
     * @returns {Promise<Buffer>} File buffer
     */
    async getMediaBuffer(filePath) {
        try {
            const fullPath = path.join(this.mediaDirectory, filePath);
            const buffer = await fs.readFile(fullPath);
            
            this.logger.debug('Media file served', {
                filePath,
                size: buffer.length
            });

            return buffer;
        } catch (error) {
            this.logger.error('Failed to read media file', {
                error: error.message,
                filePath
            });
            throw error;
        }
    }
}

module.exports = MediaDownloadService;