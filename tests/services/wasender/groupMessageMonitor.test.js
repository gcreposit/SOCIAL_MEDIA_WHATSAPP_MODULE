/**
 * GroupMessageMonitor Tests
 * Tests for group message filtering logic, message processing, and data extraction
 */

const GroupMessageMonitor = require('../../../src/services/wasender/groupMessageMonitor');

// Mock dependencies
jest.mock('../../../src/services/loggingService', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    getServiceLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

describe('GroupMessageMonitor', () => {
    let groupMessageMonitor;
    let mockDatabaseService;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Mock DatabaseService
        mockDatabaseService = {
            saveGroupMessage: jest.fn(),
            saveUserInfo: jest.fn(),
            getUserByPlatformId: jest.fn(),
            getUserStatistics: jest.fn()
        };
        
        // Create GroupMessageMonitor instance
        groupMessageMonitor = new GroupMessageMonitor(mockDatabaseService);
    });

    describe('Constructor', () => {
        test('should initialize with default values', () => {
            expect(groupMessageMonitor.processedMessages).toBeInstanceOf(Set);
            expect(groupMessageMonitor.groupCache).toBeInstanceOf(Map);
            expect(groupMessageMonitor.userCache).toBeInstanceOf(Map);
            expect(groupMessageMonitor.databaseService).toBe(mockDatabaseService);
            expect(groupMessageMonitor.metrics.totalMessagesReceived).toBe(0);
        });

        test('should initialize without database service', () => {
            const monitor = new GroupMessageMonitor();
            expect(monitor.databaseService).toBeNull();
        });
    });

    describe('Group Message Detection', () => {
        test('should identify group messages correctly', () => {
            const groupJid = '1234567890-1234567890@g.us';
            const personalJid = '1234567890@s.whatsapp.net';
            const broadcastJid = 'status@broadcast';

            expect(groupMessageMonitor.isGroupMessage(groupJid)).toBe(true);
            expect(groupMessageMonitor.isGroupMessage(personalJid)).toBe(false);
            expect(groupMessageMonitor.isGroupMessage(broadcastJid)).toBe(false);
        });

        test('should handle invalid JID formats', () => {
            expect(groupMessageMonitor.isGroupMessage(null)).toBe(false);
            expect(groupMessageMonitor.isGroupMessage(undefined)).toBe(false);
            expect(groupMessageMonitor.isGroupMessage('')).toBe(false);
            expect(groupMessageMonitor.isGroupMessage(123)).toBe(false);
        });

        test('should handle edge cases in JID format', () => {
            expect(groupMessageMonitor.isGroupMessage('@g.us')).toBe(true);
            expect(groupMessageMonitor.isGroupMessage('test@g.us@something')).toBe(false);
            expect(groupMessageMonitor.isGroupMessage('test.g.us')).toBe(false);
        });
    });

    describe('Message Structure Validation', () => {
        test('should validate correct message structure', () => {
            const validMessage = {
                key: {
                    id: 'msg123',
                    remoteJid: 'group@g.us'
                },
                message: {
                    conversation: 'Test message'
                },
                messageTimestamp: Date.now() / 1000
            };

            expect(groupMessageMonitor.isValidMessageStructure(validMessage)).toBe(true);
        });

        test('should reject invalid message structures', () => {
            const invalidMessages = [
                null,
                undefined,
                {},
                { key: null },
                { key: {} },
                { key: { id: 'msg123' } }, // Missing remoteJid
                { key: { remoteJid: 'group@g.us' } }, // Missing id
                { key: { id: 'msg123', remoteJid: 'group@g.us' } } // Missing message and timestamp
            ];

            invalidMessages.forEach(message => {
                expect(groupMessageMonitor.isValidMessageStructure(message)).toBe(false);
            });
        });

        test('should accept message with timestamp but no message content', () => {
            const messageWithTimestamp = {
                key: {
                    id: 'msg123',
                    remoteJid: 'group@g.us'
                },
                messageTimestamp: Date.now() / 1000
            };

            expect(groupMessageMonitor.isValidMessageStructure(messageWithTimestamp)).toBe(true);
        });
    });

    describe('Duplicate Message Detection', () => {
        test('should detect duplicate messages', () => {
            const messageId = 'msg123';
            
            expect(groupMessageMonitor.isDuplicateMessage(messageId)).toBe(false);
            
            groupMessageMonitor.processedMessages.add(messageId);
            
            expect(groupMessageMonitor.isDuplicateMessage(messageId)).toBe(true);
        });

        test('should handle null/undefined message IDs', () => {
            expect(groupMessageMonitor.isDuplicateMessage(null)).toBe(false);
            expect(groupMessageMonitor.isDuplicateMessage(undefined)).toBe(false);
            expect(groupMessageMonitor.isDuplicateMessage('')).toBe(false);
        });
    });

    describe('Message Processing', () => {
        let validGroupMessage;

        beforeEach(() => {
            validGroupMessage = {
                key: {
                    id: 'msg123',
                    remoteJid: 'group@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    conversation: 'Test group message'
                },
                messageTimestamp: Date.now() / 1000,
                pushName: 'Test User'
            };

            mockDatabaseService.saveGroupMessage.mockResolvedValue({
                success: true,
                messageId: 'msg123',
                postBankId: 1,
                groupId: 'group@g.us'
            });
        });

        test('should process valid group message successfully', async () => {
            const result = await groupMessageMonitor.processMessage(validGroupMessage);

            expect(result.success).toBe(true);
            expect(result.messageId).toBe('msg123');
            expect(result.normalizedMessage).toBeDefined();
            expect(groupMessageMonitor.metrics.totalMessagesReceived).toBe(1);
            expect(groupMessageMonitor.metrics.groupMessagesProcessed).toBe(1);
        });

        test('should ignore personal messages', async () => {
            const personalMessage = {
                ...validGroupMessage,
                key: {
                    ...validGroupMessage.key,
                    remoteJid: '1234567890@s.whatsapp.net'
                }
            };

            const result = await groupMessageMonitor.processMessage(personalMessage);

            expect(result.success).toBe(true);
            expect(result.reason).toBe('personal_message_ignored');
            expect(groupMessageMonitor.metrics.personalMessagesIgnored).toBe(1);
        });

        test('should ignore duplicate messages', async () => {
            // Process message first time
            await groupMessageMonitor.processMessage(validGroupMessage);
            
            // Process same message again
            const result = await groupMessageMonitor.processMessage(validGroupMessage);

            expect(result.success).toBe(true);
            expect(result.reason).toBe('duplicate_ignored');
            expect(groupMessageMonitor.metrics.duplicateMessagesIgnored).toBe(1);
        });

        test('should handle invalid message structure', async () => {
            const invalidMessage = { invalid: 'structure' };

            const result = await groupMessageMonitor.processMessage(invalidMessage);

            expect(result.success).toBe(false);
            expect(result.reason).toBe('invalid_structure');
        });

        test('should handle processing errors gracefully', async () => {
            // Mock database service to throw error
            mockDatabaseService.saveGroupMessage.mockRejectedValue(new Error('Database error'));

            const result = await groupMessageMonitor.processMessage(validGroupMessage);

            expect(result.success).toBe(true); // Message processing succeeds even if storage fails
            expect(result.storageResult.success).toBe(false);
            expect(groupMessageMonitor.metrics.processingErrors).toBe(0); // Storage error doesn't count as processing error
        });
    });

    describe('Message Content Extraction', () => {
        test('should extract text message content', () => {
            const textMessage = {
                conversation: 'Hello world'
            };

            const contentInfo = groupMessageMonitor.extractMessageContent(textMessage);

            expect(contentInfo.type).toBe('text');
            expect(contentInfo.text).toBe('Hello world');
            expect(contentInfo.hasContent).toBe(true);
        });

        test('should extract extended text message content', () => {
            const extendedTextMessage = {
                extendedTextMessage: {
                    text: 'Extended text message'
                }
            };

            const contentInfo = groupMessageMonitor.extractMessageContent(extendedTextMessage);

            expect(contentInfo.type).toBe('text');
            expect(contentInfo.text).toBe('Extended text message');
            expect(contentInfo.hasContent).toBe(true);
        });

        test('should extract image message content', () => {
            const imageMessage = {
                imageMessage: {
                    caption: 'Image caption',
                    url: 'https://example.com/image.jpg'
                }
            };

            const contentInfo = groupMessageMonitor.extractMessageContent(imageMessage);

            expect(contentInfo.type).toBe('image');
            expect(contentInfo.text).toBe('Image caption');
            expect(contentInfo.hasContent).toBe(true);
        });

        test('should handle unknown message types', () => {
            const unknownMessage = {
                unknownMessageType: {
                    data: 'some data'
                }
            };

            const contentInfo = groupMessageMonitor.extractMessageContent(unknownMessage);

            expect(contentInfo.type).toBe('unknown');
            expect(contentInfo.text).toContain('unknownMessageType'); // Should contain JSON representation
            expect(contentInfo.hasContent).toBe(true); // Has content because it returns JSON string
        });

        test('should handle empty message content', () => {
            const contentInfo = groupMessageMonitor.extractMessageContent(null);

            expect(contentInfo.type).toBe('unknown');
            expect(contentInfo.text).toBe('');
            expect(contentInfo.hasContent).toBe(false);
        });
    });

    describe('Media Information Extraction', () => {
        test('should extract image media information', () => {
            const imageMessage = {
                imageMessage: {
                    url: 'https://example.com/image.jpg',
                    mediaKey: 'media-key-123',
                    mimetype: 'image/jpeg',
                    fileLength: 1024,
                    fileName: 'image.jpg',
                    fileSha256: 'sha256-hash'
                }
            };

            const mediaInfo = groupMessageMonitor.extractMediaInfo(imageMessage);

            expect(mediaInfo.hasMedia).toBe(true);
            expect(mediaInfo.mediaType).toBe('image');
            expect(mediaInfo.mediaUrl).toBe('https://example.com/image.jpg');
            expect(mediaInfo.mediaKey).toBe('media-key-123');
            expect(mediaInfo.mimetype).toBe('image/jpeg');
            expect(mediaInfo.fileSize).toBe(1024);
            expect(mediaInfo.fileName).toBe('image.jpg');
        });

        test('should handle message without media', () => {
            const textMessage = {
                conversation: 'Just text'
            };

            const mediaInfo = groupMessageMonitor.extractMediaInfo(textMessage);

            expect(mediaInfo.hasMedia).toBe(false);
            expect(mediaInfo.mediaType).toBeNull();
            expect(mediaInfo.mediaUrl).toBeNull();
        });

        test('should extract video media information', () => {
            const videoMessage = {
                videoMessage: {
                    url: 'https://example.com/video.mp4',
                    mediaKey: 'video-key-123',
                    mimetype: 'video/mp4'
                }
            };

            const mediaInfo = groupMessageMonitor.extractMediaInfo(videoMessage);

            expect(mediaInfo.hasMedia).toBe(true);
            expect(mediaInfo.mediaType).toBe('video');
            expect(mediaInfo.mediaUrl).toBe('https://example.com/video.mp4');
        });
    });

    describe('Reply Information Extraction', () => {
        test('should extract reply information from extended text message', () => {
            const replyMessage = {
                extendedTextMessage: {
                    text: 'This is a reply',
                    contextInfo: {
                        stanzaId: 'original-msg-id',
                        participant: '1234567890@s.whatsapp.net',
                        quotedMessage: {
                            conversation: 'Original message text'
                        }
                    }
                }
            };

            const replyInfo = groupMessageMonitor.extractReplyInfo(replyMessage);

            expect(replyInfo.isReply).toBe(true);
            expect(replyInfo.quotedMessageId).toBe('original-msg-id');
            expect(replyInfo.quotedParticipant).toBe('1234567890@s.whatsapp.net');
            expect(replyInfo.quotedText).toBe('Original message text');
        });

        test('should handle message without reply', () => {
            const normalMessage = {
                conversation: 'Normal message'
            };

            const replyInfo = groupMessageMonitor.extractReplyInfo(normalMessage);

            expect(replyInfo.isReply).toBe(false);
            expect(replyInfo.quotedMessageId).toBeNull();
            expect(replyInfo.quotedText).toBeNull();
        });

        test('should extract reply to image message', () => {
            const replyToImageMessage = {
                extendedTextMessage: {
                    text: 'Nice photo!',
                    contextInfo: {
                        stanzaId: 'image-msg-id',
                        participant: '1234567890@s.whatsapp.net',
                        quotedMessage: {
                            imageMessage: {
                                caption: 'Photo caption'
                            }
                        }
                    }
                }
            };

            const replyInfo = groupMessageMonitor.extractReplyInfo(replyToImageMessage);

            expect(replyInfo.isReply).toBe(true);
            expect(replyInfo.quotedText).toBe('Photo caption');
        });
    });

    describe('User Information Extraction', () => {
        test('should extract comprehensive user information', async () => {
            const messageData = {
                key: {
                    participant: '1234567890@s.whatsapp.net',
                    remoteJid: 'group@g.us'
                },
                pushName: 'John Doe',
                messageTimestamp: Date.now() / 1000
            };

            const userInfo = await groupMessageMonitor.extractUserInfo(messageData.key, messageData);

            expect(userInfo.userId).toBe('1234567890@s.whatsapp.net');
            expect(userInfo.phoneNumber).toBe('1234567890');
            expect(userInfo.displayName).toBe('John Doe');
            expect(userInfo.platform).toBe('whatsapp');
            expect(userInfo.pushName).toBe('John Doe');
        });

        test('should cache user information', async () => {
            const messageData = {
                key: {
                    participant: '1234567890@s.whatsapp.net',
                    remoteJid: 'group@g.us'
                },
                pushName: 'John Doe',
                messageTimestamp: Date.now() / 1000
            };

            // First call should extract and cache
            const userInfo1 = await groupMessageMonitor.extractUserInfo(messageData.key, messageData);
            
            // Second call should return cached data
            const userInfo2 = await groupMessageMonitor.extractUserInfo(messageData.key, messageData);

            expect(userInfo1).toEqual(userInfo2);
            expect(groupMessageMonitor.userCache.size).toBe(1);
        });

        test('should extract phone number from JID', () => {
            const phoneNumber = groupMessageMonitor.extractPhoneNumber('1234567890@s.whatsapp.net');
            expect(phoneNumber).toBe('1234567890');
        });

        test('should handle invalid JID format for phone extraction', () => {
            expect(groupMessageMonitor.extractPhoneNumber('invalid-jid')).toBe('invalid-jid');
            expect(groupMessageMonitor.extractPhoneNumber(null)).toBe('');
            expect(groupMessageMonitor.extractPhoneNumber('')).toBe('');
        });
    });

    describe('Group Information Extraction', () => {
        test('should extract and cache group information', async () => {
            const messageKey = {
                remoteJid: 'group123@g.us'
            };
            const messageData = {
                groupMetadata: {
                    subject: 'Test Group'
                }
            };

            const groupInfo = await groupMessageMonitor.extractGroupInfo(messageKey, messageData);

            expect(groupInfo.groupId).toBe('group123@g.us');
            expect(groupInfo.groupName).toBe('Test Group');
            expect(groupInfo.isGroup).toBe(true);
            expect(groupMessageMonitor.groupCache.size).toBe(1);
        });

        test('should use cached group information', async () => {
            const messageKey = {
                remoteJid: 'group123@g.us'
            };
            const messageData = {};

            // First call
            const groupInfo1 = await groupMessageMonitor.extractGroupInfo(messageKey, messageData);
            
            // Second call should use cache
            const groupInfo2 = await groupMessageMonitor.extractGroupInfo(messageKey, messageData);

            expect(groupInfo1).toEqual(groupInfo2);
            expect(groupMessageMonitor.groupCache.size).toBe(1);
        });
    });

    describe('Metrics and Monitoring', () => {
        test('should track processing metrics', () => {
            const metrics = groupMessageMonitor.getMetrics();

            expect(metrics).toHaveProperty('totalMessagesReceived');
            expect(metrics).toHaveProperty('groupMessagesProcessed');
            expect(metrics).toHaveProperty('personalMessagesIgnored');
            expect(metrics).toHaveProperty('duplicateMessagesIgnored');
            expect(metrics).toHaveProperty('processingErrors');
            expect(metrics).toHaveProperty('cacheStats');
            expect(metrics.timestamp).toBeDefined();
        });

        test('should reset metrics', () => {
            groupMessageMonitor.metrics.totalMessagesReceived = 10;
            groupMessageMonitor.metrics.groupMessagesProcessed = 8;

            groupMessageMonitor.resetMetrics();

            expect(groupMessageMonitor.metrics.totalMessagesReceived).toBe(0);
            expect(groupMessageMonitor.metrics.groupMessagesProcessed).toBe(0);
        });

        test('should clear caches', () => {
            groupMessageMonitor.groupCache.set('group1', { groupId: 'group1' });
            groupMessageMonitor.userCache.set('user1', { userId: 'user1' });
            groupMessageMonitor.processedMessages.add('msg1');

            groupMessageMonitor.clearCaches();

            expect(groupMessageMonitor.groupCache.size).toBe(0);
            expect(groupMessageMonitor.userCache.size).toBe(0);
            expect(groupMessageMonitor.processedMessages.size).toBe(1); // Not cleared by default
        });

        test('should clear processed messages when specified', () => {
            groupMessageMonitor.processedMessages.add('msg1');

            groupMessageMonitor.clearCaches({ clearProcessedMessages: true });

            expect(groupMessageMonitor.processedMessages.size).toBe(0);
        });
    });

    describe('Health Check', () => {
        test('should return healthy status', () => {
            const health = groupMessageMonitor.healthCheck();

            expect(health.status).toBe('healthy');
            expect(health.timestamp).toBeDefined();
            expect(health.metrics).toBeDefined();
            expect(health.configuration).toBeDefined();
            expect(health.configuration.duplicateDetectionEnabled).toBe(true);
            expect(health.configuration.cachingEnabled).toBe(true);
            expect(health.configuration.groupFilteringEnabled).toBe(true);
        });
    });

    describe('Database Integration', () => {
        test('should set database service', () => {
            const newDatabaseService = { test: 'service' };
            groupMessageMonitor.setDatabaseService(newDatabaseService);

            expect(groupMessageMonitor.databaseService).toBe(newDatabaseService);
        });

        test('should process message without database service', async () => {
            const monitor = new GroupMessageMonitor(); // No database service
            const validGroupMessage = {
                key: {
                    id: 'msg123',
                    remoteJid: 'group@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    conversation: 'Test message'
                },
                messageTimestamp: Date.now() / 1000
            };

            const result = await monitor.processMessage(validGroupMessage);

            expect(result.success).toBe(true);
            expect(result.storageResult).toBeNull();
        });
    });
});