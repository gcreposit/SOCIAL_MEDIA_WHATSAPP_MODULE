/**
 * WhatsApp Message Filtering Example
 * Demonstrates how the district and keyword filtering works for WhatsApp messages
 */

const WhatsAppMessageFilter = require('../src/services/whatsappMessageFilter');
const WhatsAppDatabaseService = require('../src/services/whatsappDatabaseService');

// Mock database models for example
const mockModels = {
    PostBank: {
        create: async (data) => ({ id: 1, ...data }),
        findOrCreate: async ({ where, defaults }) => [{ id: 1, ...defaults }, true]
    },
    PostUser: {
        findOrCreate: async ({ where, defaults }) => [{ id: 1, ...defaults }, true]
    },
    CommonAttachment: {
        create: async (data) => ({ id: 1, ...data })
    },
    sequelize: {
        transaction: async () => ({
            commit: async () => {},
            rollback: async () => {}
        })
    }
};

async function demonstrateFiltering() {
    console.log('🔍 WhatsApp Message Filtering Demonstration\n');

    const filter = new WhatsAppMessageFilter();
    const dbService = new WhatsAppDatabaseService(mockModels);

    // Test cases
    const testMessages = [
        {
            name: 'Case A: Message + Media with District + Keyword (Should Save)',
            messageData: {
                messageText: 'लखनऊ में पुलिस द्वारा गिरफ्तारी की गई। एक व्यक्ति को हत्या के आरोप में पकड़ा गया।',
                groupName: 'UP News Updates',
                senderName: 'News Reporter',
                hasMedia: true,
                mediaType: 'image'
            }
        },
        {
            name: 'Case B: Message Only with District + Keyword (Should Save)',
            messageData: {
                messageText: 'Agra police arrested a person for theft. FIR has been registered.',
                groupName: 'Crime Updates UP',
                senderName: 'Local Reporter',
                hasMedia: false,
                mediaType: null
            }
        },
        {
            name: 'Case C: Media Only without Text (Should Skip)',
            messageData: {
                messageText: '',
                groupName: 'Random Group',
                senderName: 'User123',
                hasMedia: true,
                mediaType: 'video'
            }
        },
        {
            name: 'Case D: Message with District but No Keyword (Should Skip for non-trusted)',
            messageData: {
                messageText: 'मेरठ में आज बारिश हुई है। मौसम अच्छा है।',
                groupName: 'Weather Updates',
                senderName: 'Weather Bot',
                hasMedia: false,
                mediaType: null
            }
        },
        {
            name: 'Case E: Message with District and Keyword (Should Save)',
            messageData: {
                messageText: 'Breaking: लखनऊ में पुलिस द्वारा हत्या का मामला दर्ज',
                groupName: 'News Channel',
                senderName: 'News Anchor',
                hasMedia: false,
                mediaType: null
            }
        },
        {
            name: 'Case F: Message with Keyword but No District (Should Skip)',
            messageData: {
                messageText: 'पुलिस ने गिरफ्तारी की लेकिन जगह का नाम नहीं बताया',
                groupName: 'General News',
                senderName: 'Reporter',
                hasMedia: false,
                mediaType: null
            }
        }
    ];

    console.log('📊 Filter Configuration:');
    console.log(`- English Districts: ${filter.englishDistricts.length}`);
    console.log(`- Hindi Districts: ${filter.hindiDistricts.length}`);
    console.log(`- Hindi Keywords: ${filter.hindiKeywords.length}`);
    console.log(`- English Keywords: ${filter.englishKeywords.length}`);
    console.log(`- Hinglish Keywords: ${filter.hinglishKeywords.length}\n`);

    // Process each test case
    for (let i = 0; i < testMessages.length; i++) {
        const test = testMessages[i];
        console.log(`${i + 1}. ${test.name}`);
        console.log(`   Message: "${test.messageData.messageText.substring(0, 60)}${test.messageData.messageText.length > 60 ? '...' : ''}"`);
        console.log(`   Group: ${test.messageData.groupName}`);
        console.log(`   Has Media: ${test.messageData.hasMedia} ${test.messageData.mediaType ? `(${test.messageData.mediaType})` : ''}`);

        const result = filter.shouldSaveMessage(test.messageData);
        
        console.log(`   ✅ District Found: ${result.hasDistrict}`);
        console.log(`   🔑 Keyword Found: ${result.hasKeyword}`);
        console.log(`   📝 Decision: ${result.shouldSave ? '✅ SAVE' : '❌ SKIP'} (${result.reason})`);
        
        if (result.shouldSave) {
            console.log(`   💾 Would save to: post_bank + post_user${result.hasMedia ? ' + common_attachments' : ''}`);
        }
        
        console.log('');
    }

    // Show metrics
    console.log('📈 Processing Metrics:');
    const metrics = filter.getMetrics();
    console.log(`- Total Processed: ${metrics.totalProcessed}`);
    console.log(`- Passed Filter: ${metrics.passedFilter} (${metrics.passRate})`);
    console.log(`- Failed Filter: ${metrics.failedFilter} (${metrics.failRate})`);
    console.log(`- Has District Only: ${metrics.hasDistrictOnly}`);
    console.log(`- Has Keyword Only: ${metrics.hasKeywordOnly}`);
    console.log(`- Has Both: ${metrics.hasBoth}`);
    console.log(`- Media Only Skipped: ${metrics.mediaOnlySkipped}`);
    console.log(`- Empty Content Skipped: ${metrics.emptyContentSkipped}`);

    console.log('\n🎯 Summary:');
    console.log('- Messages with text + media that meet criteria → Saved to all tables');
    console.log('- Messages with text only that meet criteria → Saved to post_bank + post_user');
    console.log('- Media only messages → Skipped (not saved)');
    console.log('- All messages: Need BOTH district AND keyword to be saved');
}

// Example of mock WhatsApp webhook message structure
function showWebhookMessageStructure() {
    console.log('\n📱 Example WhatsApp Webhook Message Structure:\n');
    
    const exampleMessage = {
        key: {
            id: 'message_id_123',
            remoteJid: '919876543210-1234567890@g.us', // Group JID
            participant: '919876543210@s.whatsapp.net'   // Sender JID
        },
        message: {
            conversation: 'लखनऊ में पुलिस द्वारा गिरफ्तारी',
            // OR for media messages:
            imageMessage: {
                caption: 'लखनऊ में पुलिस द्वारा गिरफ्तारी',
                mimetype: 'image/jpeg',
                url: 'https://example.com/image.jpg',
                mediaKey: 'media_key_here'
            }
        },
        messageTimestamp: 1640995200, // Unix timestamp
        pushName: 'Sender Name',
        groupMetadata: {
            subject: 'UP News Updates'
        }
    };

    console.log(JSON.stringify(exampleMessage, null, 2));
}

// Run the demonstration
if (require.main === module) {
    demonstrateFiltering()
        .then(() => {
            showWebhookMessageStructure();
            console.log('\n✅ Demonstration completed!');
        })
        .catch(console.error);
}

module.exports = {
    demonstrateFiltering,
    showWebhookMessageStructure
};