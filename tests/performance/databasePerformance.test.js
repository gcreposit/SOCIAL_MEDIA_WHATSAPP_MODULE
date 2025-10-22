/**
 * Database Performance Tests
 * Tests database performance with high message volume and concurrent operations
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

// Mock database models with performance simulation
const mockPostBank = {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    bulkCreate: jest.fn()
};

const mockPostUser = {
    create: jest.fn(),
    findOne: jest.fn(),
    findOrCreate: jest.fn(),
    update: jest.fn(),
    findAll: jest.fn(),
    bulkCreate: jest.fn()
};

const mockCommonAttachment = {
    create: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    bulkCreate: jest.fn()
};

const mockTransaction = {
    commit: jest.fn(),
    rollback: jest.fn()
};

jest.mock('../../src/models', () => ({
    PostBank: mockPostBank,
    PostUser: mockPostUser,
    CommonAttachment: mockCommonAttachment,
    sequelize: {
        transaction: jest.fn((callback) => callback(mockTransaction))
    }
}));

describe('Database Performance Tests', () => {
    let databaseService;
    let groupMessageMonitor;

    beforeEach(() => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Create service instances
        databaseService = new DatabaseService();
        groupMessageMonitor = new GroupMessageMonitor(databaseService);

        // Reset mock implementations
        mockTransaction.commit.mockResolvedValue();
        mockTransaction.rollback.mockResolvedValue();
    });

    describe('Single Operation Performance', () => {
        test('should save single message within 50ms', async () => {
            const messageData = {
                key: {
                    id: 'perf-msg-1',
                    remoteJid: 'group123@g.us',
                    participant: '1234567890@s.whatsapp.net'
                },
                message: {
                    conversation: 'Performance test message'
                },
                messageTimestamp: Math.floor(Date.now() / 1000),
                pushName: 'Perf User'
            };

            const groupInfo = {
                groupId: 'group123@g.us',
                groupName: 'Performance Test Group',
                isGroup: true
            };

            const userInfo = {
                userId: '1234567890@s.whatsapp.net',
                displayName: 'Perf User',
                phoneNumber: '1234567890',
                platform: 'whatsapp'
            };

            // Mock database operations with simulated timing
            mockPostBank.create.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 10)); // Simulate 10ms DB operation
                return {
                    id: 1,
                    post_id: 'perf-msg-1',
                    source: 'whatsapp',
                    created_at: new Date()
                };
            });

            mockPostUser.findOrCreate.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 5)); // Simulate 5ms DB operation
                return [{
                    id: 1,
                    platform_user_id: '1234567890@s.whatsapp.net',
                    display_name: 'Perf User'
                }, false];
            });

            const startTime = Date.now();
            
            const result = await databaseService.saveGroupMessage(messageData, groupInfo, userInfo);
            
            const operationTime = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(operationTime).toBeLessThan(50); // Should complete within 50ms
            
            console.log(`Single message save: ${operationTime}ms`);
        });

        test('should query existing message within 20ms', async () => {
            const messageId = 'query-test-msg';

            mockPostBank.findOne.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 5)); // Simulate 5ms query
                return {
                    id: 1,
                    post_id: messageId,
                    source: 'whatsapp'
                };
            });

            const startTime = Date.now();
            
            const result = await databaseService.checkDuplicateMessage(messageId);
            
            const queryTime = Date.now() - startTime;

            expect(result.isDuplicate).toBe(true);
            expect(queryTime).toBeLessThan(20); // Should query within 20ms
            
            console.log(`Duplicate check query: ${queryTime}ms`);
        });

        test('should update message status within 30ms', async () => {
            const messageId = 'update-test-msg';
            const newStatus = 'delivered';

            mockPostBank.update.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 8)); // Simulate 8ms update
                return [1]; // 1 row affected
            });

            const startTime = Date.now();
            
            const result = await databaseService.updateMessageStatus(messageId, newStatus);
            
            const updateTime = Date.now() - startTime;

            expect(result.success).toBe(true);
            expect(updateTime).toBeLessThan(30); // Should update within 30ms
            
            console.log(`Message status update: ${updateTime}ms`);
        });
    });

    describe('Bulk Operations Performance', () => {
        test('should handle bulk message insertion efficiently', async () => {
            const messageCount = 100;
            const messages = [];
            const operationTimes = [];

            // Generate test messages
            for (let i = 0; i < messageCount; i++) {
                messages.push({
                    key: {
                        id: `bulk-msg-${i}`,
                        remoteJid: 'group123@g.us',
                        participant: `${1234567890 + i}@s.whatsapp.net`
                    },
                    message: {
                        conversation: `Bulk test message ${i}`
                    },
                    messageTimestamp: Math.floor(Date.now() / 1000),
                    pushName: `User ${i}`
                });
            }

            // Mock bulk operations
            mockPostBank.create.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 2)); // 2ms per message
                return {
                    id: Math.floor(Math.random() * 10000),
                    post_id: `bulk-msg-${Math.floor(Math.random() * messageCount)}`,
                    source: 'whatsapp'
                };
            });

            mockPostUser.findOrCreate.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 1)); // 1ms per user
                return [{
                    id: Math.floor(Math.random() * 1000),
                    platform_user_id: `${1234567890 + Math.floor(Math.random() * messageCount)}@s.whatsapp.net`
                }, false];
            });

            const startTime = Date.now();

            // Process messages in batches
            const batchSize = 10;
            for (let i = 0; i < messageCount; i += batchSize) {
                const batch = messages.slice(i, i + batchSize);
                const batchStartTime = Date.now();
                
                const batchPromises = batch.map(message => 
                    databaseService.saveGroupMessage(message, {
                        groupId: 'group123@g.us',
                        groupName: 'Bulk Test Group'
                    }, {
                        userId: message.key.participant,
                        displayName: message.pushName,
                        platform: 'whatsapp'
                    })
                );

                await Promise.all(batchPromises);
                
                const batchTime = Date.now() - batchStartTime;
                operationTimes.push(batchTime);
            }

            const totalTime = Date.now() - startTime;
            const avgBatchTime = operationTimes.reduce((a, b) => a + b, 0) / operationTimes.length;
            const messagesPerSecond = (messageCount / totalTime) * 1000;

            console.log(`Bulk Operations Performance (${messageCount} messages):`);
            console.log(`Total Time: ${totalTime}ms`);
            console.log(`Average Batch Time: ${avgBatchTime.toFixed(2)}ms`);
            console.log(`Messages per Second: ${messagesPerSecond.toFixed(2)}`);

            expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
            expect(messagesPerSecond).toBeGreaterThan(10); // Should process at least 10 messages/second
        }, 15000); // 15 second timeout

        test('should handle concurrent database operations', async () => {
            const concurrentOperations = 20;
            const promises = [];
            const operationTimes = [];

            // Mock operations with varying response times
            mockPostBank.create.mockImplementation(async () => {
                const delay = Math.random() * 20 + 5; // 5-25ms random delay
                await new Promise(resolve => setTimeout(resolve, delay));
                return {
                    id: Math.floor(Math.random() * 10000),
                    post_id: `concurrent-msg-${Math.floor(Math.random() * 1000)}`,
                    source: 'whatsapp'
                };
            });

            mockPostUser.findOrCreate.mockImplementation(async () => {
                const delay = Math.random() * 10 + 2; // 2-12ms random delay
                await new Promise(resolve => setTimeout(resolve, delay));
                return [{
                    id: Math.floor(Math.random() * 1000),
                    platform_user_id: `${Math.floor(Math.random() * 1000000)}@s.whatsapp.net`
                }, false];
            });

            for (let i = 0; i < concurrentOperations; i++) {
                const messageData = {
                    key: {
                        id: `concurrent-msg-${i}`,
                        remoteJid: 'group123@g.us',
                        participant: `${1234567890 + i}@s.whatsapp.net`
                    },
                    message: {
                        conversation: `Concurrent message ${i}`
                    },
                    messageTimestamp: Math.floor(Date.now() / 1000)
                };

                const startTime = Date.now();
                
                const promise = databaseService.saveGroupMessage(messageData, {
                    groupId: 'group123@g.us',
                    groupName: 'Concurrent Test Group'
                }, {
                    userId: messageData.key.participant,
                    displayName: `User ${i}`,
                    platform: 'whatsapp'
                }).then(result => {
                    const operationTime = Date.now() - startTime;
                    operationTimes.push(operationTime);
                    return result;
                });

                promises.push(promise);
            }

            const results = await Promise.all(promises);

            // All operations should succeed
            results.forEach(result => {
                expect(result.success).toBe(true);
            });

            // Calculate performance metrics
            const avgOperationTime = operationTimes.reduce((a, b) => a + b, 0) / operationTimes.length;
            const maxOperationTime = Math.max(...operationTimes);
            const minOperationTime = Math.min(...operationTimes);

            console.log(`Concurrent Operations Performance (${concurrentOperations} operations):`);
            console.log(`Average Operation Time: ${avgOperationTime.toFixed(2)}ms`);
            console.log(`Max Operation Time: ${maxOperationTime}ms`);
            console.log(`Min Operation Time: ${minOperationTime}ms`);

            expect(avgOperationTime).toBeLessThan(100); // Average under 100ms
            expect(maxOperationTime).toBeLessThan(500); // Max under 500ms
        }, 20000); // 20 second timeout
    });

    describe('Query Performance Under Load', () => {
        test('should maintain query performance with large dataset', async () => {
            const queryCount = 50;
            const queryTimes = [];

            // Mock database with simulated large dataset response times
            mockPostBank.findOne.mockImplementation(async () => {
                // Simulate query time that increases slightly with dataset size
                const baseTime = 5;
                const variableTime = Math.random() * 10;
                await new Promise(resolve => setTimeout(resolve, baseTime + variableTime));
                
                return Math.random() > 0.3 ? { // 70% chance of finding existing message
                    id: Math.floor(Math.random() * 100000),
                    post_id: `existing-msg-${Math.floor(Math.random() * 10000)}`,
                    source: 'whatsapp'
                } : null;
            });

            for (let i = 0; i < queryCount; i++) {
                const messageId = `query-load-test-${i}`;
                const startTime = Date.now();
                
                await databaseService.checkDuplicateMessage(messageId);
                
                const queryTime = Date.now() - startTime;
                queryTimes.push(queryTime);
            }

            const avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
            const maxQueryTime = Math.max(...queryTimes);
            const queriesPerSecond = (queryCount / queryTimes.reduce((a, b) => a + b, 0)) * 1000;

            console.log(`Query Performance Under Load (${queryCount} queries):`);
            console.log(`Average Query Time: ${avgQueryTime.toFixed(2)}ms`);
            console.log(`Max Query Time: ${maxQueryTime}ms`);
            console.log(`Queries per Second: ${queriesPerSecond.toFixed(2)}`);

            expect(avgQueryTime).toBeLessThan(50); // Average under 50ms
            expect(maxQueryTime).toBeLessThan(100); // Max under 100ms
            expect(queriesPerSecond).toBeGreaterThan(20); // At least 20 queries/second
        });

        test('should handle complex queries efficiently', async () => {
            const complexQueryCount = 10;
            const queryTimes = [];

            // Mock complex query operations
            mockPostUser.findAll.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 30)); // 30ms for complex query
                return Array.from({ length: 100 }, (_, i) => ({
                    id: i + 1,
                    platform: 'whatsapp',
                    display_name: `User ${i}`,
                    is_business: Math.random() > 0.8,
                    is_active: Math.random() > 0.2
                }));
            });

            for (let i = 0; i < complexQueryCount; i++) {
                const startTime = Date.now();
                
                await databaseService.getUserStatistics();
                
                const queryTime = Date.now() - startTime;
                queryTimes.push(queryTime);
            }

            const avgQueryTime = queryTimes.reduce((a, b) => a + b, 0) / queryTimes.length;
            const maxQueryTime = Math.max(...queryTimes);

            console.log(`Complex Query Performance (${complexQueryCount} queries):`);
            console.log(`Average Query Time: ${avgQueryTime.toFixed(2)}ms`);
            console.log(`Max Query Time: ${maxQueryTime}ms`);

            expect(avgQueryTime).toBeLessThan(100); // Complex queries under 100ms average
            expect(maxQueryTime).toBeLessThan(200); // Max under 200ms
        });
    });

    describe('Transaction Performance', () => {
        test('should handle transactions efficiently', async () => {
            const transactionCount = 30;
            const transactionTimes = [];

            // Mock transaction operations
            mockPostBank.create.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 8));
                return { id: Math.floor(Math.random() * 10000), post_id: 'tx-msg' };
            });

            mockPostUser.findOrCreate.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return [{ id: Math.floor(Math.random() * 1000) }, false];
            });

            mockCommonAttachment.create.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 3));
                return { id: Math.floor(Math.random() * 10000), post_bank_id: 1 };
            });

            for (let i = 0; i < transactionCount; i++) {
                const messageData = {
                    key: {
                        id: `tx-msg-${i}`,
                        remoteJid: 'group123@g.us',
                        participant: `${1234567890 + i}@s.whatsapp.net`
                    },
                    message: {
                        imageMessage: {
                            url: `https://example.com/image-${i}.jpg`,
                            caption: `Transaction test image ${i}`
                        }
                    },
                    messageTimestamp: Math.floor(Date.now() / 1000)
                };

                const startTime = Date.now();
                
                const result = await databaseService.saveGroupMessage(messageData, {
                    groupId: 'group123@g.us',
                    groupName: 'Transaction Test Group'
                }, {
                    userId: messageData.key.participant,
                    displayName: `TX User ${i}`,
                    platform: 'whatsapp'
                });

                const transactionTime = Date.now() - startTime;
                transactionTimes.push(transactionTime);

                expect(result.success).toBe(true);
            }

            const avgTransactionTime = transactionTimes.reduce((a, b) => a + b, 0) / transactionTimes.length;
            const maxTransactionTime = Math.max(...transactionTimes);
            const transactionsPerSecond = (transactionCount / transactionTimes.reduce((a, b) => a + b, 0)) * 1000;

            console.log(`Transaction Performance (${transactionCount} transactions):`);
            console.log(`Average Transaction Time: ${avgTransactionTime.toFixed(2)}ms`);
            console.log(`Max Transaction Time: ${maxTransactionTime}ms`);
            console.log(`Transactions per Second: ${transactionsPerSecond.toFixed(2)}`);

            expect(avgTransactionTime).toBeLessThan(80); // Average under 80ms
            expect(maxTransactionTime).toBeLessThan(200); // Max under 200ms
            expect(transactionsPerSecond).toBeGreaterThan(5); // At least 5 transactions/second
        }, 25000); // 25 second timeout

        test('should handle transaction rollbacks efficiently', async () => {
            const rollbackCount = 10;
            const rollbackTimes = [];

            // Mock transaction failure
            mockPostBank.create.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 10));
                throw new Error('Simulated database constraint violation');
            });

            for (let i = 0; i < rollbackCount; i++) {
                const messageData = {
                    key: {
                        id: `rollback-msg-${i}`,
                        remoteJid: 'group123@g.us',
                        participant: `${1234567890 + i}@s.whatsapp.net`
                    },
                    message: {
                        conversation: `Rollback test message ${i}`
                    },
                    messageTimestamp: Math.floor(Date.now() / 1000)
                };

                const startTime = Date.now();
                
                const result = await databaseService.saveGroupMessage(messageData, {
                    groupId: 'group123@g.us',
                    groupName: 'Rollback Test Group'
                }, {
                    userId: messageData.key.participant,
                    displayName: `Rollback User ${i}`,
                    platform: 'whatsapp'
                });

                const rollbackTime = Date.now() - startTime;
                rollbackTimes.push(rollbackTime);

                expect(result.success).toBe(false);
                expect(result.error).toContain('constraint violation');
            }

            const avgRollbackTime = rollbackTimes.reduce((a, b) => a + b, 0) / rollbackTimes.length;
            const maxRollbackTime = Math.max(...rollbackTimes);

            console.log(`Transaction Rollback Performance (${rollbackCount} rollbacks):`);
            console.log(`Average Rollback Time: ${avgRollbackTime.toFixed(2)}ms`);
            console.log(`Max Rollback Time: ${maxRollbackTime}ms`);

            expect(avgRollbackTime).toBeLessThan(50); // Rollbacks should be fast
            expect(maxRollbackTime).toBeLessThan(100); // Max rollback under 100ms
        });
    });

    describe('Memory Usage During Database Operations', () => {
        test('should not leak memory during high-volume database operations', async () => {
            const initialMemory = process.memoryUsage();
            const operationCount = 200;

            // Mock lightweight database operations
            mockPostBank.create.mockResolvedValue({
                id: 1,
                post_id: 'memory-test-msg',
                source: 'whatsapp'
            });

            mockPostUser.findOrCreate.mockResolvedValue([{
                id: 1,
                platform_user_id: 'memory-test-user@s.whatsapp.net'
            }, false]);

            for (let i = 0; i < operationCount; i++) {
                const messageData = {
                    key: {
                        id: `memory-msg-${i}`,
                        remoteJid: 'group123@g.us',
                        participant: `${1234567890 + i}@s.whatsapp.net`
                    },
                    message: {
                        conversation: `Memory test message ${i}`
                    },
                    messageTimestamp: Math.floor(Date.now() / 1000)
                };

                await databaseService.saveGroupMessage(messageData, {
                    groupId: 'group123@g.us',
                    groupName: 'Memory Test Group'
                }, {
                    userId: messageData.key.participant,
                    displayName: `Memory User ${i}`,
                    platform: 'whatsapp'
                });

                // Periodic garbage collection
                if (i % 50 === 0 && global.gc) {
                    global.gc();
                }
            }

            const finalMemory = process.memoryUsage();
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
            const memoryPerOperation = memoryIncrease / operationCount;

            console.log('Database Memory Usage:');
            console.log(`Initial Heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Final Heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Memory Increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Memory per Operation: ${(memoryPerOperation / 1024).toFixed(2)} KB`);

            // Memory usage should be reasonable
            expect(memoryPerOperation).toBeLessThan(10 * 1024); // Less than 10KB per operation
        }, 30000); // 30 second timeout
    });

    describe('GroupMessageMonitor Database Integration Performance', () => {
        test('should maintain performance with database integration', async () => {
            const messageCount = 50;
            const processingTimes = [];

            // Mock database operations for GroupMessageMonitor
            mockPostBank.create.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 5));
                return {
                    id: Math.floor(Math.random() * 10000),
                    post_id: `integration-msg-${Math.floor(Math.random() * 1000)}`,
                    source: 'whatsapp'
                };
            });

            mockPostUser.findOrCreate.mockImplementation(async () => {
                await new Promise(resolve => setTimeout(resolve, 3));
                return [{
                    id: Math.floor(Math.random() * 1000),
                    platform_user_id: `${Math.floor(Math.random() * 1000000)}@s.whatsapp.net`
                }, false];
            });

            for (let i = 0; i < messageCount; i++) {
                const messageData = {
                    key: {
                        id: `integration-perf-msg-${i}`,
                        remoteJid: 'group123@g.us',
                        participant: `${1234567890 + i}@s.whatsapp.net`
                    },
                    message: {
                        conversation: `Integration performance test message ${i}`
                    },
                    messageTimestamp: Math.floor(Date.now() / 1000),
                    pushName: `Integration User ${i}`
                };

                const startTime = Date.now();
                
                const result = await groupMessageMonitor.processMessage(messageData);
                
                const processingTime = Date.now() - startTime;
                processingTimes.push(processingTime);

                expect(result.success).toBe(true);
                expect(result.storageResult.success).toBe(true);
            }

            const avgProcessingTime = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
            const maxProcessingTime = Math.max(...processingTimes);
            const messagesPerSecond = (messageCount / processingTimes.reduce((a, b) => a + b, 0)) * 1000;

            console.log(`GroupMessageMonitor Integration Performance (${messageCount} messages):`);
            console.log(`Average Processing Time: ${avgProcessingTime.toFixed(2)}ms`);
            console.log(`Max Processing Time: ${maxProcessingTime}ms`);
            console.log(`Messages per Second: ${messagesPerSecond.toFixed(2)}`);

            expect(avgProcessingTime).toBeLessThan(100); // Average under 100ms
            expect(maxProcessingTime).toBeLessThan(200); // Max under 200ms
            expect(messagesPerSecond).toBeGreaterThan(10); // At least 10 messages/second
        }, 20000); // 20 second timeout
    });
});