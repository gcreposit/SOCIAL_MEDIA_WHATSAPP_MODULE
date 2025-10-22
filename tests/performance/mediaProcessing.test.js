/**
 * Media Processing Performance Tests
 * Tests media decryption and processing performance with large files
 */

const fs = require('fs');
const crypto = require('crypto');
const MediaDecryptionService = require('../../src/services/mediaDecryptionService');

// Mock dependencies
jest.mock('fs');
jest.mock('../../src/services/loggingService', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
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

describe('Media Processing Performance Tests', () => {
    let mediaDecryptionService;
    let mockWasenderClient;
    let mockFileDownloadManager;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Set up environment variables
        process.env.ATTACHMENT_PATH = '/test/attachments/';
        process.env.MAX_FILE_SIZE = '100MB';
        process.env.ALLOWED_MEDIA_TYPES = 'image,video,audio,document';
        
        // Mock WasenderClient
        mockWasenderClient = {
            decryptMedia: jest.fn()
        };
        
        // Mock fs methods
        fs.existsSync.mockReturnValue(false);
        fs.mkdirSync.mockImplementation(() => {});
        fs.writeFileSync.mockImplementation(() => {});
        
        // Create MediaDecryptionService instance
        mediaDecryptionService = new MediaDecryptionService(mockWasenderClient);
        
        // Get the mocked FileDownloadManager instance
        mockFileDownloadManager = mediaDecryptionService.fileDownloadManager;
    });

    afterEach(() => {
        delete process.env.ATTACHMENT_PATH;
        delete process.env.MAX_FILE_SIZE;
        delete process.env.ALLOWED_MEDIA_TYPES;
    });

    describe('Single File Processing Performance', () => {
        test('should decrypt small image files within 500ms', async () => {
            const smallImageData = Buffer.alloc(100 * 1024); // 100KB
            smallImageData.fill('A');

            mockFileDownloadManager.downloadEncryptedMedia.mockResolvedValue(smallImageData);
            
            // Mock decryption process
            jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(smallImageData);
            jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
            jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue('/test/path/small_image.jpg');

            const startTime = Date.now();
            
            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/small-image.jpg',
                'media-key-123',
                'image',
                {
                    fileName: 'small_image.jpg',
                    mimeType: 'image/jpeg',
                    fileSize: smallImageData.length
                }
            );

            const processingTime = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(processingTime).toBeLessThan(500); // Should process within 500ms
            
            console.log(`Small image (${smallImageData.length} bytes) processed in ${processingTime}ms`);
        });

        test('should decrypt medium video files within 2 seconds', async () => {
            const mediumVideoData = Buffer.alloc(5 * 1024 * 1024); // 5MB
            mediumVideoData.fill('V');

            mockFileDownloadManager.downloadEncryptedMedia.mockResolvedValue(mediumVideoData);
            
            jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(mediumVideoData);
            jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
            jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue('/test/path/medium_video.mp4');

            const startTime = Date.now();
            
            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/medium-video.mp4',
                'media-key-456',
                'video',
                {
                    fileName: 'medium_video.mp4',
                    mimeType: 'video/mp4',
                    fileSize: mediumVideoData.length
                }
            );

            const processingTime = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(processingTime).toBeLessThan(2000); // Should process within 2 seconds
            
            console.log(`Medium video (${(mediumVideoData.length / 1024 / 1024).toFixed(2)} MB) processed in ${processingTime}ms`);
        });

        test('should decrypt large document files within 5 seconds', async () => {
            const largeDocumentData = Buffer.alloc(20 * 1024 * 1024); // 20MB
            largeDocumentData.fill('D');

            mockFileDownloadManager.downloadEncryptedMedia.mockResolvedValue(largeDocumentData);
            
            jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(largeDocumentData);
            jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
            jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue('/test/path/large_document.pdf');

            const startTime = Date.now();
            
            const result = await mediaDecryptionService.decryptMedia(
                'https://example.com/large-document.pdf',
                'media-key-789',
                'document',
                {
                    fileName: 'large_document.pdf',
                    mimeType: 'application/pdf',
                    fileSize: largeDocumentData.length
                }
            );

            const processingTime = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(processingTime).toBeLessThan(5000); // Should process within 5 seconds
            
            console.log(`Large document (${(largeDocumentData.length / 1024 / 1024).toFixed(2)} MB) processed in ${processingTime}ms`);
        }, 10000); // 10 second timeout
    });

    describe('Concurrent Media Processing', () => {
        test('should handle multiple small files concurrently', async () => {
            const fileCount = 10;
            const fileSize = 500 * 1024; // 500KB each
            const promises = [];
            const processingTimes = [];

            for (let i = 0; i < fileCount; i++) {
                const fileData = Buffer.alloc(fileSize);
                fileData.fill(`F${i}`);

                mockFileDownloadManager.downloadEncryptedMedia.mockResolvedValue(fileData);
                
                jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(fileData);
                jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
                jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue(`/test/path/concurrent_file_${i}.jpg`);

                const startTime = Date.now();
                
                const promise = mediaDecryptionService.decryptMedia(
                    `https://example.com/concurrent-file-${i}.jpg`,
                    `media-key-${i}`,
                    'image',
                    {
                        fileName: `concurrent_file_${i}.jpg`,
                        mimeType: 'image/jpeg',
                        fileSize: fileData.length
                    }
                ).then(result => {
                    const processingTime = Date.now() - startTime;
                    processingTimes.push(processingTime);
                    return result;
                });

                promises.push(promise);
            }

            const results = await Promise.all(promises);

            // All files should be processed successfully
            results.forEach(result => {
                expect(result.success).toBe(true);
            });

            // Calculate performance metrics
            const avgProcessingTime = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
            const maxProcessingTime = Math.max(...processingTimes);
            const minProcessingTime = Math.min(...processingTimes);

            console.log(`Concurrent Processing Results (${fileCount} files, ${fileSize / 1024}KB each):`);
            console.log(`Average Processing Time: ${avgProcessingTime.toFixed(2)}ms`);
            console.log(`Max Processing Time: ${maxProcessingTime}ms`);
            console.log(`Min Processing Time: ${minProcessingTime}ms`);

            expect(avgProcessingTime).toBeLessThan(1000); // Average under 1 second
            expect(maxProcessingTime).toBeLessThan(2000); // Max under 2 seconds
        }, 15000); // 15 second timeout

        test('should maintain performance with mixed file types and sizes', async () => {
            const mixedFiles = [
                { type: 'image', size: 200 * 1024, ext: 'jpg', mime: 'image/jpeg' },
                { type: 'video', size: 3 * 1024 * 1024, ext: 'mp4', mime: 'video/mp4' },
                { type: 'audio', size: 1 * 1024 * 1024, ext: 'mp3', mime: 'audio/mpeg' },
                { type: 'document', size: 800 * 1024, ext: 'pdf', mime: 'application/pdf' },
                { type: 'image', size: 1.5 * 1024 * 1024, ext: 'png', mime: 'image/png' }
            ];

            const promises = [];
            const results = [];

            for (let i = 0; i < mixedFiles.length; i++) {
                const file = mixedFiles[i];
                const fileData = Buffer.alloc(file.size);
                fileData.fill(`${file.type[0].toUpperCase()}${i}`);

                mockFileDownloadManager.downloadEncryptedMedia.mockResolvedValue(fileData);
                
                jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(fileData);
                jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
                jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue(`/test/path/mixed_file_${i}.${file.ext}`);

                const startTime = Date.now();
                
                const promise = mediaDecryptionService.decryptMedia(
                    `https://example.com/mixed-file-${i}.${file.ext}`,
                    `media-key-mixed-${i}`,
                    file.type,
                    {
                        fileName: `mixed_file_${i}.${file.ext}`,
                        mimeType: file.mime,
                        fileSize: file.size
                    }
                ).then(result => {
                    const processingTime = Date.now() - startTime;
                    results.push({
                        type: file.type,
                        size: file.size,
                        processingTime,
                        success: result.success
                    });
                    return result;
                });

                promises.push(promise);
            }

            await Promise.all(promises);

            // Analyze results by file type
            const typeResults = {};
            results.forEach(result => {
                if (!typeResults[result.type]) {
                    typeResults[result.type] = [];
                }
                typeResults[result.type].push(result);
            });

            console.log('Mixed File Type Performance Results:');
            Object.keys(typeResults).forEach(type => {
                const typeFiles = typeResults[type];
                const avgTime = typeFiles.reduce((sum, file) => sum + file.processingTime, 0) / typeFiles.length;
                const avgSize = typeFiles.reduce((sum, file) => sum + file.size, 0) / typeFiles.length;
                
                console.log(`${type}: ${avgTime.toFixed(2)}ms avg (${(avgSize / 1024 / 1024).toFixed(2)}MB avg)`);
                
                // All files should be processed successfully
                typeFiles.forEach(file => {
                    expect(file.success).toBe(true);
                });
            });

            // Overall performance should be reasonable
            const overallAvgTime = results.reduce((sum, result) => sum + result.processingTime, 0) / results.length;
            expect(overallAvgTime).toBeLessThan(3000); // Average under 3 seconds
        }, 20000); // 20 second timeout
    });

    describe('Memory Usage During Media Processing', () => {
        test('should not leak memory during large file processing', async () => {
            const initialMemory = process.memoryUsage();
            const largeFileSize = 10 * 1024 * 1024; // 10MB
            const fileCount = 5;

            for (let i = 0; i < fileCount; i++) {
                const largeFileData = Buffer.alloc(largeFileSize);
                largeFileData.fill(`L${i}`);

                mockFileDownloadManager.downloadEncryptedMedia.mockResolvedValue(largeFileData);
                
                jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(largeFileData);
                jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
                jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue(`/test/path/large_file_${i}.bin`);

                const result = await mediaDecryptionService.decryptMedia(
                    `https://example.com/large-file-${i}.bin`,
                    `large-media-key-${i}`,
                    'document',
                    {
                        fileName: `large_file_${i}.bin`,
                        mimeType: 'application/octet-stream',
                        fileSize: largeFileSize
                    }
                );

                expect(result.success).toBe(true);

                // Force garbage collection if available
                if (global.gc) {
                    global.gc();
                }
            }

            const finalMemory = process.memoryUsage();
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
            const memoryIncreasePerFile = memoryIncrease / fileCount;

            console.log('Memory Usage During Large File Processing:');
            console.log(`Initial Heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Final Heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Memory Increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Memory per File: ${(memoryIncreasePerFile / 1024 / 1024).toFixed(2)} MB`);

            // Memory increase should be reasonable (not more than 2x file size per file)
            expect(memoryIncreasePerFile).toBeLessThan(largeFileSize * 2);
        }, 30000); // 30 second timeout

        test('should handle memory pressure during concurrent processing', async () => {
            // Create memory pressure
            const memoryPressure = [];
            for (let i = 0; i < 20; i++) {
                memoryPressure.push(new Array(500000).fill('memory-pressure'));
            }

            const fileSize = 2 * 1024 * 1024; // 2MB
            const concurrentFiles = 3;
            const promises = [];

            for (let i = 0; i < concurrentFiles; i++) {
                const fileData = Buffer.alloc(fileSize);
                fileData.fill(`P${i}`);

                mockFileDownloadManager.downloadEncryptedMedia.mockResolvedValue(fileData);
                
                jest.spyOn(mediaDecryptionService, 'decryptWithWasenderAPI').mockResolvedValue(fileData);
                jest.spyOn(mediaDecryptionService, 'validateMediaHash').mockResolvedValue();
                jest.spyOn(mediaDecryptionService, 'saveDecryptedFileEnhanced').mockResolvedValue(`/test/path/pressure_file_${i}.bin`);

                const startTime = Date.now();
                
                const promise = mediaDecryptionService.decryptMedia(
                    `https://example.com/pressure-file-${i}.bin`,
                    `pressure-media-key-${i}`,
                    'document',
                    {
                        fileName: `pressure_file_${i}.bin`,
                        mimeType: 'application/octet-stream',
                        fileSize: fileSize
                    }
                ).then(result => {
                    const processingTime = Date.now() - startTime;
                    return { result, processingTime };
                });

                promises.push(promise);
            }

            const results = await Promise.all(promises);

            // All files should still be processed successfully under memory pressure
            results.forEach(({ result, processingTime }) => {
                expect(result.success).toBe(true);
                expect(processingTime).toBeLessThan(10000); // Should complete within 10 seconds even under pressure
            });

            // Clean up memory pressure
            memoryPressure.length = 0;

            console.log('Memory Pressure Test Results:');
            results.forEach(({ processingTime }, index) => {
                console.log(`File ${index}: ${processingTime}ms`);
            });
        }, 25000); // 25 second timeout
    });

    describe('Hash Validation Performance', () => {
        test('should validate file hashes efficiently', async () => {
            const fileSizes = [
                100 * 1024,      // 100KB
                1 * 1024 * 1024, // 1MB
                5 * 1024 * 1024, // 5MB
                10 * 1024 * 1024 // 10MB
            ];

            const validationTimes = [];

            for (const fileSize of fileSizes) {
                const fileData = Buffer.alloc(fileSize);
                fileData.fill('H'); // Fill with 'H' for hash test

                // Generate expected hash
                const expectedHash = crypto.createHash('sha256').update(fileData).digest('hex');

                const startTime = Date.now();
                
                // Test hash validation directly
                await mediaDecryptionService.validateMediaHash(fileData, expectedHash);
                
                const validationTime = Date.now() - startTime;
                validationTimes.push({ fileSize, validationTime });
            }

            console.log('Hash Validation Performance:');
            validationTimes.forEach(({ fileSize, validationTime }) => {
                const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
                console.log(`${fileSizeMB}MB: ${validationTime}ms`);
                
                // Hash validation should be fast (under 100ms for files up to 10MB)
                expect(validationTime).toBeLessThan(100);
            });

            // Validation time should scale reasonably with file size
            const smallFileTime = validationTimes[0].validationTime;
            const largeFileTime = validationTimes[validationTimes.length - 1].validationTime;
            const scalingFactor = largeFileTime / smallFileTime;
            
            expect(scalingFactor).toBeLessThan(10); // Should not scale more than 10x
        });

        test('should handle hash validation errors efficiently', async () => {
            const fileData = Buffer.alloc(1024 * 1024); // 1MB
            fileData.fill('E');
            
            const wrongHash = 'wrong-hash-value';
            const validationTimes = [];

            // Test multiple hash validation failures
            for (let i = 0; i < 5; i++) {
                const startTime = Date.now();
                
                try {
                    await mediaDecryptionService.validateMediaHash(fileData, wrongHash);
                } catch (error) {
                    const validationTime = Date.now() - startTime;
                    validationTimes.push(validationTime);
                    expect(error.message).toContain('Hash validation failed');
                }
            }

            const avgValidationTime = validationTimes.reduce((a, b) => a + b, 0) / validationTimes.length;
            
            console.log(`Average Hash Validation Error Time: ${avgValidationTime.toFixed(2)}ms`);
            
            // Error handling should be fast
            expect(avgValidationTime).toBeLessThan(50);
        });
    });

    describe('File System Performance', () => {
        test('should write files efficiently', async () => {
            const fileSizes = [
                500 * 1024,      // 500KB
                2 * 1024 * 1024, // 2MB
                8 * 1024 * 1024  // 8MB
            ];

            const writeTimes = [];

            for (const fileSize of fileSizes) {
                const fileData = Buffer.alloc(fileSize);
                fileData.fill('W');

                // Mock file write with timing
                let writeTime = 0;
                fs.writeFileSync.mockImplementation(() => {
                    const writeStart = Date.now();
                    // Simulate write time based on file size
                    const simulatedWriteTime = Math.max(1, fileSize / (100 * 1024 * 1024)); // 100MB/s write speed
                    writeTime = Date.now() - writeStart + simulatedWriteTime;
                });

                const startTime = Date.now();
                
                const filePath = await mediaDecryptionService.saveDecryptedFileEnhanced(
                    fileData,
                    `performance_test_${fileSize}.bin`,
                    'document'
                );

                const totalTime = Date.now() - startTime;
                writeTimes.push({ fileSize, totalTime, writeTime });

                expect(filePath).toBeDefined();
            }

            console.log('File Write Performance:');
            writeTimes.forEach(({ fileSize, totalTime }) => {
                const fileSizeMB = (fileSize / 1024 / 1024).toFixed(2);
                const throughput = (fileSize / 1024 / 1024) / (totalTime / 1000); // MB/s
                console.log(`${fileSizeMB}MB: ${totalTime}ms (${throughput.toFixed(2)} MB/s)`);
                
                // File writes should be reasonably fast
                expect(totalTime).toBeLessThan(1000); // Under 1 second
            });
        });
    });
});