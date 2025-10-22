/**
 * Jest Test Setup
 * Global test configuration and setup
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise during tests

// Mock console methods to reduce test output noise
const originalConsole = { ...console };

beforeAll(() => {
  // Optionally suppress console output during tests
  if (process.env.SUPPRESS_TEST_LOGS === 'true') {
    console.log = jest.fn();
    console.info = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  }
});

afterAll(() => {
  // Restore console methods
  if (process.env.SUPPRESS_TEST_LOGS === 'true') {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }
});

// Global test utilities
global.testUtils = {
  // Helper to create mock WhatsApp message
  createMockMessage: (overrides = {}) => ({
    key: {
      id: 'test-msg-123',
      remoteJid: 'group123@g.us',
      participant: '1234567890@s.whatsapp.net',
      ...overrides.key
    },
    message: {
      conversation: 'Test message',
      ...overrides.message
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Test User',
    ...overrides
  }),

  // Helper to create mock group info
  createMockGroupInfo: (overrides = {}) => ({
    groupId: 'group123@g.us',
    groupName: 'Test Group',
    isGroup: true,
    ...overrides
  }),

  // Helper to create mock user info
  createMockUserInfo: (overrides = {}) => ({
    userId: '1234567890@s.whatsapp.net',
    displayName: 'Test User',
    phoneNumber: '1234567890',
    platform: 'whatsapp',
    ...overrides
  }),

  // Helper to generate HMAC signature for webhook tests
  generateWebhookSignature: (payload, secret) => {
    const crypto = require('crypto');
    return crypto
      .createHmac('sha256', secret)
      .update(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8')
      .digest('hex');
  },

  // Helper to wait for async operations
  wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

  // Helper to create performance measurement
  measurePerformance: async (fn, label = 'Operation') => {
    const startTime = Date.now();
    const result = await fn();
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`${label} completed in ${duration}ms`);
    
    return { result, duration };
  }
};

// Increase timeout for performance tests
if (process.env.RUN_PERFORMANCE_TESTS === 'true') {
  jest.setTimeout(60000); // 60 seconds for performance tests
}

// Clean up after each test
afterEach(() => {
  // Clear all timers
  jest.clearAllTimers();
  
  // Clear all mocks
  jest.clearAllMocks();
});