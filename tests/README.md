# Testing Documentation

This directory contains comprehensive tests for the Wasender API Migration project, covering unit tests, integration tests, and performance tests.

## Test Structure

```
tests/
├── setup.js                           # Global test setup and utilities
├── services/                          # Unit tests for services
│   ├── wasender/
│   │   ├── webhookHandler.test.js     # WebhookHandler unit tests
│   │   ├── groupMessageMonitor.test.js # GroupMessageMonitor unit tests
│   │   └── sessionManager.test.js     # SessionManager unit tests (existing)
│   └── mediaDecryptionService.test.js # MediaDecryptionService unit tests
├── integration/                       # Integration tests
│   ├── webhookProcessing.test.js      # End-to-end webhook processing
│   ├── databaseIntegration.test.js    # Database operations with models
│   └── sessionManagement.test.js      # Session management scenarios
└── performance/                       # Performance and load tests
    ├── webhookLoad.test.js            # Webhook endpoint performance
    ├── mediaProcessing.test.js        # Media processing performance
    └── databasePerformance.test.js    # Database performance under load
```

## Test Categories

### Unit Tests (`tests/services/`)

Tests individual service components in isolation with mocked dependencies:

- **WebhookHandler**: Signature verification, security checks, event routing
- **GroupMessageMonitor**: Message filtering, data extraction, caching
- **MediaDecryptionService**: File decryption, validation, storage
- **SessionManager**: Session lifecycle, reconnection logic

### Integration Tests (`tests/integration/`)

Tests complete workflows with multiple components working together:

- **Webhook Processing**: End-to-end message processing from HTTP request to database
- **Database Integration**: Model interactions, transactions, data consistency
- **Session Management**: Authentication flows, reconnection scenarios

### Performance Tests (`tests/performance/`)

Tests system performance under various load conditions:

- **Webhook Load**: Concurrent requests, response times, throughput
- **Media Processing**: Large file handling, memory usage, concurrent processing
- **Database Performance**: High-volume operations, query performance, transaction efficiency

## Running Tests

### All Tests
```bash
npm test
```

### Specific Test Categories
```bash
# Unit tests only
npm test -- --testPathPattern="tests/services"

# Integration tests only
npm test -- --testPathPattern="tests/integration"

# Performance tests only
npm test -- --testPathPattern="tests/performance"
```

### Specific Test Files
```bash
# WebhookHandler tests
npm test -- --testPathPattern="webhookHandler.test.js"

# Database integration tests
npm test -- --testPathPattern="databaseIntegration.test.js"
```

### With Coverage
```bash
npm test -- --coverage
```

### Performance Testing
```bash
# Run performance tests with extended timeout
RUN_PERFORMANCE_TESTS=true npm test -- --testPathPattern="tests/performance"
```

## Test Configuration

### Jest Configuration (`jest.config.js`)
- Test environment: Node.js
- Coverage collection from `src/` directory
- Custom test timeout: 10 seconds (60 seconds for performance tests)
- Coverage thresholds: 70% for branches, functions, lines, statements

### Environment Variables for Testing
```bash
NODE_ENV=test                    # Set test environment
LOG_LEVEL=error                  # Reduce log noise
SUPPRESS_TEST_LOGS=true          # Suppress console output
RUN_PERFORMANCE_TESTS=true       # Enable performance test mode
```

## Test Utilities

The `tests/setup.js` file provides global utilities:

- `testUtils.createMockMessage()` - Create mock WhatsApp messages
- `testUtils.createMockGroupInfo()` - Create mock group information
- `testUtils.createMockUserInfo()` - Create mock user information
- `testUtils.generateWebhookSignature()` - Generate HMAC signatures for webhook tests
- `testUtils.measurePerformance()` - Measure function execution time
- `testUtils.wait()` - Async delay utility

## Test Requirements Mapping

### Requirements Coverage

| Requirement | Test Files | Test Types |
|-------------|------------|------------|
| 2.1 - Group message filtering | `groupMessageMonitor.test.js`, `webhookProcessing.test.js` | Unit, Integration |
| 3.1 - Webhook signature verification | `webhookHandler.test.js`, `webhookProcessing.test.js` | Unit, Integration |
| 4.1 - Media decryption | `mediaDecryptionService.test.js`, `mediaProcessing.test.js` | Unit, Performance |
| 5.4 - Database operations | `databaseIntegration.test.js`, `databasePerformance.test.js` | Integration, Performance |
| 8.1 - Session management | `sessionManager.test.js`, `sessionManagement.test.js` | Unit, Integration |

### Performance Requirements

- **Webhook Response Time**: < 100ms (tested in `webhookLoad.test.js`)
- **Media Processing**: < 5 seconds for 20MB files (tested in `mediaProcessing.test.js`)
- **Database Operations**: < 50ms per message (tested in `databasePerformance.test.js`)
- **Concurrent Load**: 50+ concurrent requests (tested in `webhookLoad.test.js`)

## Mocking Strategy

### Service Dependencies
- **LoggingService**: Mocked to prevent log noise and test log calls
- **DatabaseService**: Mocked with simulated response times for performance tests
- **WasenderClient**: Mocked to simulate API responses and failures
- **FileSystem**: Mocked to prevent actual file operations during tests

### Database Models
- **PostBank, PostUser, CommonAttachment**: Mocked with realistic response times
- **Transactions**: Mocked to test rollback scenarios
- **Sequelize**: Mocked to simulate database operations

## Best Practices

### Test Organization
- One test file per service/component
- Group related tests using `describe` blocks
- Use descriptive test names that explain the scenario
- Include both positive and negative test cases

### Performance Testing
- Use realistic data sizes and volumes
- Measure and assert on response times
- Test memory usage and cleanup
- Include concurrent load scenarios

### Integration Testing
- Test complete workflows end-to-end
- Use realistic mock data
- Test error scenarios and recovery
- Verify data consistency across components

### Assertions
- Test both success and failure cases
- Verify performance metrics (response times, throughput)
- Check resource usage (memory, database connections)
- Validate data integrity and consistency

## Troubleshooting

### Common Issues

1. **Test Timeouts**: Increase timeout for performance tests or check for hanging promises
2. **Memory Leaks**: Ensure proper cleanup in `afterEach` hooks
3. **Mock Issues**: Verify mock implementations match actual service interfaces
4. **Async Issues**: Use proper `await` for async operations and promises

### Debug Mode
```bash
# Run tests with verbose output
npm test -- --verbose

# Run specific test with debugging
npm test -- --testNamePattern="should process group message" --verbose
```

## Contributing

When adding new tests:

1. Follow the existing test structure and naming conventions
2. Include both unit and integration tests for new features
3. Add performance tests for operations that handle large data or high volume
4. Update this README with new test categories or utilities
5. Ensure tests are deterministic and don't depend on external services
6. Mock all external dependencies appropriately