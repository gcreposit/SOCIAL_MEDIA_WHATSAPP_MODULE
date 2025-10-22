/**
 * Webhook Performance and Load Tests
 * Tests webhook endpoint performance under load and validates response times
 */

const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const WebhookHandler = require('../../src/services/wasender/webhookHandler');

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

jest.mock('../../src/config/wasenderConfig', () => ({
    security: {
        rateLimiting: {
            windowMs: 15 * 60 * 1000,
            max: 1000,
            message: 'Too many webhook requests'
        }
    }
}));

jest.mock('../../src/services/wasender/groupMessageMonitor');

describe('Webhook Performance and Load Tests', () => {
    let app;
    let webhookHandler;
    let mockDatabaseService;

    beforeEach(() => {
        // Set up environment variables
        process.env.WASENDER_WEBHOOK_SECRET = 'test-webhook-secret';
        
        // Create Express app
        app = express();
        app.use(express.json({ limit: '10mb' }));
        
        // Add raw body parser for signature verification
        app.use('/webhook', (req, res, next) => {
            req.rawBody = Buffer.from(JSON.stringify(req.body));
            next();
        });

        // Mock DatabaseService
        mockDatabaseService = {
            saveGroupMessage: jest.fn().mockResolvedValue({
                success: true,
                messageId: 'test-msg',
                postBankId: 1,
                groupId: 'group@g.us'
            }),
            saveUserInfo: jest.fn().mockResolvedValue({
                id: 1,
                display_name: 'Test User'
            })
        };

        // Create WebhookHandler
        webhookHandler = new WebhookHandler();
        webhookHandler.groupMessageMonitor.setDatabaseService(mockDatabaseService);

        // Add webhook route
        app.post('/webhook/wasender', webhookHandler.createMiddleware());
    });

    afterEach(() => {
        delete process.env.WASENDER_WEBHOOK_SECRET;
        jest.clearAllMocks();
    });

    describe('Single Request Performance', () => {
        test('should respond to webhook within 100ms', async () => {
            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'perf-msg-1',
                            remoteJid: 'group123@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            conversation: 'Performance test message'
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000)
                    }]
                }
            };

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const startTime = Date.now();
            
            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            const responseTime = Date.now() - startTime;

            expect(response.status).toBe(200);
            expect(responseTime).toBeLessThan(100); // Should respond within 100ms
        });

        test('should handle large message payloads efficiently', async () => {
            const largeMessage = 'A'.repeat(5000); // 5KB message
            
            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'large-msg-1',
                            remoteJid: 'group123@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            conversation: largeMessage
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000)
                    }]
                }
            };

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const startTime = Date.now();
            
            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            const responseTime = Date.now() - startTime;

            expect(response.status).toBe(200);
            expect(responseTime).toBeLessThan(200); // Should handle large payloads within 200ms
        });

        test('should process multiple messages in single webhook efficiently', async () => {
            const messages = [];
            for (let i = 0; i < 10; i++) {
                messages.push({
                    key: {
                        id: `batch-msg-${i}`,
                        remoteJid: 'group123@g.us',
                        participant: '1234567890@s.whatsapp.net'
                    },
                    message: {
                        conversation: `Batch message ${i}`
                    },
                    messageTimestamp: Math.floor(Date.now() / 1000)
                });
            }

            const webhookPayload = {
                event: 'messages.upsert',
                data: { messages }
            };

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const startTime = Date.now();
            
            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            const responseTime = Date.now() - startTime;

            expect(response.status).toBe(200);
            expect(responseTime).toBeLessThan(150); // Should handle batch within 150ms
        });
    });

    describe('Concurrent Request Load Testing', () => {
        test('should handle 50 concurrent webhook requests', async () => {
            const concurrentRequests = 50;
            const promises = [];
            const responseTimes = [];

            for (let i = 0; i < concurrentRequests; i++) {
                const webhookPayload = {
                    event: 'messages.upsert',
                    data: {
                        messages: [{
                            key: {
                                id: `concurrent-msg-${i}`,
                                remoteJid: 'group123@g.us',
                                participant: '1234567890@s.whatsapp.net'
                            },
                            message: {
                                conversation: `Concurrent message ${i}`
                            },
                            messageTimestamp: Math.floor(Date.now() / 1000)
                        }]
                    }
                };

                const payloadString = JSON.stringify(webhookPayload);
                const signature = crypto
                    .createHmac('sha256', 'test-webhook-secret')
                    .update(payloadString, 'utf8')
                    .digest('hex');

                const startTime = Date.now();
                
                const promise = request(app)
                    .post('/webhook/wasender')
                    .set('Content-Type', 'application/json')
                    .set('X-Webhook-Signature', signature)
                    .send(webhookPayload)
                    .then(response => {
                        const responseTime = Date.now() - startTime;
                        responseTimes.push(responseTime);
                        return response;
                    });

                promises.push(promise);
            }

            const responses = await Promise.all(promises);

            // All requests should succeed
            responses.forEach(response => {
                expect(response.status).toBe(200);
            });

            // Calculate performance metrics
            const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
            const maxResponseTime = Math.max(...responseTimes);
            const minResponseTime = Math.min(...responseTimes);

            console.log(`Concurrent Load Test Results (${concurrentRequests} requests):`);
            console.log(`Average Response Time: ${avgResponseTime.toFixed(2)}ms`);
            console.log(`Max Response Time: ${maxResponseTime}ms`);
            console.log(`Min Response Time: ${minResponseTime}ms`);

            // Performance assertions
            expect(avgResponseTime).toBeLessThan(500); // Average should be under 500ms
            expect(maxResponseTime).toBeLessThan(2000); // Max should be under 2 seconds
            expect(responses.length).toBe(concurrentRequests);
        }, 30000); // 30 second timeout for load test

        test('should maintain performance under sustained load', async () => {
            const batchSize = 20;
            const numberOfBatches = 5;
            const batchResults = [];

            for (let batch = 0; batch < numberOfBatches; batch++) {
                const batchPromises = [];
                const batchStartTime = Date.now();

                for (let i = 0; i < batchSize; i++) {
                    const webhookPayload = {
                        event: 'messages.upsert',
                        data: {
                            messages: [{
                                key: {
                                    id: `sustained-batch${batch}-msg${i}`,
                                    remoteJid: 'group123@g.us',
                                    participant: '1234567890@s.whatsapp.net'
                                },
                                message: {
                                    conversation: `Sustained load batch ${batch} message ${i}`
                                },
                                messageTimestamp: Math.floor(Date.now() / 1000)
                            }]
                        }
                    };

                    const payloadString = JSON.stringify(webhookPayload);
                    const signature = crypto
                        .createHmac('sha256', 'test-webhook-secret')
                        .update(payloadString, 'utf8')
                        .digest('hex');

                    const promise = request(app)
                        .post('/webhook/wasender')
                        .set('Content-Type', 'application/json')
                        .set('X-Webhook-Signature', signature)
                        .send(webhookPayload);

                    batchPromises.push(promise);
                }

                const batchResponses = await Promise.all(batchPromises);
                const batchTime = Date.now() - batchStartTime;

                batchResults.push({
                    batch,
                    time: batchTime,
                    successCount: batchResponses.filter(r => r.status === 200).length,
                    totalRequests: batchSize
                });

                // Small delay between batches
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Analyze sustained load results
            const avgBatchTime = batchResults.reduce((sum, batch) => sum + batch.time, 0) / batchResults.length;
            const totalSuccessful = batchResults.reduce((sum, batch) => sum + batch.successCount, 0);
            const totalRequests = numberOfBatches * batchSize;

            console.log('Sustained Load Test Results:');
            console.log(`Total Requests: ${totalRequests}`);
            console.log(`Successful Requests: ${totalSuccessful}`);
            console.log(`Success Rate: ${((totalSuccessful / totalRequests) * 100).toFixed(2)}%`);
            console.log(`Average Batch Time: ${avgBatchTime.toFixed(2)}ms`);

            // Performance assertions
            expect(totalSuccessful).toBe(totalRequests); // 100% success rate
            expect(avgBatchTime).toBeLessThan(3000); // Average batch should complete within 3 seconds

            // Performance should not degrade significantly over time
            const firstBatchTime = batchResults[0].time;
            const lastBatchTime = batchResults[batchResults.length - 1].time;
            const degradationRatio = lastBatchTime / firstBatchTime;
            
            expect(degradationRatio).toBeLessThan(2); // Performance shouldn't degrade more than 2x
        }, 45000); // 45 second timeout for sustained load test
    });

    describe('Memory and Resource Usage', () => {
        test('should not leak memory during high-volume processing', async () => {
            const initialMemory = process.memoryUsage();
            const requestCount = 100;
            const promises = [];

            // Generate many requests
            for (let i = 0; i < requestCount; i++) {
                const webhookPayload = {
                    event: 'messages.upsert',
                    data: {
                        messages: [{
                            key: {
                                id: `memory-test-${i}`,
                                remoteJid: 'group123@g.us',
                                participant: '1234567890@s.whatsapp.net'
                            },
                            message: {
                                conversation: `Memory test message ${i}`
                            },
                            messageTimestamp: Math.floor(Date.now() / 1000)
                        }]
                    }
                };

                const payloadString = JSON.stringify(webhookPayload);
                const signature = crypto
                    .createHmac('sha256', 'test-webhook-secret')
                    .update(payloadString, 'utf8')
                    .digest('hex');

                const promise = request(app)
                    .post('/webhook/wasender')
                    .set('Content-Type', 'application/json')
                    .set('X-Webhook-Signature', signature)
                    .send(webhookPayload);

                promises.push(promise);
            }

            await Promise.all(promises);

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

            // Wait for background processing to complete
            await new Promise(resolve => setTimeout(resolve, 1000));

            const finalMemory = process.memoryUsage();
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
            const memoryIncreasePerRequest = memoryIncrease / requestCount;

            console.log('Memory Usage Test Results:');
            console.log(`Initial Heap: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Final Heap: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Memory Increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
            console.log(`Memory per Request: ${(memoryIncreasePerRequest / 1024).toFixed(2)} KB`);

            // Memory increase should be reasonable
            expect(memoryIncreasePerRequest).toBeLessThan(50 * 1024); // Less than 50KB per request
        }, 30000);

        test('should handle webhook processing with limited memory', async () => {
            // Simulate memory pressure by creating large objects
            const memoryPressure = [];
            for (let i = 0; i < 10; i++) {
                memoryPressure.push(new Array(100000).fill('memory-pressure'));
            }

            const webhookPayload = {
                event: 'messages.upsert',
                data: {
                    messages: [{
                        key: {
                            id: 'memory-pressure-msg',
                            remoteJid: 'group123@g.us',
                            participant: '1234567890@s.whatsapp.net'
                        },
                        message: {
                            conversation: 'Message under memory pressure'
                        },
                        messageTimestamp: Math.floor(Date.now() / 1000)
                    }]
                }
            };

            const payloadString = JSON.stringify(webhookPayload);
            const signature = crypto
                .createHmac('sha256', 'test-webhook-secret')
                .update(payloadString, 'utf8')
                .digest('hex');

            const response = await request(app)
                .post('/webhook/wasender')
                .set('Content-Type', 'application/json')
                .set('X-Webhook-Signature', signature)
                .send(webhookPayload);

            expect(response.status).toBe(200);

            // Clean up memory pressure
            memoryPressure.length = 0;
        });
    });

    describe('Database Performance Under Load', () => {
        test('should maintain database performance with high message volume', async () => {
            const messageCount = 50;
            const promises = [];
            const dbResponseTimes = [];

            // Mock database service with response time tracking
            mockDatabaseService.saveGroupMessage.mockImplementation(async () => {
                const dbStartTime = Date.now();
                
                // Simulate database operation time
                await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
                
                const dbResponseTime = Date.now() - dbStartTime;
                dbResponseTimes.push(dbResponseTime);
                
                return {
                    success: true,
                    messageId: 'test-msg',
                    postBankId: Math.floor(Math.random() * 1000),
                    groupId: 'group@g.us'
                };
            });

            for (let i = 0; i < messageCount; i++) {
                const webhookPayload = {
                    event: 'messages.upsert',
                    data: {
                        messages: [{
                            key: {
                                id: `db-perf-msg-${i}`,
                                remoteJid: 'group123@g.us',
                                participant: '1234567890@s.whatsapp.net'
                            },
                            message: {
                                conversation: `Database performance test message ${i}`
                            },
                            messageTimestamp: Math.floor(Date.now() / 1000)
                        }]
                    }
                };

                const payloadString = JSON.stringify(webhookPayload);
                const signature = crypto
                    .createHmac('sha256', 'test-webhook-secret')
                    .update(payloadString, 'utf8')
                    .digest('hex');

                const promise = request(app)
                    .post('/webhook/wasender')
                    .set('Content-Type', 'application/json')
                    .set('X-Webhook-Signature', signature)
                    .send(webhookPayload);

                promises.push(promise);
            }

            await Promise.all(promises);

            // Wait for background processing
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Analyze database performance
            const avgDbResponseTime = dbResponseTimes.reduce((a, b) => a + b, 0) / dbResponseTimes.length;
            const maxDbResponseTime = Math.max(...dbResponseTimes);

            console.log('Database Performance Results:');
            console.log(`Database Operations: ${dbResponseTimes.length}`);
            console.log(`Average DB Response Time: ${avgDbResponseTime.toFixed(2)}ms`);
            console.log(`Max DB Response Time: ${maxDbResponseTime}ms`);

            expect(mockDatabaseService.saveGroupMessage).toHaveBeenCalledTimes(messageCount);
            expect(avgDbResponseTime).toBeLessThan(100); // Average DB operation under 100ms
            expect(maxDbResponseTime).toBeLessThan(200); // Max DB operation under 200ms
        }, 30000);
    });

    describe('Error Handling Performance', () => {
        test('should handle invalid requests efficiently', async () => {
            const invalidRequests = [
                { payload: null, signature: 'invalid' },
                { payload: { invalid: 'data' }, signature: 'wrong-signature' },
                { payload: { event: 'unknown' }, signature: 'test-signature' }
            ];

            const responseTimes = [];

            for (const { payload, signature } of invalidRequests) {
                const startTime = Date.now();
                
                const response = await request(app)
                    .post('/webhook/wasender')
                    .set('Content-Type', 'application/json')
                    .set('X-Webhook-Signature', signature)
                    .send(payload);

                const responseTime = Date.now() - startTime;
                responseTimes.push(responseTime);

                expect(response.status).toBeGreaterThanOrEqual(400);
            }

            const avgErrorResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
            
            console.log(`Average Error Response Time: ${avgErrorResponseTime.toFixed(2)}ms`);
            
            // Error responses should be fast
            expect(avgErrorResponseTime).toBeLessThan(50);
        });

        test('should maintain performance during database errors', async () => {
            // Mock database errors
            mockDatabaseService.saveGroupMessage.mockRejectedValue(new Error('Database connection failed'));

            const errorRequestCount = 20;
            const promises = [];

            for (let i = 0; i < errorRequestCount; i++) {
                const webhookPayload = {
                    event: 'messages.upsert',
                    data: {
                        messages: [{
                            key: {
                                id: `error-msg-${i}`,
                                remoteJid: 'group123@g.us',
                                participant: '1234567890@s.whatsapp.net'
                            },
                            message: {
                                conversation: `Error handling test message ${i}`
                            },
                            messageTimestamp: Math.floor(Date.now() / 1000)
                        }]
                    }
                };

                const payloadString = JSON.stringify(webhookPayload);
                const signature = crypto
                    .createHmac('sha256', 'test-webhook-secret')
                    .update(payloadString, 'utf8')
                    .digest('hex');

                const startTime = Date.now();
                
                const promise = request(app)
                    .post('/webhook/wasender')
                    .set('Content-Type', 'application/json')
                    .set('X-Webhook-Signature', signature)
                    .send(webhookPayload)
                    .then(response => ({
                        response,
                        responseTime: Date.now() - startTime
                    }));

                promises.push(promise);
            }

            const results = await Promise.all(promises);

            // All webhook responses should still be successful (immediate 200 OK)
            results.forEach(({ response, responseTime }) => {
                expect(response.status).toBe(200);
                expect(responseTime).toBeLessThan(200); // Should respond quickly even with DB errors
            });

            const avgResponseTime = results.reduce((sum, { responseTime }) => sum + responseTime, 0) / results.length;
            
            console.log(`Average Response Time with DB Errors: ${avgResponseTime.toFixed(2)}ms`);
            
            expect(avgResponseTime).toBeLessThan(100); // Should maintain fast response times
        });
    });
});