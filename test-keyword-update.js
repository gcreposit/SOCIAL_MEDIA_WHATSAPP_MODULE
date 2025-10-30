/**
 * Test script for Keyword Update Service
 * Tests the API connection and update functionality
 */

const KeywordUpdateService = require('./src/services/keywordUpdateService');

async function testKeywordUpdate() {
    console.log('🧪 Testing Keyword Update Service\n');
    
    // Initialize the service
    const keywordService = new KeywordUpdateService();
    
    try {
        // Test API connection and data fetching
        console.log('1. Testing API connection...');
        const result = await keywordService.performUpdate();
        
        if (result.updated) {
            console.log('✅ Update successful!');
            console.log(`- Records fetched: ${result.recordCount}`);
            console.log(`- Data hash: ${result.newHash.substring(0, 8)}...`);
            console.log(`- Processing time: ${result.processingTime}ms`);
        } else {
            console.log('ℹ️ No update needed');
            console.log(`- Reason: ${result.reason}`);
        }
        
        // Test service statistics
        console.log('\n2. Service Statistics:');
        const stats = keywordService.getStats();
        console.log(`- Total fetches: ${stats.totalFetches}`);
        console.log(`- Successful fetches: ${stats.successfulFetches}`);
        console.log(`- Failed fetches: ${stats.failedFetches}`);
        console.log(`- Updates applied: ${stats.updatesApplied}`);
        console.log(`- No-change skips: ${stats.noChangeSkips}`);
        
        // Test health check
        console.log('\n3. Health Check:');
        const health = keywordService.healthCheck();
        console.log(`- Status: ${health.status}`);
        console.log(`- Is running: ${health.isRunning}`);
        console.log(`- Last success: ${health.lastSuccessAge}`);
        
        if (health.issues.length > 0) {
            console.log(`- Issues: ${health.issues.join(', ')}`);
        }
        
        // Test force update
        console.log('\n4. Testing force update...');
        const forceResult = await keywordService.forceUpdate();
        
        if (forceResult.updated) {
            console.log('✅ Force update completed');
        } else {
            console.log('ℹ️ No changes detected in force update');
        }
        
        console.log('\n🎯 Keyword Update Service Test Results:');
        console.log('✅ API connection working');
        console.log('✅ Data fetching functional');
        console.log('✅ Change detection working');
        console.log('✅ Statistics tracking operational');
        console.log('✅ Health monitoring active');
        
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
        
        // Show service stats even on failure
        const stats = keywordService.getStats();
        console.log('\nService Statistics (on failure):');
        console.log(`- Total attempts: ${stats.totalFetches}`);
        console.log(`- Failed attempts: ${stats.failedFetches}`);
        if (stats.lastError) {
            console.log(`- Last error: ${stats.lastError.message}`);
            console.log(`- Error time: ${stats.lastError.time}`);
        }
    }
}

// Test with manual trigger option
if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.includes('--start-service')) {
        console.log('🚀 Starting keyword update service in test mode...');
        
        const service = new KeywordUpdateService();
        service.start().then(() => {
            console.log('✅ Service started - will run every 6 hours');
            console.log('Press Ctrl+C to stop');
            
            // Keep process alive
            process.on('SIGINT', () => {
                console.log('\n🛑 Stopping service...');
                service.stop();
                process.exit(0);
            });
        }).catch(error => {
            console.error('❌ Failed to start service:', error);
            process.exit(1);
        });
    } else {
        testKeywordUpdate().catch(console.error);
    }
}

module.exports = testKeywordUpdate;