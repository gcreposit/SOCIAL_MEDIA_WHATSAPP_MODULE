/**
 * MediaDecryptionService Tests
 * Tests for media decryption functionality, file handling, and validation
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MediaDecryptionService = require('../../src/services/mediaDecryptionService');

// Mock dependencies
jest.mock('fs');
jest.mock('../../src/services/loggingService', () => ({
    getServiceLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    })),
    logMediaProcessing: jest.fn()
}));

jest.mock('../../src/services/fileDownloadManager', () => {
    return jest.fn().mockImplementation(() => ({
        downloadEncryptedMedia: jest.fn()
    }));
});

describe('MediaDecryptionService', () => {
    let mediaDecryptionService;
    let mockWasenderClient;
    let mockFileDownloadManager;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Set up environment variables
        process.env.ATTACHMENT_PATH = '/test/attachments/';
        process.env.MAX_FILE_SIZE = '10MB';
        process.env.ALLOWED_MEDIA_TYPES = 'image,video,audio,document';
        
        // Mock WasenderClient
        mockWasenderClient = {
            decryptMedia: jest.fn()
        };
        
        // Mock fs methods
        fs.existsSync.mockReturnValue(false);
        fs.mkdirSync.mockImplementation(() => {});
        fs.writeFileSync.mockImplementation(() => {});
        fs.readFileSync.mockReturnValue(Buffer.from('test file content'));
        
        // Create MediaDecryptionService instance
        mediaDecryptionService = new MediaDecryptionService(mockWasenderClient);
        
        // Get the mocked FileDownloadManager instance
        mockFileDownloadManager = mediaDecryptionService.fileDownloadManager;
    });

    afterEach(() => {
        // Clean up environment variables
        delete process.env.ATTACHMENT_PATH;
        delete process.env.MAX_FILE_SIZE;
        delete process.env.ALLOWED_MEDIA_TYPES;
    });

    describe('Constructor', () => {
        test('should initialize with default configuration', () => {
            expect(mediaDecryptionService.wasenderClient).toBe(mockWasenderClient);
            expect(mediaDecryptionService.baseAttachmentPath).toBe('/test/attachments/');
            expect(mediaDecryptionService.maxFileSize).toBe(10 * 1024 * 1024); // 10MB
            expect(mediaDecryptionService.allowedMediaTypes).toEqual(['image', 'video', 'audio', 'document']);
        });

        test('should create media directories', () => {
            expect(fs.mkdirSync).toHaveBeenCalledWith('/test/attachments/IMAGES', { recursive: true });
            expect(fs.mkdirSync).toHaveBeenCalledWith('/test/attachments/VIDEOS', { recursive: true });
            expect(fs.mkdirSync).toHaveBeenCalledWith('/test/attachments/AUDIO', { recursive: true });
            expect(fs.mkdirSync).toHaveBeenCalledWith('/test/attachments/DOCUMENTS', { recursive: true });
        });

        test('should handle missing environment variables with defaults', () => {
            delete process.env.ATTACHMENT_PATH;
            delete process.env.MAX_FILE_SIZE;
            delete process.env.ALLOWED_MEDIA_TYPES;
            
            const service = new MediaDecryptionService();
            
            expect(service.baseAttachmentPath).toBe('/Users/apple1/Downloads/WHATSAPP_DOCS/');
            expect(service.maxFileSize).toBe(50 * 1024 * 1024); // 50MB default
            expect(service.allowedMediaTypes).toEqual(['image', 'video', 'audio', 'document']);
        });
    });

    describe('File Size Parsing', () => {
        test('should parse file sizes correctly', () => {
            expect(mediaDecryptionService.parseFileSize('1MB')).toBe(1024 * 1024);
            expect(mediaDecryptionService.parseFileSize('500KB')).toBe(500 * 1024);
            expect(mediaDecryptionService.parseFileSize('2GB')).toBe(2 * 1024 * 1024 * 1024);
            expect(mediaDecryptionService.parseFileSize('1024B')).toBe(1024);
        });

        test('should handle invalid file size formats', () => {
            expect(mediaDecryptionService.parseFileSize('invalid')).toBe(50 * 1024 * 1024); // Default 50MB
            expect(mediaDecryptionService.parseFileSize('')).toBe(50 * 1024 * 1024);
        });

        test('should handle decimal values', () => {
            expect(mediaDecryptionService.parseFileSize('1.5MB')).toBe(1.5 * 1024 * 1024);
            expect(mediaDecryptionService.parseFileSize('0.5GB')).toBe(0.5 * 1024 * 1024 * 1024);
        });
    });

    describe('Input Validation', () => {
        test('should validate decryption inputs correctly', () => {
            const validInputs = {
                mediaUrl: 'https://example.com/media.jpg',
                mediaKey: 'valid-media-key',
                mediaType: 'image'
            };

            expect(() => {
                mediaDecryptionService.validateDecryptionInputs(
                    validInputs.mediaUrl,
                    validInputs.mediaKey,
                    validInputs.mediaType
                );
            }).not.toThrow();
        });

        test('should reject missing media URL', () => {
            expect(() => {
                mediaDecryptionService.validateDecryptionInputs(null, 'key', 'image');
            }).toThrow('Media URL is required');
        });

        test('should reject missing media key', () => {
            expect(() => {
                mediaDecryptionService.validateDecryptionInputs('https://example.com/media.jpg', null, 'image');
            }).toThrow('Media key is required');
        });

        test('should reject missing media type', () => {
            expect(() => {
                mediaDecryptionService.validateDecryptionInputs('https://example.com/media.jpg', 'key', null);
            }).toThrow('Media type is required');
        });

        test('should reject invalid media URL format', () => {
            expect(() => {
                mediaDecryptionService.validateDecryptionInputs('not-a-url', 'key', 'image');
            }).toThrow('Invalid media URL format');
        });
    });

    describe('Media Type Validation', () => {
        test('should validate allowed media types', () => {
            expect(() => {
                mediaDecryptionService.validateDecryptionInputs('https://example.com/media.jpg', 'key', 'image');
            }).not.toThrow();

            expect(() => {
                mediaDecryptionService.validateDecryptionInputs('https://example.com/media.mp4', 'key', 'video');
            }).not.toThrow();
        });

        test('should reject disallowed media types', () => {
            expect(() => {
                mediaDecryptionService.validateDecryptionInputs('https://example.com/media.exe', 'key', 'executable');
            }).toThrow('Media type \'executable\' is not allowed');
        });
    });

    describe('Directory Path Generation', () => {
        test('should generate correct directory paths for different media types', () => {
            expect(mediaDecryptionService.getMediaDirectory('image')).toBe('/test/attachments/IMAGES');
            expect(mediaDecryptionService.getMediaDirectory('video')).toBe('/test/attachments/VIDEOS');
            expect(mediaDecryptionService.getMediaDirectory('audio')).toBe('/test/attachments/AUDIO');
            expect(mediaDecryptionService.getMediaDirectory('document')).toBe('/test/attachments/DOCUMENTS');
        });

        test('should handle unknown media types', () => {
            expect(mediaDecryptionService.getMediaDirectory('unknown')).toBe('/test/attachments/DOCUMENTS');
        });
    });

    describe('File Name Generation', () => {
        test('should generate unique file names', () => {
            const metadata = {
                fileName: 'test.jpg',
                mimeType: 'image/jpeg'
            };

            const fileName1 = mediaDecryptionService.generateFileName('image', metadata);
            const fileName2 = mediaDecryptionService.generateFileName('image', metadata);

            expect(fileName1).toMatch(/^test_\d+\.jpg$/);
            expect(fileName2).toMatch(/^test_\d+\.jpg$/);
            expect(fileName1).not.toBe(fileName2);
        });

        test('should handle missing file name in metadata', () => {
            const metadata = {
                mimeType: 'image/jpeg'
            };

            const fileName = mediaDecryptionService.generateFileName('image', metadata);
            expect(fileName).toMatch(/^image_\d+\.jpg$/);
        });

        test('should determine extension from mime type', () => {
            const metadata = {
                fileName: 'test',
                mimeType: 'image/png'
            };

            const fileName = mediaDecryptionService.generateFileName('image', metadata);
            expect(fileName).toMatch(/\.png$/);
        });

        test('should handle unknown mime types', () => {
            const metadata = {
                fileName: 'test',
                mimeType: 'unknown/type'
            };

            const fileName = mediaDecryptionService.generateFileName('image', metadata);
            expect(fileName).toMatch(/^test_\d+$/); // No extension for unknown types
        });
    });

    describe('File Extension Mapping', () => {
        test('should map mime types to extensions correctly', () => {
            expect(mediaDecryptionService.getFileExtensionFromMimeType('image/jpeg')).toBe('jpg');
            expect(mediaDecryptionService.getFileExtensionFromMimeType('image/png')).toBe('png');
            expect(mediaDecryptionService.getFileExtensionFromMimeType('video/mp4')).toBe('mp4');
            expect(mediaDecryptionService.getFileExtensionFromMimeType('audio/mpeg')).toBe('mp3');
            expect(mediaDecryptionService.getFileExtensionFromMimeType('application/pdf')).toBe('pdf');
        });

        test('should handle unknown mime types', () => {
            expect(mediaDecryptionService.getFileExtensionFromMimeType('unknown/type')).toBe('');
            expect(mediaDecryptionService.getFileExtensionFromMimeType(null)).toBe('');
            expect(mediaDecryptionService.getFileExtensionFromMimeType('')).toBe('');
        });
    });

    describe('Hash Validation', () => {
        test('should validate file hash correctly', async () => {
            const testData = Buffer.from('test file content');
            const expectedHash = crypto.createHash('sha256').update(testData).digest('hex'); // Use hex instead of base64

            // The method doesn't return boolean, it throws on invalid hash
            await expect(mediaDecryptionService.validateMediaHash(testData, expectedHash))
                .resolves.toBeUndefined();
        });

        test('should reject invalid hash', async () => {
            const testData = Buffer.from('test file content');
            const wrongHash = 'wrong-hash';

            await expect(mediaDecryptionService.validateMediaHash(testData, wrongHash))
                .rejects.toThrow('Media hash validation failed');
        });

        test('should handle missing hash', async () => {
            const testData = Buffer.from('test file content');

            // Should not throw if no hash provided
            await expect(mediaDecryptionService.validateMediaHash(testData, null))
                .resolves.toBeUndefined();
        });

        test('should handle hash validation errors', async () => {
            const testData = Buffer.from('test file content');
            const malformedHash = 'not-hex-hash!@#';

            await expect(mediaDecryptionService.validateMediaHash(testData, malformedHash))
                .rejects.toThrow('Media hash validation failed');
        });
    });

    describe('Media Decryption Process', () => {
        let mockEncryptedData;
        let mockDecryptedData;

        beforeEach(() => {
            mockEncryptedData = Buffer.from('encrypted-data');
            mockDecryptedData = Buffer.from('decrypted-data');

            mockFileDownloadManager.downloadEncryptedMedia.mockResolvedValue(mockEncryptedData);
            
            // Mock the decryption process
            jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(mockDecryptedData);
            jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
            jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue('/test/path/file.jpg');
        });

        test('should decrypt media successfully', async () => {
            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/media.jpg',
                'media-key-123',
                'image',
                {
                    fileName: 'test.jpg',
                    mimeType: 'image/jpeg',
                    fileSha256: 'test-hash'
                }
            );

            expect(result.success).toBe(true);
            expect(result.filePath).toBe('/test/path/file.jpg');
            expect(result.mediaType).toBe('image');
            expect(mockFileDownloadManager.downloadEncryptedMedia).toHaveBeenCalledWith(
                'https://example.com/media.jpg',
                expect.any(Object)
            );
        });

        test('should handle download failures', async () => {
            mockFileDownloadManager.downloadEncryptedMedia.mockRejectedValue(new Error('Download failed'));

            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/media.jpg',
                'media-key-123',
                'image'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Download failed');
        });

        test('should handle decryption failures', async () => {
            jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockRejectedValue(new Error('Decryption failed'));

            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/media.jpg',
                'media-key-123',
                'image'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Decryption failed');
        });

        test('should handle hash validation failures', async () => {
            jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockRejectedValue(new Error('Hash validation failed'));

            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/media.jpg',
                'media-key-123',
                'image',
                {
                    fileSha256: 'expected-hash'
                }
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Hash validation failed');
        });

        test('should handle file save failures', async () => {
            jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockRejectedValue(new Error('Save failed'));

            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/media.jpg',
                'media-key-123',
                'image'
            );

            expect(result.success).toBe(false);
            expect(result.error).toContain('Save failed');
        });
    });

    describe('File Operations', () => {
        test('should save decrypted file successfully', async () => {
            const testData = Buffer.from('test file content');
            const filePath = '/test/path/file.jpg';

            fs.writeFileSync.mockImplementation(() => {});

            const result = await mediaDecryptionService.saveDecryptedFile(testData, filePath);

            expect(result).toBe(filePath);
            expect(fs.writeFileSync).toHaveBeenCalledWith(filePath, testData);
        });

        test('should handle file save errors', async () => {
            const testData = Buffer.from('test file content');
            const filePath = '/test/path/file.jpg';

            fs.writeFileSync.mockImplementation(() => {
                throw new Error('Permission denied');
            });

            await expect(mediaDecryptionService.saveDecryptedFile(testData, filePath))
                .rejects.toThrow('Permission denied');
        });
    });

    describe('URL Sanitization', () => {
        test('should sanitize URLs for logging', () => {
            const url = 'https://example.com/media/secret-token-123/file.jpg?auth=token';
            const sanitized = mediaDecryptionService.sanitizeUrl(url);

            expect(sanitized).not.toContain('secret-token-123');
            expect(sanitized).not.toContain('auth=token');
            expect(sanitized).toContain('example.com');
        });

        test('should handle null URLs', () => {
            expect(mediaDecryptionService.sanitizeUrl(null)).toBe('[null]');
            expect(mediaDecryptionService.sanitizeUrl(undefined)).toBe('[undefined]');
            expect(mediaDecryptionService.sanitizeUrl('')).toBe('[empty]');
        });
    });

    describe('Retry Logic', () => {
        test('should retry failed operations', async () => {
            let attemptCount = 0;
            mockFileDownloadManager.downloadEncryptedMedia.mockImplementation(() => {
                attemptCount++;
                if (attemptCount < 3) {
                    throw new Error('Temporary failure');
                }
                return Promise.resolve(Buffer.from('success'));
            });

            jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(Buffer.from('decrypted'));
            jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
            jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue('/test/path/file.jpg');

            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/media.jpg',
                'media-key-123',
                'image'
            );

            expect(result.success).toBe(true);
            expect(attemptCount).toBe(3);
        });

        test('should fail after max retries', async () => {
            mockFileDownloadManager.downloadEncryptedMedia.mockRejectedValue(new Error('Persistent failure'));

            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/media.jpg',
                'media-key-123',
                'image'
            );

            expect(result.success).toBe(false);
            expect(mockFileDownloadManager.downloadEncryptedMedia).toHaveBeenCalledTimes(3); // maxRetries
        });
    });

    describe('Metrics and Monitoring', () => {
        test('should track processing metrics', () => {
            const metrics = mediaDecryptionService.getMetrics();

            expect(metrics).toHaveProperty('totalDecryptions');
            expect(metrics).toHaveProperty('successfulDecryptions');
            expect(metrics).toHaveProperty('failedDecryptions');
            expect(metrics).toHaveProperty('averageProcessingTime');
            expect(metrics.timestamp).toBeDefined();
        });

        test('should reset metrics', () => {
            mediaDecryptionService.metrics = {
                totalDecryptions: 10,
                successfulDecryptions: 8,
                failedDecryptions: 2
            };

            mediaDecryptionService.resetMetrics();

            expect(mediaDecryptionService.metrics.totalDecryptions).toBe(0);
            expect(mediaDecryptionService.metrics.successfulDecryptions).toBe(0);
            expect(mediaDecryptionService.metrics.failedDecryptions).toBe(0);
        });
    });

    describe('Health Check', () => {
        test('should return healthy status', () => {
            const health = mediaDecryptionService.healthCheck();

            expect(health.status).toBe('healthy');
            expect(health.timestamp).toBeDefined();
            expect(health.configuration).toBeDefined();
            expect(health.configuration.baseAttachmentPath).toBe('/test/attachments/');
            expect(health.configuration.maxFileSize).toBe(10 * 1024 * 1024);
            expect(health.configuration.allowedMediaTypes).toEqual(['image', 'video', 'audio', 'document']);
        });
    });
});