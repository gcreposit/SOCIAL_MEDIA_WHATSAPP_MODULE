// Comprehensive test script to verify messageProcessor.js loads without syntax errors
const MessageProcessor = require('./src/services/messageProcessor.js');

console.log('MessageProcessor loaded successfully!');

// Create an instance of MessageProcessor
const processor = new MessageProcessor();
console.log('MessageProcessor instance created successfully!');

// Test a simple method to ensure the class is working
const testMimeType = 'video/mp4';
const extension = processor.getFileExtensionFromMimeType(testMimeType);
console.log(`Test getFileExtensionFromMimeType with ${testMimeType} returned: ${extension}`);

console.log('Test complete - no syntax errors found.');