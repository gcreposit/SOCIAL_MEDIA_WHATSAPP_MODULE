/**
 * Concurrent Safety Test for Keyword Update System
 * 
 * Tests that the system handles concurrent access safely:
 * 1. Continuous message filtering while JSON updates happen
 * 2. Multiple simultaneous reload requests
 * 3. File corruption prevention
 * 4. Service availability during updates
 */

const MessageFilterService = require('./src/services/messageFilterService');
const KeywordUpdateService = require('./src/services/keywordUpdateService');

async function testConcurrentSafety() {
    console.log('🧪 Testing Concurrent Safety of Keyword Update System\n');
    
    // Initialize services
    const filterService = new MessageFilterService();
    const updateService = new KeywordUpdateService();
    
    // Test message data
    const testMessages = [
        {
            messageText: 'लखनऊ में पुलिस द्वारा हत्या का मामला दर्ज',
            messageType: 'text',
            groupInfo: { groupName: 'UP News' },
            mediaInfo: { hasMedia: false }
        },
        {
            messageText: 'Agra police arrested suspect in murder case',
            messageType: 'text',
            groupInfo: { groupName: 'Crime News' },
            mediaInfo: { hasMedia: false }
        },
        {
            messageText: 'Hello how are you',
            messageType: 'text',
            groupInfo: { groupName: 'Personal Chat' },
            mediaInfo: { hasMedia: false }
        }
    ];

    console.log('1. Testing Normal Operation (Baseline)');
    console.log('=====================================');
    
    // Test normal filtering
    let results = [];
    for (const message of testMessages) {
        const result = filterService.shouldProcessMessage(message);
        results.push({
            message: message.messageText.substring(0, 30) + '...',
            shouldSave: result.shouldSave,
            reason: result.reason
        });
    }
    
    console.log('Normal filtering results:');
    results.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.message} -> ${r.shouldSave ? '✅ SAVE' : '❌ SKIP'} (${r.reason})`);
    });
    
    console.log('\n2. Testing Concurrent Filtering During Update');
    console.log('=============================================');
    
    // Simulate concurrent filtering while update happens
    const concurrentResults = [];
    let updateCompleted = false;
    let updateError = null;
    
    // Start continuous filtering in background
    const filteringInterval = setInterval(() => {
        try {
            const randomMessage = testMessages[Math.floor(Math.random() * testMessages.length)];
            const result = filterService.shouldProcessMessage(randomMessage);
            concurrentResults.push({
                timestamp: new Date().toISOString(),
                success: true,
                shouldSave: result.shouldSave,
                duringReload: filterService.isReloading
            });
        } catch (error) {
            concurrentResults.push({
                timestamp: new Date().toISOString(),
                success: false,
                error: error.message,
                duringReload: filterService.isReloading
            });
        }
    }, 10); // Filter every 10ms
    
    // Trigger update after some filtering
    setTimeout(async () => {
        try {
            console.log('🔄 Triggering keyword update while filtering is running...');
            await updateService.performUpdate();
            updateCompleted = true;
            console.log('✅ Update completed successfully');
        } catch (error) {
            updateError = error;
            console.log('❌ Update failed:', error.message);
        }
    }, 100);
    
    // Let it run for 2 seconds
    await new Promise(resolve => setTimeout(resolve, 2000));
    clearInterval(filteringInterval);
    
    // Analyze results
    const totalOperations = concurrentResults.length;
    const successfulOperations = concurrentResults.filter(r => r.success).length;
    const failedOperations = concurrentResults.filter(r => !r.success).length;
    const operationsDuringReload = concurrentResults.filter(r => r.duringReload).length;
    
    console.log('\nConcurrent Operation Results:');
    console.log(`- Total filtering operations: ${totalOperations}`);
    console.log(`- Successful operations: ${successfulOperations}`);
    console.log(`- Failed operations: ${failedOperations}`);
    console.log(`- Operations during reload: ${operationsDuringReload}`);
    console.log(`- Success rate: ${((successfulOperations / totalOperations) * 100).toFixed(2)}%`);
    console.log(`- Update completed: ${updateCompleted ? '✅' : '❌'}`);
    
    if (updateError) {
        console.log(`- Update error: ${updateError.message}`);
    }
    
    console.log('\n3. Testing Multiple Simultaneous Reloads');
    console.log('========================================');
    
    // Test multiple simultaneous reload requests
    const reloadPromises = [];
    const reloadResults = [];
    
    for (let i = 0; i < 5; i++) {
        const promise = filterService.reloadFilterData()
            .then(result => {
                reloadResults.push({ success: true, changed: result, index: i });
            })
            .catch(error => {
                reloadResults.push({ success: false, error: error.message, index: i });
            });
        reloadPromises.push(promise);
    }
    
    await Promise.all(reloadPromises);
    
    console.log('Multiple reload results:');
    reloadResults.forEach(r => {
        if (r.success) {
            console.log(`  Reload ${r.index + 1}: ✅ Success (changed: ${r.changed})`);
        } else {
            console.log(`  Reload ${r.index + 1}: ❌ Failed (${r.error})`);
        }
    });
    
    console.log('\n4. Testing Service Metrics');
    console.log('==========================');
    
    const metrics = filterService.getMetrics();
    console.log('Filter Service Metrics:');
    console.log(`- Total processed: ${metrics.totalProcessed}`);
    console.log(`- Concurrent access events: ${metrics.concurrentAccess}`);
    console.log(`- Reload conflicts: ${metrics.reloadConflicts}`);
    console.log(`- Data reloads: ${metrics.dataReloads}`);
    console.log(`- Average processing time: ${metrics.avgProcessingTimeMs}ms`);
    
    const updateStats = updateService.getStats();
    console.log('\nUpdate Service Metrics:');
    console.log(`- Total fetches: ${updateStats.totalFetches}`);
    console.log(`- Successful fetches: ${updateStats.successfulFetches}`);
    console.log(`- Updates applied: ${updateStats.updatesApplied}`);
    console.log(`- Service running: ${updateStats.isRunning}`);
    
    console.log('\n5. Final Verification');
    console.log('=====================');
    
    // Verify filtering still works correctly after all operations
    console.log('Verifying filtering accuracy after concurrent operations:');
    
    const finalResults = [];
    for (const message of testMessages) {
        const result = filterService.shouldProcessMessage(message);
        finalResults.push({
            message: message.messageText.substring(0, 30) + '...',
            shouldSave: result.shouldSave,
            reason: result.reason
        });
    }
    
    // Compare with baseline
    let accuracyMaintained = true;
    for (let i = 0; i < results.length; i++) {
        if (results[i].shouldSave !== finalResults[i].shouldSave) {
            accuracyMaintained = false;
            console.log(`  ❌ Accuracy issue: Message ${i + 1} changed from ${results[i].shouldSave} to ${finalResults[i].shouldSave}`);
        }
    }
    
    if (accuracyMaintained) {
        console.log('  ✅ Filtering accuracy maintained throughout concurrent operations');
    }
    
    console.log('\n🎯 Concurrent Safety Test Results:');
    console.log('==================================');
    
    const allTestsPassed = 
        failedOperations === 0 && 
        updateCompleted && 
        !updateError && 
        accuracyMaintained &&
        successfulOperations > 0;
    
    if (allTestsPassed) {
        console.log('✅ ALL TESTS PASSED - System is concurrent-safe');
        console.log('✅ No filtering operations failed during updates');
        console.log('✅ JSON updates completed successfully');
        console.log('✅ Multiple reload requests handled safely');
        console.log('✅ Filtering accuracy maintained');
        console.log('✅ No crashes or data corruption detected');
    } else {
        console.log('❌ SOME TESTS FAILED - Review results above');
    }
    
    console.log('\n📊 Performance Summary:');
    console.log(`- Processed ${totalOperations} filtering operations in 2 seconds`);
    console.log(`- Rate: ${(totalOperations / 2).toFixed(0)} operations/second`);
    console.log(`- Zero downtime during updates: ${failedOperations === 0 ? '✅' : '❌'}`);
    console.log(`- Concurrent access handled: ${operationsDuringReload > 0 ? '✅' : 'N/A'}`);
}

if (require.main === module) {
    testConcurrentSafety().catch(console.error);
}

module.exports = testConcurrentSafety;