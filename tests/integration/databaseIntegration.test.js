/**
 * Database Integration Tests
 * Tests database operations with new models (PostBank, CommonAttachment, PostUser)
 */

const DatabaseService = require('../../src/services/databaseService');
const GroupMessageMonitor = require('../../src/services/wasender/groupMessageMonitor');

// Mock dependencies
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
    }))
}));

// Mock database models
const mockPostBank = {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn()
};

const mockPostUser = {
    create: jest.fn(),
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
    update: jest.fn(),
    findAll: jest.fn()
};

const mockCommonAttachment = {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn()
};

jest.mock('../../src/models', () => ({
    PostBank: mockPostBank,
    PostUser: mockPostUser,
    CommonAttachment: mockCommonAttachment,
    sequelize: {
        transaction: jest.fn((callback) => {
            const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
            return callback(mockTransaction);
        })
    }
}));

describe('Database Integration Tests', () => {
    let databaseService;
    let groupMessageMonitor;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Create service instances
        databaseService = new DatabaseService();
        groupMessageMonitor = new GroupMessageMonitor(databaseService);
    });

    describe('PostBank Model Integration', () => {
        test('should save group message to PostBank table', async () => {
            const messageData = {
                key: {
                    id: 'test-msg-123',
                    remoteJid: 'group123@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    conversation: 'Test message for database'
                },
                messageTimestamp: Math.floor(Date.now() / 1000),
                pushName: 'Test User'
            };

            const groupInfo = {
                groupId: 'group123@g.us',
                groupName: 'Test Group',
                isGroup: true
            };

            const userInfo = {
                userId: '1234567890@s.whatsapp.net',
                displayName: 'Test User',
                phoneNumber: '1234567890',
                platform: 'whatsapp'
            };

            // Mock successful database operations
            mockPostBank.create.mockResolvedValue({
                id: 1,
                post_id: 'test-msg-123',
                post_snippet: 'Test message for database',
                post_title: 'Test message for database',
                author_name: 'Test User',
                author_username: '1234567890@s.whatsapp.net',
                source: 'whatsapp',
                channel_id: 'group123@g.us',
                post_timestamp: new Date(messageData.messageTimestamp * 1000),
                created_at: new Date(),
                updated_at: new Date()
            });

            mockPostUser.findOrCreate.mockResolvedValue([{
                id: 1,
                platform: 'whatsapp',
                platform_user_id: '1234567890@s.whatsapp.net',
                display_name: 'Test User',
                mobile_number: '1234567890',
                created_at: new Date(),
                updated_at: new Date()
            }, true]);

            const result = await databaseService.saveGroupMessage(messageData, groupInfo, userInfo);

            expect(result.success).toBe(true);
            expect(result.messageId).toBe('test-msg-123');
            expect(result.postBankId).toBe(1);
            expect(result.groupId).toBe('group123@g.us');

            // Verify PostBank.create was called with correct data
            expect(mockPostBank.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    post_id: 'test-msg-123',
                    post_snippet: 'Test message for database',
                    source: 'whatsapp',
                    channel_id: 'group123@g.us',
                    author_name: 'Test User'
                }),
                expect.any(Object) // transaction
            );

            // Verify PostUser.findOrCreate was called
            expect(mockPostUser.findOrCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        platform: 'whatsapp',
                        platform_user_id: '1234567890@s.whatsapp.net'
                    },
                    defaults: expect.objectContaining({
                        display_name: 'Test User',
                        mobile_number: '1234567890'
                    })
                })
            );
        });

        test('should handle duplicate message prevention', async () => {
            const messageData = {
                key: {
                    id: 'duplicate-msg-123',
                    remoteJid: 'group123@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    conversation: 'Duplicate message'
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Mock existing message found
            mockPostBank.findOne.mockResolvedValue({
                id: 1,
                post_id: 'duplicate-msg-123',
                source: 'whatsapp'
            });

            const result = await databaseService.checkDuplicateMessage('duplicate-msg-123');

            expect(result.isDuplicate).toBe(true);
            expect(result.existingMessage).toBeDefined();

            // Verify database query
            expect(mockPostBank.findOne).toHaveBeenCalledWith({
                where: {
                    post_id: 'duplicate-msg-123',
                    source: 'whatsapp'
                }
            });
        });

        test('should update message status correctly', async () => {
            const messageId = 'status-update-msg';
            const newStatus = 'delivered';

            mockPostBank.update.mockResolvedValue([1]); // 1 row affected

            const result = await databaseService.updateMessageStatus(messageId, newStatus);

            expect(result.success).toBe(true);
            expect(result.updatedRows).toBe(1);

            expect(mockPostBank.update).toHaveBeenCalledWith(
                { message_status: newStatus, updated_at: expect.any(Date) },
                {
                    where: {
                        post_id: messageId,
                        source: 'whatsapp'
                    }
                }
            );
        });
    });

    describe('PostUser Model Integration', () => {
        test('should create new user with comprehensive information', async () => {
            const userInfo = {
                userId: '9876543210@s.whatsapp.net',
                displayName: 'New User',
                phoneNumber: '9876543210',
                platform: 'whatsapp',
                isBusiness: true,
                businessName: 'Test Business',
                profileImageUrl: 'https://example.com/profile.jpg'
            };

            mockPostUser.findOrCreate.mockResolvedValue([{
                id: 2,
                platform: 'whatsapp',
                platform_user_id: '9876543210@s.whatsapp.net',
                display_name: 'New User',
                mobile_number: '9876543210',
                is_business: true,
                business_name: 'Test Business',
                profile_image_url: 'https://example.com/profile.jpg',
                created_at: new Date(),
                updated_at: new Date()
            }, true]); // true indicates new record created

            const result = await databaseService.saveUserInfo(userInfo);

            expect(result.id).toBe(2);
            expect(result.display_name).toBe('New User');
            expect(result.is_business).toBe(true);

            expect(mockPostUser.findOrCreate).toHaveBeenCalledWith({
                where: {
                    platform: 'whatsapp',
                    platform_user_id: '9876543210@s.whatsapp.net'
                },
                defaults: expect.objectContaining({
                    display_name: 'New User',
                    mobile_number: '9876543210',
                    is_business: true,
                    business_name: 'Test Business',
                    profile_image_url: 'https://example.com/profile.jpg'
                })
            });
        });

        test('should update existing user information', async () => {
            const userInfo = {
                userId: '1234567890@s.whatsapp.net',
                displayName: 'Updated User Name',
                phoneNumber: '1234567890',
                platform: 'whatsapp',
                profileImageUrl: 'https://example.com/new-profile.jpg'
            };

            // Mock existing user found and updated
            mockPostUser.findOrCreate.mockResolvedValue([{
                id: 1,
                platform: 'whatsapp',
                platform_user_id: '1234567890@s.whatsapp.net',
                display_name: 'Updated User Name',
                mobile_number: '1234567890',
                profile_image_url: 'https://example.com/new-profile.jpg',
                created_at: new Date('2024-01-01'),
                updated_at: new Date() // Updated timestamp
            }, false]); // false indicates existing record updated

            const result = await databaseService.saveUserInfo(userInfo);

            expect(result.display_name).toBe('Updated User Name');
            expect(result.profile_image_url).toBe('https://example.com/new-profile.jpg');
        });

        test('should retrieve user statistics', async () => {
            mockPostUser.findAll.mockResolvedValue([
                { id: 1, is_business: false, is_active: true },
                { id: 2, is_business: true, is_active: true },
                { id: 3, is_business: false, is_active: false }
            ]);

            const stats = await databaseService.getUserStatistics();

            expect(stats.total_users).toBe(3);
            expect(stats.business_users).toBe(1);
            expect(stats.active_users).toBe(2);

            expect(mockPostUser.findAll).toHaveBeenCalled();
        });
    });

    describe('CommonAttachment Model Integration', () => {
        test('should save media attachment information', async () => {
            const attachmentData = {
                post_bank_id: 1,
                attachment_type: 'image',
                platform_name: 'whatsapp',
                image_attachment_path: '/attachments/images/test_image.jpg',
                mime_type: 'image/jpeg',
                group_id: 'group123@g.us',
                download_status: 'SUCCESS',
                processing_status: 'COMPLETED'
            };

            mockCommonAttachment.create.mockResolvedValue({
                id: 1,
                ...attachmentData,
                created_at: new Date(),
                updated_at: new Date()
            });

            const result = await databaseService.saveAttachment(attachmentData, 1);

            expect(result.id).toBe(1);
            expect(result.attachment_type).toBe('image');
            expect(result.download_status).toBe('SUCCESS');

            expect(mockCommonAttachment.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    post_bank_id: 1,
                    attachment_type: 'image',
                    platform_name: 'whatsapp',
                    image_attachment_path: '/attachments/images/test_image.jpg'
                }),
                expect.any(Object) // transaction
            );
        });

        test('should handle different media types correctly', async () => {
            const mediaTypes = [
                {
                    type: 'video',
                    path: '/attachments/videos/test_video.mp4',
                    mime: 'video/mp4'
                },
                {
                    type: 'audio',
                    path: '/attachments/audio/test_audio.mp3',
                    mime: 'audio/mpeg'
                },
                {
                    type: 'document',
                    path: '/attachments/documents/test_doc.pdf',
                    mime: 'application/pdf'
                }
            ];

            for (const media of mediaTypes) {
                mockCommonAttachment.create.mockResolvedValue({
                    id: Math.floor(Math.random() * 1000),
                    attachment_type: media.type,
                    [`${media.type}_attachment_path`]: media.path,
                    mime_type: media.mime,
                    created_at: new Date()
                });

                const attachmentData = {
                    post_bank_id: 1,
                    attachment_type: media.type,
                    platform_name: 'whatsapp',
                    [`${media.type}_attachment_path`]: media.path,
                    mime_type: media.mime,
                    group_id: 'group123@g.us'
                };

                const result = await databaseService.saveAttachment(attachmentData, 1);

                expect(result.attachment_type).toBe(media.type);
                expect(result[`${media.type}_attachment_path`]).toBe(media.path);
                expect(result.mime_type).toBe(media.mime);
            }
        });

        test('should update attachment processing status', async () => {
            const attachmentId = 1;
            const newStatus = 'FAILED';
            const errorMessage = 'Decryption failed';

            mockCommonAttachment.update.mockResolvedValue([1]); // 1 row affected

            const result = await databaseService.updateAttachmentStatus(
                attachmentId,
                newStatus,
                errorMessage
            );

            expect(result.success).toBe(true);
            expect(result.updatedRows).toBe(1);

            expect(mockCommonAttachment.update).toHaveBeenCalledWith(
                {
                    processing_status: newStatus,
                    error_message: errorMessage,
                    updated_at: expect.any(Date)
                },
                {
                    where: { id: attachmentId }
                }
            );
        });
    });

    describe('Transaction Handling', () => {
        test('should handle successful transaction with multiple operations', async () => {
            const messageData = {
                key: {
                    id: 'transaction-msg-123',
                    remoteJid: 'group123@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    imageMessage: {
                        url: 'https://example.com/image.jpg',
                        caption: 'Test image with transaction'
                    }
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            const groupInfo = {
                groupId: 'group123@g.us',
                groupName: 'Test Group'
            };

            const userInfo = {
                userId: '1234567890@s.whatsapp.net',
                displayName: 'Transaction User',
                platform: 'whatsapp'
            };

            // Mock successful operations
            mockPostBank.create.mockResolvedValue({
                id: 1,
                post_id: 'transaction-msg-123'
            });

            mockPostUser.findOrCreate.mockResolvedValue([{
                id: 1,
                platform_user_id: '1234567890@s.whatsapp.net'
            }, false]);

            mockCommonAttachment.create.mockResolvedValue({
                id: 1,
                post_bank_id: 1,
                attachment_type: 'image'
            });

            const result = await databaseService.saveGroupMessage(messageData, groupInfo, userInfo);

            expect(result.success).toBe(true);
            expect(result.messageId).toBe('transaction-msg-123');

            // Verify all operations were called within transaction
            expect(mockPostBank.create).toHaveBeenCalled();
            expect(mockPostUser.findOrCreate).toHaveBeenCalled();
            expect(mockCommonAttachment.create).toHaveBeenCalled();
        });

        test('should rollback transaction on error', async () => {
            const messageData = {
                key: {
                    id: 'error-msg-123',
                    remoteJid: 'group123@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    conversation: 'Message that will cause error'
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Mock database error
            mockPostBank.create.mockRejectedValue(new Error('Database constraint violation'));

            const result = await databaseService.saveGroupMessage(messageData, {}, {});

            expect(result.success).toBe(false);
            expect(result.error).toContain('Database constraint violation');

            // Transaction should have been attempted
            expect(mockPostBank.create).toHaveBeenCalled();
        });
    });

    describe('GroupMessageMonitor Database Integration', () => {
        test('should integrate with database service for complete message processing', async () => {
            const messageData = {
                key: {
                    id: 'integration-msg-123',
                    remoteJid: 'group123@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    conversation: 'Integration test message'
                },
                messageTimestamp: Math.floor(Date.now() / 1000),
                pushName: 'Integration User'
            };

            // Mock successful database operations
            mockPostBank.create.mockResolvedValue({
                id: 1,
                post_id: 'integration-msg-123',
                source: 'whatsapp'
            });

            mockPostUser.findOrCreate.mockResolvedValue([{
                id: 1,
                platform_user_id: '1234567890@s.whatsapp.net',
                display_name: 'Integration User'
            }, true]);

            const result = await groupMessageMonitor.processMessage(messageData);

            expect(result.success).toBe(true);
            expect(result.messageId).toBe('integration-msg-123');
            expect(result.storageResult.success).toBe(true);
            expect(result.storageResult.postBankId).toBe(1);

            // Verify metrics were updated
            const metrics = groupMessageMonitor.getMetrics();
            expect(metrics.totalMessagesReceived).toBe(1);
            expect(metrics.groupMessagesProcessed).toBe(1);
        });

        test('should handle database service unavailable gracefully', async () => {
            // Create monitor without database service
            const monitorWithoutDB = new GroupMessageMonitor();

            const messageData = {
                key: {
                    id: 'no-db-msg-123',
                    remoteJid: 'group123@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    conversation: 'Message without database'
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            const result = await monitorWithoutDB.processMessage(messageData);

            expect(result.success).toBe(true);
            expect(result.storageResult).toBeNull();
            expect(result.normalizedMessage).toBeDefined();
        });
    });

    describe('Data Consistency and Validation', () => {
        test('should maintain referential integrity between models', async () => {
            const messageData = {
                key: {
                    id: 'integrity-msg-123',
                    remoteJid: 'group123@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    documentMessage: {
                        url: 'https://example.com/document.pdf',
                        fileName: 'test-document.pdf',
                        mimetype: 'application/pdf'
                    }
                },
                messageTimestamp: Math.floor(Date.now() / 1000)
            };

            // Mock successful creation with proper IDs
            mockPostBank.create.mockResolvedValue({
                id: 5,
                post_id: 'integrity-msg-123'
            });

            mockPostUser.findOrCreate.mockResolvedValue([{
                id: 3,
                platform_user_id: '1234567890@s.whatsapp.net'
            }, false]);

            mockCommonAttachment.create.mockResolvedValue({
                id: 2,
                post_bank_id: 5, // Should reference PostBank.id
                attachment_type: 'document'
            });

            const result = await databaseService.saveGroupMessage(messageData, {}, {});

            expect(result.success).toBe(true);

            // Verify attachment references correct PostBank record
            expect(mockCommonAttachment.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    post_bank_id: 5 // Should match PostBank.id
                }),
                expect.any(Object)
            );
        });

        test('should validate required fields before database operations', async () => {
            const invalidMessageData = {
                key: {
                    // Missing required fields
                    remoteJid: 'group123@g.us'
                },
                message: {
                    conversation: 'Invalid message'
                }
            };

            const result = await databaseService.saveGroupMessage(invalidMessageData, {}, {});

            expect(result.success).toBe(false);
            expect(result.error).toContain('validation');

            // Database operations should not have been called
            expect(mockPostBank.create).not.toHaveBeenCalled();
        });
    });
});