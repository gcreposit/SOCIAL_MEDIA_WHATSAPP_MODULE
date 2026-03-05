/**
 * Group Message Monitor Service
 * 
 * Filters and processes only WhatsApp group messages, ignoring personal messages.
 * Implements message data extraction and normalization for Wasender API integration.
 * 
 * Key Features:
 * - Group Detection Logic: Filters messages to process only groups (JID ending with @g.us)
 * - Message Data Extraction: Extracts group info, user info, message content, media, and replies
 * - Message Normalization: Converts Wasender API format to standardized internal format
 * - Duplicate Prevention: Tracks processed messages to prevent duplicate processing
 * - Caching: Caches group and user metadata for performance
 * - Comprehensive Logging: Detailed logging for monitoring and debugging
 * 
 * Requirements Satisfied:
 * - 2.1: Verifies messages originate from WhatsApp groups
 * - 2.2: Ignores personal messages and processes only group messages
 * - 2.3: Stores group messages with source="whatsapp"
 * - 3.2: Processes "messages.upsert" events from webhooks
 * 
 * Integration Points:
 * - WebhookHandler: Receives messages from webhook processing pipeline
 * - DatabaseService: Will send normalized messages for storage (task 4)
 * - MediaDecryptionService: Will send media messages for decryption (task 5)
 */

const logger = require('../loggingService').getServiceLogger('group-message-monitor');
const MessageFilterService = require('../messageFilterService');

class GroupMessageMonitor {
    constructor(databaseService = null, wasenderClient = null) {
        this.processedMessages = new Set(); // Track processed message IDs to prevent duplicates
        this.groupCache = new Map(); // Cache group metadata
        this.userCache = new Map(); // Cache user information
        this.databaseService = databaseService; // Database service for user information persistence
        this.wasenderClient = wasenderClient; // Wasender client for API calls
        this.messageFilterService = new MessageFilterService(); // Message filtering service

        // Initialize metrics for monitoring
        this.metrics = {
            totalMessagesReceived: 0,
            groupMessagesProcessed: 0,
            personalMessagesIgnored: 0,
            duplicateMessagesIgnored: 0,
            processingErrors: 0,
            mediaMessagesProcessed: 0,
            userInfoUpdates: 0,
            newUsersCreated: 0,
            filteredOutMessages: 0,
            savedMessages: 0
        };

        // Validate WasenderClient initialization
        const clientStatus = this.validateWasenderClient();

        logger.info('GroupMessageMonitor initialized', {
            cacheEnabled: true,
            duplicateDetection: true,
            databaseIntegration: !!databaseService,
            wasenderClientAvailable: clientStatus.available,
            wasenderClientStatus: clientStatus.status
        });

        // Log initialization warnings if needed
        if (!clientStatus.available) {
            logger.warn('GroupMessageMonitor initialized without WasenderClient', {
                impact: 'Group name fetching via API will not work',
                solution: 'Pass initialized WasenderClient to constructor for full functionality'
            });
        }
    }

    /**
     * Main entry point for processing messages from webhook handler
     * Implements complete message processing and storage logic with database integration
     * @param {Object} messageData - Raw message data from Wasender API
     * @param {Object} metadata - Additional metadata from webhook processing
     * @returns {Promise<Object>} Processing result with storage information
     */
    async processMessage(messageData, metadata = {}) {
        const startTime = Date.now();
        this.metrics.totalMessagesReceived++;

        try {
            // Validate message structure
            if (!this.isValidMessageStructure(messageData)) {
                logger.warn('Invalid message structure received', {
                    messageData: JSON.stringify(messageData).substring(0, 200),
                    metadata
                });
                return { success: false, reason: 'invalid_structure' };
            }

            const messageId = messageData.key?.id;
            const remoteJid = messageData.key?.remoteJid;

            // Check for duplicate messages
            if (this.isDuplicateMessage(messageId)) {
                this.metrics.duplicateMessagesIgnored++;
                logger.debug('Duplicate message ignored', {
                    messageId,
                    remoteJid,
                    metadata
                });
                return { success: true, reason: 'duplicate_ignored' };
            }

            // Filter: Only process group messages
            if (!this.isGroupMessage(remoteJid)) {
                this.metrics.personalMessagesIgnored++;
                logger.debug('Personal message ignored', {
                    messageId,
                    remoteJid,
                    messageType: 'personal',
                    metadata
                });
                return { success: true, reason: 'personal_message_ignored' };
            }

            // Mark message as processed to prevent duplicates
            this.processedMessages.add(messageId);

            // Extract and normalize message data with enhanced processing
            const normalizedMessage = await this.extractAndNormalizeMessage(messageData, metadata);

            // Apply district and keyword filtering
            const filterResult = this.messageFilterService.shouldProcessMessage(normalizedMessage);

            if (!filterResult.shouldSave) {
                this.metrics.filteredOutMessages++;
                logger.info('Message filtered out - not saving to database', {
                    messageId,
                    reason: filterResult.reason,
                    scenario: filterResult.scenario,
                    hasDistrict: filterResult.filterDetails?.hasDistrict,
                    hasKeyword: filterResult.filterDetails?.hasKeyword
                });

                return {
                    success: true,
                    messageId,
                    normalizedMessage,
                    filtered: true,
                    filterResult,
                    reason: 'filtered_out'
                };
            }

            // Message passed filter - proceed with database storage
            this.metrics.savedMessages++;
            logger.info('Message passed filter - proceeding with database storage', {
                messageId,
                scenario: filterResult.scenario,
                districtMatches: filterResult.filterDetails?.districtMatches?.length || 0,
                keywordMatches: filterResult.filterDetails?.keywordMatches?.length || 0
            });

            // Process and store message in database if database service is available
            let storageResult = null;
            if (this.databaseService) {
                try {
                    storageResult = await this.storeMessageInDatabase(
                        messageData,
                        normalizedMessage.groupInfo,
                        normalizedMessage.userInfo
                    );

                    if (storageResult.success) {
                        logger.info('Message stored in database successfully', {
                            messageId,
                            postBankId: storageResult.postBankId,
                            groupId: storageResult.groupId
                        });
                    } else {
                        logger.warn('Message storage failed', {
                            messageId,
                            reason: storageResult.reason,
                            error: storageResult.error
                        });
                    }
                } catch (storageError) {
                    logger.error('Database storage error', {
                        messageId,
                        error: storageError.message,
                        stack: storageError.stack
                    });
                    storageResult = { success: false, error: storageError.message };
                }
            } else {
                logger.debug('Database service not available, skipping storage', { messageId });
            }

            // Update metrics
            this.metrics.groupMessagesProcessed++;
            if (normalizedMessage.hasMedia) {
                this.metrics.mediaMessagesProcessed++;
            }

            const processingTime = Date.now() - startTime;
            logger.info('Group message processed successfully', {
                messageId,
                groupId: normalizedMessage.groupInfo.groupId,
                groupName: normalizedMessage.groupInfo.groupName,
                messageType: normalizedMessage.messageType,
                hasMedia: normalizedMessage.hasMedia,
                stored: storageResult?.success || false,
                processingTime: `${processingTime}ms`,
                metadata
            });

            return {
                success: true,
                messageId,
                normalizedMessage,
                storageResult,
                processingTime
            };

        } catch (error) {
            this.metrics.processingErrors++;
            const processingTime = Date.now() - startTime;

            logger.error('Group message processing error', {
                error: error.message,
                stack: error.stack,
                messageId: messageData.key?.id,
                remoteJid: messageData.key?.remoteJid,
                processingTime: `${processingTime}ms`,
                metadata
            });

            return {
                success: false,
                error: error.message,
                messageId: messageData.key?.id,
                processingTime
            };
        }
    }

    /**
     * Validate message structure from Wasender API
     * @param {Object} messageData - Raw message data
     * @returns {boolean} True if valid structure
     */
    isValidMessageStructure(messageData) {
        if (!messageData || typeof messageData !== 'object') {
            return false;
        }

        // Check for required key structure
        if (!messageData.key || !messageData.key.id || !messageData.key.remoteJid) {
            return false;
        }

        // Check for message content or timestamp
        if (!messageData.message && !messageData.messageTimestamp) {
            return false;
        }

        return true;
    }

    /**
     * Check if message is from a WhatsApp group
     * Group messages have JID format: groupId@g.us
     * Personal messages have JID format: phoneNumber@s.whatsapp.net
     * @param {string} remoteJid - The JID from message key
     * @returns {boolean} True if group message
     */
    isGroupMessage(remoteJid) {
        if (!remoteJid || typeof remoteJid !== 'string') {
            return false;
        }

        // Group messages end with @g.us
        return remoteJid.endsWith('@g.us');
    }

    /**
     * Check if message has already been processed
     * @param {string} messageId - Unique message ID
     * @returns {boolean} True if duplicate
     */
    isDuplicateMessage(messageId) {
        if (!messageId) {
            return false;
        }

        return this.processedMessages.has(messageId);
    }

    /**
     * Extract and normalize message data for database storage
     * @param {Object} messageData - Raw message data from Wasender API
     * @param {Object} metadata - Additional metadata
     * @returns {Promise<Object>} Normalized message object
     */
    async extractAndNormalizeMessage(messageData, metadata = {}) {
        try {
            // Extract basic message information
            const messageKey = messageData.key;
            const messageContent = messageData.message || {};
            const messageTimestamp = messageData.messageTimestamp;

            // Extract group information
            const groupInfo = await this.extractGroupInfo(messageKey, messageData, metadata);

            // Extract user information (pass group info for @lid resolution)
            const userInfo = await this.extractUserInfo(messageKey, messageData, metadata, groupInfo);

            // Extract message content and type
            const contentInfo = this.extractMessageContent(messageContent);

            // Extract media information if present
            const mediaInfo = this.extractMediaInfo(messageContent);

            // Extract reply information if present
            const replyInfo = this.extractReplyInfo(messageContent);

            // Create normalized message object
            const normalizedMessage = {
                // Message identification
                messageId: messageKey.id,
                timestamp: new Date(messageTimestamp * 1000), // Convert from Unix timestamp

                // Group information
                groupInfo,

                // User information
                userInfo,

                // Message content
                messageType: contentInfo.type,
                messageText: contentInfo.text,
                hasMedia: mediaInfo.hasMedia,

                // Media information
                mediaInfo,

                // Reply information
                replyInfo,

                // WhatsApp specific fields
                whatsappData: {
                    key: messageKey,
                    pushName: messageData.pushName,
                    messageTimestamp: messageTimestamp,
                    fromMe: messageKey.fromMe || false,
                    participant: messageKey.participant
                },

                // Processing metadata
                processingMetadata: {
                    processedAt: new Date(),
                    source: 'wasender-api',
                    webhookMetadata: metadata
                }
            };

            logger.debug('Message data extracted and normalized', {
                messageId: normalizedMessage.messageId,
                messageType: normalizedMessage.messageType,
                groupId: normalizedMessage.groupInfo.groupId,
                hasMedia: normalizedMessage.hasMedia,
                hasReply: !!normalizedMessage.replyInfo.isReply
            });

            return normalizedMessage;

        } catch (error) {
            logger.error('Message normalization error', {
                error: error.message,
                messageId: messageData.key?.id,
                metadata
            });
            throw error;
        }
    }

    /**
     * Extract group information from message
     * @param {Object} messageKey - Message key object
     * @param {Object} messageData - Full message data
     * @param {Object} metadata - Processing metadata
     * @returns {Promise<Object>} Group information
     */
    async extractGroupInfo(messageKey, messageData, metadata = {}) {
        const groupId = messageKey.remoteJid;

        // Check cache first
        if (this.groupCache.has(groupId)) {
            const cachedGroup = this.groupCache.get(groupId);
            logger.debug('Group info retrieved from cache', {
                groupId,
                groupName: cachedGroup.groupName
            });
            return cachedGroup;
        }

        // Extract group information and wait for API call to complete
        const groupName = await this.resolveGroupName(messageData, groupId);

        // Get the cached group data (which now includes participant mapping from API call)
        const cachedGroupData = this.groupCache.get(groupId);

        const groupInfo = {
            groupId: groupId,
            groupName: groupName,
            groupJid: groupId,
            isGroup: true,
            // Include participant mapping if available
            participantMapping: cachedGroupData ? cachedGroupData.participantMapping : {},
            size: cachedGroupData ? cachedGroupData.size : 0
        };

        // Update cache with complete group information
        this.groupCache.set(groupId, groupInfo);

        logger.debug('Group info extracted and cached', {
            groupId: groupInfo.groupId,
            groupName: groupInfo.groupName
        });

        return groupInfo;
    }

    /**
     * Extract group name from message data
     * @param {Object} messageData - Full message data
     * @returns {string|null} Group name if available
     */
    extractGroupName(messageData) {
        // Group name might be available in different places depending on Wasender API response
        // This is a placeholder - actual implementation depends on Wasender API structure

        // Check common locations for group name
        if (messageData.groupMetadata && messageData.groupMetadata.subject) {
            return messageData.groupMetadata.subject;
        }

        if (messageData.chat && messageData.chat.name) {
            return messageData.chat.name;
        }

        // If no group name found, return null
        // The group ID will be used as fallback
        return null;
    }

    /**
     * Format group ID as a readable name
     * @param {string} groupId - Group ID
     * @returns {string} Formatted group name
     */
    formatGroupIdAsName(groupId) {
        if (!groupId) return 'Unknown Group';

        // Extract timestamp from group ID if possible
        const timestampMatch = groupId.match(/^(\d+)-/);
        if (timestampMatch) {
            const timestamp = parseInt(timestampMatch[1]);
            const date = new Date(timestamp * 1000);
            return `Group (${date.toLocaleDateString()})`;
        }

        // Fallback to shortened ID
        return `Group ${groupId.substring(0, 8)}...`;
    }

    /**
     * Extract participant count from message data
     * @param {Object} messageData - Message data
     * @returns {number|null} Participant count
     */
    extractParticipantCount(messageData) {
        if (messageData.groupMetadata && messageData.groupMetadata.participants) {
            return messageData.groupMetadata.participants.length;
        }
        return null;
    }

    /**
     * Resolve group name with enhanced fallback strategy
     * @param {Object} messageData - Message data
     * @param {string} groupId - Group JID
     * @returns {Promise<string>} Resolved group name
     */
    async resolveGroupName(messageData, groupId) {
        // Try message data first
        let groupName = this.extractGroupName(messageData);
        if (groupName && groupName !== groupId) {
            logger.info('Group name found in message data', {
                groupId: groupId.substring(0, 20) + '...',
                groupName
            });
            return groupName;
        }

        // Try API fetch if WasenderClient is available
        if (this.wasenderClient) {
            try {
                logger.info('Attempting to fetch group name from Wasender API', {
                    groupId: groupId.substring(0, 20) + '...'
                });
                const fetchedName = await this.fetchGroupName(groupId);
                if (fetchedName) {
                    logger.info('Group name fetched successfully from API', {
                        groupId: groupId.substring(0, 20) + '...',
                        groupName: fetchedName
                    });
                    return fetchedName;
                }
            } catch (error) {
                logger.warn('API group name fetch failed', {
                    groupId: groupId.substring(0, 20) + '...',
                    error: error.message,
                    errorType: error.name
                });
            }
        } else {
            // Log that WasenderClient is not available with actionable information
            logger.warn('WasenderClient not available for group name fetch', {
                groupId: groupId.substring(0, 20) + '...',
                solution: 'Initialize WasenderClient in main application and pass to GroupMessageMonitor constructor'
            });
        }

        // Additional fallback: Try to retrieve from database if available
        if (this.databaseService) {
            try {
                logger.debug('Attempting to fetch group name from database', {
                    groupId: groupId.substring(0, 20) + '...'
                });

                // Try to get group info from database
                const dbGroupInfo = await this.databaseService.getGroupByJid?.(groupId);
                if (dbGroupInfo && dbGroupInfo.name && dbGroupInfo.name !== groupId) {
                    logger.info('Group name found in database', {
                        groupId: groupId.substring(0, 20) + '...',
                        groupName: dbGroupInfo.name
                    });
                    return dbGroupInfo.name;
                }
            } catch (dbError) {
                logger.debug('Database lookup for group name failed', {
                    groupId: groupId.substring(0, 20) + '...',
                    error: dbError.message
                });
            }
        }

        // Fallback to formatted ID with better formatting
        const formattedName = this.formatGroupIdAsName(groupId);
        logger.debug('Using formatted ID as group name fallback', {
            groupId: groupId.substring(0, 20) + '...',
            formattedName
        });

        return formattedName;
    }

    /**
     * Fetch group name from Wasender API using group JID
     * @param {string} groupJid - Group JID (e.g., 120363407648087275@g.us)
     * @returns {Promise<string|null>} Group name or null if failed
     */
    async fetchGroupName(groupJid) {
        try {
            // Check cache first - avoid unnecessary API calls
            if (this.groupCache.has(groupJid)) {
                const cachedData = this.groupCache.get(groupJid);
                if (cachedData.name && cachedData.name !== groupJid) {
                    logger.debug('Group name retrieved from cache (avoiding API call)', {
                        groupJid: groupJid.substring(0, 20) + '...',
                        groupName: cachedData.name,
                        cacheAge: new Date() - cachedData.fetchedAt
                    });
                    return cachedData.name;
                }
            }

            // Fetch from Wasender API if not in cache
            if (!this.wasenderClient) {
                logger.warn('WasenderClient not available for group name fetch', { groupJid });
                return null;
            }

            logger.info('Fetching group metadata from Wasender API', {
                groupJid: groupJid.substring(0, 20) + '...'
            });

            // Call Wasender API to get group metadata
            const response = await this.wasenderClient.client.get(`/api/groups/${groupJid}/metadata`);

            if (response.data && response.data.success && response.data.data) {
                const groupData = response.data.data;
                const groupName = groupData.subject || groupData.name;

                if (groupName) {
                    logger.info('Group name fetched successfully', {
                        groupJid: groupJid.substring(0, 20) + '...',
                        groupName,
                        participantCount: groupData.size || 0
                    });

                    // Extract participant mapping for @lid resolution
                    const participantMapping = {};
                    if (groupData.participants && Array.isArray(groupData.participants)) {
                        logger.info('Processing participants for mapping', {
                            participantCount: groupData.participants.length,
                            participants: groupData.participants.map(p => ({
                                id: p.id,
                                lid: p.lid,
                                jid: p.jid
                            }))
                        });

                        groupData.participants.forEach(participant => {
                            if (participant.lid && participant.jid) {
                                participantMapping[participant.lid] = participant.jid;
                                logger.info('Participant mapping cached', {
                                    lid: participant.lid,
                                    realJid: participant.jid
                                });
                            }
                        });
                    }

                    logger.info('Final participant mapping created', {
                        mappingSize: Object.keys(participantMapping).length,
                        mappingKeys: Object.keys(participantMapping)
                    });

                    // Update cache with enhanced data
                    const cacheData = {
                        name: groupName,
                        subject: groupName,
                        groupId: groupJid,
                        size: groupData.size || 0,
                        participantMapping: participantMapping,
                        fetchedAt: new Date(),
                        lastUpdated: new Date()
                    };

                    this.groupCache.set(groupJid, cacheData);

                    logger.info('Group metadata cached with participant mapping', {
                        groupJid: groupJid.substring(0, 20) + '...',
                        groupName,
                        participantCount: Object.keys(participantMapping).length
                    });

                    return groupName;
                }
            }

            logger.warn('No group name found in API response', { groupJid });
            return null;

        } catch (error) {
            logger.error('Error fetching group metadata from Wasender API', {
                groupJid: groupJid?.substring(0, 20) + '...',
                error: error.message,
                status: error.response?.status
            });
            return null;
        }
    }

    /**
     * Resolve @lid to real JID using cached group participant mapping
     * @param {string} lidJid - LID format JID (e.g., 17222953082901@lid)
     * @param {string} groupJid - Group JID to check for participant mapping
     * @param {Object} groupInfo - Group info object with participant mapping (optional)
     * @returns {string|null} Real JID if found, null otherwise
     */
    resolveLidToRealJid(lidJid, groupJid, groupInfo = null) {
        if (!lidJid.endsWith('@lid') || !groupJid) {
            return null;
        }

        // First check if groupInfo has participant mapping (most recent)
        if (groupInfo && groupInfo.participantMapping) {
            const realJid = groupInfo.participantMapping[lidJid];
            if (realJid) {
                logger.info('LID resolved to real JID (from groupInfo)', {
                    lidJid: lidJid.substring(0, 15) + '...',
                    realJid: realJid.substring(0, 15) + '...'
                });
                return realJid;
            }
        }

        // Fallback: Check cached group data with participant mapping
        const groupData = this.groupCache.get(groupJid);
        if (groupData && groupData.participantMapping) {
            const realJid = groupData.participantMapping[lidJid];
            if (realJid) {
                logger.info('LID resolved to real JID (from cache)', {
                    lidJid: lidJid.substring(0, 15) + '...',
                    realJid: realJid.substring(0, 15) + '...'
                });
                return realJid;
            }
        }

        logger.debug('Could not resolve LID to real JID', {
            lidJid: lidJid.substring(0, 15) + '...',
            groupJid: groupJid.substring(0, 20) + '...',
            hasCachedData: !!groupData,
            hasParticipantMapping: !!(groupData && groupData.participantMapping),
            participantMappingKeys: groupData && groupData.participantMapping ? Object.keys(groupData.participantMapping) : [],
            participantMappingSize: groupData && groupData.participantMapping ? Object.keys(groupData.participantMapping).length : 0
        });

        return null;
    }

    /**
     * Format phone number from JID to Indian international format
     * Handles both regular JIDs and WhatsApp's new @lid privacy format
     * @param {string} jid - WhatsApp JID (e.g., 919876543210@s.whatsapp.net or 17222953082901@lid)
     * @param {string} groupJid - Group JID for @lid resolution (optional)
     * @param {Object} groupInfo - Group info object with participant mapping (optional)
     * @returns {string} Formatted Indian phone number
     */
    formatPhoneNumberFromJid(jid, groupJid = null, groupInfo = null) {
        if (!jid || typeof jid !== 'string') {
            return '';
        }

        logger.debug('Processing JID for phone number formatting', {
            originalJid: jid.substring(0, 30) + '...',
            jidType: jid.includes('@lid') ? 'privacy_lid' : 'regular'
        });

        // Special handling for @lid format (WhatsApp privacy-protected IDs in groups)
        if (jid.endsWith('@lid')) {
            const lidId = jid.split('@')[0];

            logger.info('Processing @lid format (WhatsApp privacy ID)', {
                lidId: lidId.substring(0, 10) + '...',
                fullLength: lidId.length
            });

            // Try to resolve LID to real JID using group participant mapping
            if (groupJid) {
                const realJid = this.resolveLidToRealJid(jid, groupJid, groupInfo);
                if (realJid) {
                    logger.info('LID resolved to real JID, formatting real phone number', {
                        lidId: lidId.substring(0, 10) + '...',
                        realJid: realJid.substring(0, 15) + '...'
                    });
                    // Recursively format the real JID
                    const realFormatted = this.formatPhoneNumberFromJid(realJid);
                    return realFormatted;
                }
            }

            // Fallback: Check if the LID might contain an Indian number pattern
            if (lidId.startsWith('91') && lidId.length >= 12) {
                // Try to format as Indian number, but mark as LID-derived
                const possibleNumber = lidId.substring(2, 12); // Extract 10 digits after 91
                if (this.isValidIndianMobileNumber('91' + possibleNumber)) {
                    const formatted = '+91 ' + possibleNumber.substring(0, 5) + ' ' + possibleNumber.substring(5);
                    logger.info('LID contains valid Indian number pattern', {
                        lidId: lidId.substring(0, 10) + '...',
                        formattedNumber: formatted + ' [LID]'
                    });
                    return formatted + ' [LID]';
                }
            }

            // For non-Indian or unrecognizable LID patterns
            logger.warn('LID format detected but cannot extract Indian number', {
                lidId: lidId.substring(0, 10) + '...'
            });
            return `[WhatsApp User ${lidId.substring(0, 8)}...]`;
        }

        // Regular phone number handling for standard JID format
        const phoneMatch = jid.match(/^(\d+)@/);
        if (!phoneMatch) {
            logger.warn('Could not extract phone number from JID', { jid: jid.substring(0, 20) + '...' });
            return jid;
        }

        let phoneNumber = phoneMatch[1];

        // Handle Indian phone numbers specifically
        if (phoneNumber.length >= 10) {
            // Check if it already has country code
            if (phoneNumber.startsWith('91') && phoneNumber.length === 12) {
                // Format: 919876543210 -> +91 98765 43210
                phoneNumber = '+91 ' + phoneNumber.substring(2, 7) + ' ' + phoneNumber.substring(7);
            } else if (phoneNumber.startsWith('91') && phoneNumber.length === 13) {
                // Format: 9198765432100 -> +91 98765 43210 (remove extra digit if present)
                phoneNumber = '+91 ' + phoneNumber.substring(2, 7) + ' ' + phoneNumber.substring(7, 12);
            } else if (phoneNumber.length === 10 && phoneNumber.match(/^[6-9]/)) {
                // Format: 9876543210 -> +91 98765 43210 (add country code for valid Indian numbers)
                phoneNumber = '+91 ' + phoneNumber.substring(0, 5) + ' ' + phoneNumber.substring(5);
            } else if (phoneNumber.length === 11 && phoneNumber.startsWith('0')) {
                // Format: 09876543210 -> +91 98765 43210 (remove leading 0, add country code)
                const withoutZero = phoneNumber.substring(1);
                if (withoutZero.match(/^[6-9]/)) {
                    phoneNumber = '+91 ' + withoutZero.substring(0, 5) + ' ' + withoutZero.substring(5);
                } else {
                    phoneNumber = '+' + phoneNumber; // Keep as-is if not Indian pattern
                }
            } else {
                // For any other format, add + and basic formatting
                phoneNumber = '+' + phoneNumber;

                // Apply generic formatting for readability
                if (phoneNumber.length === 13 && phoneNumber.startsWith('+91')) {
                    phoneNumber = phoneNumber.replace(/(\+91)(\d{5})(\d{5})/, '$1 $2 $3');
                } else if (phoneNumber.length === 12) { // +1XXXXXXXXXX format (fallback)
                    phoneNumber = phoneNumber.replace(/(\+\d{1})(\d{3})(\d{3})(\d{4})/, '$1 $2 $3 $4');
                }
            }
        } else {
            // For shorter numbers, just add + prefix
            phoneNumber = '+' + phoneNumber;
        }

        logger.debug('Phone number formatted for India', {
            originalJid: jid.substring(0, 20) + '...',
            formattedNumber: phoneNumber,
            isValidIndian: this.isValidIndianMobileNumber(phoneNumber)
        });

        return phoneNumber;
    }

    /**
     * Extract user information from message with comprehensive data extraction
     * Implements enhanced user data extraction from WhatsApp message metadata
     * Includes profile updates when new information is available
     * @param {Object} messageKey - Message key object
     * @param {Object} messageData - Full message data
     * @param {Object} metadata - Processing metadata
     * @param {Object} groupInfo - Group information for @lid resolution (optional)
     * @returns {Promise<Object>} User information
     */
    async extractUserInfo(messageKey, messageData, metadata = {}, groupInfo = null) {
        // For group messages, the sender is in the participant field
        const senderId = messageKey.participant || messageKey.remoteJid;

        // Extract comprehensive user information from message metadata
        const extractedUserInfo = this.extractComprehensiveUserData(messageKey, messageData, metadata, groupInfo);

        // Check cache for existing user data - avoid unnecessary processing
        const cachedUser = this.userCache.get(senderId);

        // Determine if user information has been updated
        const hasUpdatedInfo = this.hasUserInfoUpdated(cachedUser, extractedUserInfo);

        if (cachedUser && !hasUpdatedInfo) {
            logger.debug('User info retrieved from cache (avoiding reprocessing)', {
                senderId: senderId.substring(0, 15) + '...',
                displayName: cachedUser.displayName,
                phoneNumber: cachedUser.phoneNumber,
                cacheAge: new Date() - cachedUser.extractedAt
            });
            return cachedUser;
        }

        // Merge cached data with new information (prioritize new data)
        const mergedUserInfo = this.mergeUserInformation(cachedUser, extractedUserInfo);

        // Cache updated user information
        this.userCache.set(senderId, mergedUserInfo);

        if (hasUpdatedInfo) {
            logger.info('User info updated with new data', {
                userId: mergedUserInfo.userId,
                displayName: mergedUserInfo.displayName,
                phoneNumber: mergedUserInfo.phoneNumber,
                updatedFields: this.getUpdatedFields(cachedUser, extractedUserInfo)
            });
        } else {
            logger.debug('User info extracted and cached', {
                userId: mergedUserInfo.userId,
                displayName: mergedUserInfo.displayName,
                phoneNumber: mergedUserInfo.phoneNumber
            });
        }

        return mergedUserInfo;
    }

    /**
     * Extract comprehensive user data from WhatsApp message metadata
     * @param {Object} messageKey - Message key object
     * @param {Object} messageData - Full message data
     * @param {Object} metadata - Processing metadata
     * @param {Object} groupInfo - Group information for @lid resolution (optional)
     * @returns {Object} Comprehensive user information
     */
    extractComprehensiveUserData(messageKey, messageData, metadata = {}, groupInfo = null) {
        let senderId = messageKey.participant || messageKey.remoteJid;
        const groupJid = groupInfo ? groupInfo.groupId : null;

        // CRITICAL FIX: If senderId is LID format, resolve to JID first
        // LID: 221856636362974@lid (privacy ID - no phone number)
        // JID: 917275147094@s.whatsapp.net (contains actual phone number)
        if (senderId && senderId.endsWith('@lid') && groupJid) {
            const realJid = this.resolveLidToRealJid(senderId, groupJid, groupInfo);
            if (realJid) {
                logger.info('Resolved LID to JID for phone extraction', {
                    lid: senderId.substring(0, 15) + '...',
                    jid: realJid.substring(0, 15) + '...'
                });
                senderId = realJid; // Use JID which contains the actual phone number
            } else {
                logger.warn('Could not resolve LID to JID - using fallback', {
                    lid: senderId.substring(0, 15) + '...',
                    groupJid: groupJid.substring(0, 20) + '...'
                });
            }
        }

        // Use Wasender's pre-cleaned phone number fields if available correctly
        let phoneNumber = null;
        if (messageData.key?.cleanedParticipantPn) {
            phoneNumber = messageData.key.cleanedParticipantPn;
            logger.info('Used cleanedParticipantPn from Wasender webhook', { phoneNumber: phoneNumber.substring(0, 5) + '...' });
        } else if (messageData.key?.cleanedSenderPn) {
            phoneNumber = messageData.key.cleanedSenderPn;
            logger.info('Used cleanedSenderPn from Wasender webhook', { phoneNumber: phoneNumber.substring(0, 5) + '...' });
        } else {
            // Fallback
            phoneNumber = this.extractPhoneNumber(senderId, groupJid, groupInfo);
            logger.info('Fell back to extracting phone from JID', { phoneNumber: phoneNumber?.substring(0, 5) + '...' });
        }

        // Extract display name from multiple possible sources
        const displayName = this.extractDisplayName(messageData, senderId);

        // Extract business account information
        const businessInfo = this.extractBusinessInfo(messageData, metadata);

        // Extract profile information
        const profileInfo = this.extractProfileInfo(messageData, metadata);

        // Extract device and client information
        const deviceInfo = this.extractDeviceInfo(messageData, metadata);

        // Indian-specific mobile information
        const mobileOperator = this.getIndianMobileOperator(phoneNumber);
        const isValidIndianNumber = this.isValidIndianMobileNumber(phoneNumber);

        // Create comprehensive user information object
        const userInfo = {
            // Core identification
            userId: senderId,
            jid: senderId,
            phoneNumber: phoneNumber,
            displayName: displayName,
            platform: 'whatsapp',
            platformUserId: senderId,

            // Message context
            isFromMe: messageKey.fromMe || false,
            pushName: messageData.pushName || null,

            // Business account information
            isBusiness: businessInfo.isBusiness,
            businessName: businessInfo.businessName,
            businessCategory: businessInfo.businessCategory,

            // Profile information
            profileImageUrl: profileInfo.profileImageUrl,
            status: profileInfo.status,

            // Device and client information
            deviceType: deviceInfo.deviceType,
            clientVersion: deviceInfo.clientVersion,

            // Indian-specific mobile information
            mobileOperator: mobileOperator,
            isValidIndianNumber: isValidIndianNumber,
            country: 'India',
            countryCode: '+91',

            // Metadata
            lastMessageTimestamp: new Date(messageData.messageTimestamp * 1000),
            extractedAt: new Date(),

            // Additional WhatsApp specific fields
            verifiedName: this.extractVerifiedName(messageData),
            isContact: this.isUserInContacts(senderId, metadata),

            // Message statistics (will be updated by database service)
            messageCount: 1,
            firstSeen: new Date(),
            lastSeen: new Date()
        };

        return userInfo;
    }

    /**
     * Extract display name from multiple possible sources in message data
     * @param {Object} messageData - Full message data
     * @param {string} senderId - Sender ID for fallback
     * @returns {string} Display name
     */
    extractDisplayName(messageData, senderId) {
        // Priority order for display name extraction:
        // 1. pushName (most reliable)
        // 2. verifiedName (for business accounts)
        // 3. notify (notification name)
        // 4. Phone number as fallback

        if (messageData.pushName && messageData.pushName.trim()) {
            return messageData.pushName.trim();
        }

        if (messageData.verifiedName && messageData.verifiedName.trim()) {
            return messageData.verifiedName.trim();
        }

        if (messageData.notify && messageData.notify.trim()) {
            return messageData.notify.trim();
        }

        // Fallback to phone number
        return this.extractPhoneNumber(senderId);
    }

    /**
     * Extract business account information from message data
     * @param {Object} messageData - Full message data
     * @param {Object} metadata - Processing metadata
     * @returns {Object} Business information
     */
    extractBusinessInfo(messageData, metadata = {}) {
        const businessInfo = {
            isBusiness: false,
            businessName: null,
            businessCategory: null
        };

        // Check for business account indicators
        if (messageData.verifiedName) {
            businessInfo.isBusiness = true;
            businessInfo.businessName = messageData.verifiedName;
        }

        // Check for business category in metadata
        if (metadata.businessCategory) {
            businessInfo.businessCategory = metadata.businessCategory;
        }

        // Additional business indicators
        if (messageData.businessProfile) {
            businessInfo.isBusiness = true;
            businessInfo.businessName = messageData.businessProfile.name || businessInfo.businessName;
            businessInfo.businessCategory = messageData.businessProfile.category || businessInfo.businessCategory;
        }

        return businessInfo;
    }

    /**
     * Extract profile information from message data
     * @param {Object} messageData - Full message data
     * @param {Object} metadata - Processing metadata
     * @returns {Object} Profile information
     */
    extractProfileInfo(messageData, metadata = {}) {
        const profileInfo = {
            profileImageUrl: null,
            status: null
        };

        // Extract profile picture URL if available
        if (messageData.profilePicture) {
            profileInfo.profileImageUrl = messageData.profilePicture;
        }

        // Extract status if available
        if (messageData.status) {
            profileInfo.status = messageData.status;
        }

        // Check metadata for additional profile information
        if (metadata.profileInfo) {
            profileInfo.profileImageUrl = metadata.profileInfo.profileImageUrl || profileInfo.profileImageUrl;
            profileInfo.status = metadata.profileInfo.status || profileInfo.status;
        }

        return profileInfo;
    }

    /**
     * Extract device and client information from message data
     * @param {Object} messageData - Full message data
     * @param {Object} metadata - Processing metadata
     * @returns {Object} Device information
     */
    extractDeviceInfo(messageData, metadata = {}) {
        const deviceInfo = {
            deviceType: null,
            clientVersion: null
        };

        // Extract device type from message metadata
        if (messageData.deviceType) {
            deviceInfo.deviceType = messageData.deviceType;
        }

        // Extract client version
        if (messageData.clientVersion) {
            deviceInfo.clientVersion = messageData.clientVersion;
        }

        // Check for device info in metadata
        if (metadata.deviceInfo) {
            deviceInfo.deviceType = metadata.deviceInfo.deviceType || deviceInfo.deviceType;
            deviceInfo.clientVersion = metadata.deviceInfo.clientVersion || deviceInfo.clientVersion;
        }

        return deviceInfo;
    }

    /**
     * Extract verified name for business accounts
     * @param {Object} messageData - Full message data
     * @returns {string|null} Verified name
     */
    extractVerifiedName(messageData) {
        return messageData.verifiedName || null;
    }

    /**
     * Check if user is in contacts
     * @param {string} senderId - Sender ID
     * @param {Object} metadata - Processing metadata
     * @returns {boolean} True if user is in contacts
     */
    isUserInContacts(senderId, metadata = {}) {
        // This would typically check against a contacts list
        // For now, return false as default
        return metadata.isContact || false;
    }

    /**
     * Check if user information has been updated compared to cached data
     * @param {Object} cachedUser - Previously cached user data
     * @param {Object} newUserInfo - Newly extracted user information
     * @returns {boolean} True if user information has updates
     */
    hasUserInfoUpdated(cachedUser, newUserInfo) {
        if (!cachedUser) {
            return true; // New user
        }

        // Check for updates in key fields
        const fieldsToCheck = [
            'displayName',
            'pushName',
            'isBusiness',
            'businessName',
            'profileImageUrl',
            'status',
            'verifiedName'
        ];

        for (const field of fieldsToCheck) {
            if (cachedUser[field] !== newUserInfo[field]) {
                // Only consider it an update if the new value is not null/empty
                if (newUserInfo[field] && newUserInfo[field] !== '') {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Merge cached user information with newly extracted data
     * @param {Object} cachedUser - Previously cached user data
     * @param {Object} newUserInfo - Newly extracted user information
     * @returns {Object} Merged user information
     */
    mergeUserInformation(cachedUser, newUserInfo) {
        if (!cachedUser) {
            return newUserInfo;
        }

        // Merge data, prioritizing non-null new values
        const mergedInfo = { ...cachedUser };

        // Update fields with new non-null values
        Object.keys(newUserInfo).forEach(key => {
            if (newUserInfo[key] !== null && newUserInfo[key] !== undefined && newUserInfo[key] !== '') {
                mergedInfo[key] = newUserInfo[key];
            }
        });

        // Always update timestamps
        mergedInfo.lastMessageTimestamp = newUserInfo.lastMessageTimestamp;
        mergedInfo.lastSeen = newUserInfo.lastSeen;
        mergedInfo.messageCount = (cachedUser.messageCount || 0) + 1;

        return mergedInfo;
    }

    /**
     * Get list of fields that were updated
     * @param {Object} cachedUser - Previously cached user data
     * @param {Object} newUserInfo - Newly extracted user information
     * @returns {Array} List of updated field names
     */
    getUpdatedFields(cachedUser, newUserInfo) {
        if (!cachedUser) {
            return ['new_user'];
        }

        const updatedFields = [];
        const fieldsToCheck = [
            'displayName',
            'pushName',
            'isBusiness',
            'businessName',
            'profileImageUrl',
            'status',
            'verifiedName'
        ];

        for (const field of fieldsToCheck) {
            if (cachedUser[field] !== newUserInfo[field] && newUserInfo[field]) {
                updatedFields.push(field);
            }
        }

        return updatedFields;
    }

    /**
     * Extract phone number from WhatsApp JID
     * @param {string} jid - WhatsApp JID (e.g., "919876543210@s.whatsapp.net")
     * @param {string} groupJid - Group JID for @lid resolution (optional)
     * @param {Object} groupInfo - Group info object with participant mapping (optional)
     * @returns {string} Formatted Indian phone number
     */
    extractPhoneNumber(jid, groupJid = null, groupInfo = null) {
        // Use the enhanced Indian formatting method with group context
        return this.formatPhoneNumberFromJid(jid, groupJid, groupInfo);
    }

    /**
     * Validate if a phone number is a valid Indian mobile number
     * @param {string} phoneNumber - Phone number to validate
     * @returns {boolean} True if valid Indian mobile number
     */
    isValidIndianMobileNumber(phoneNumber) {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            return false;
        }

        // Remove all non-digit characters for validation
        const digitsOnly = phoneNumber.replace(/\D/g, '');

        // Valid Indian mobile number patterns:
        // 1. 10 digits starting with 6,7,8,9 (without country code)
        // 2. 12 digits starting with 91 followed by 6,7,8,9
        if (digitsOnly.length === 10) {
            return /^[6-9]\d{9}$/.test(digitsOnly);
        } else if (digitsOnly.length === 12) {
            return /^91[6-9]\d{9}$/.test(digitsOnly);
        }

        return false;
    }

    /**
     * Get Indian mobile operator from phone number
     * @param {string} phoneNumber - Formatted phone number
     * @returns {string|null} Mobile operator name or null
     */
    getIndianMobileOperator(phoneNumber) {
        if (!phoneNumber || typeof phoneNumber !== 'string') {
            return null;
        }

        // Extract digits only
        const digitsOnly = phoneNumber.replace(/\D/g, '');
        let mobileNumber = digitsOnly;

        // Remove country code if present
        if (mobileNumber.startsWith('91') && mobileNumber.length === 12) {
            mobileNumber = mobileNumber.substring(2);
        }

        if (mobileNumber.length !== 10) {
            return null;
        }

        // Indian mobile operator prefixes (simplified mapping)
        const operatorPrefixes = {
            // Airtel
            '70': 'Airtel', '71': 'Airtel', '72': 'Airtel', '73': 'Airtel', '74': 'Airtel',
            '75': 'Airtel', '76': 'Airtel', '77': 'Airtel', '78': 'Airtel', '79': 'Airtel',
            '80': 'Airtel', '81': 'Airtel', '82': 'Airtel', '83': 'Airtel', '84': 'Airtel',

            // Jio
            '60': 'Jio', '61': 'Jio', '62': 'Jio', '63': 'Jio', '88': 'Jio', '89': 'Jio',

            // Vi (Vodafone Idea)
            '90': 'Vi', '91': 'Vi', '92': 'Vi', '93': 'Vi', '94': 'Vi', '95': 'Vi',
            '96': 'Vi', '97': 'Vi', '98': 'Vi', '99': 'Vi',

            // BSNL
            '64': 'BSNL', '65': 'BSNL', '66': 'BSNL', '67': 'BSNL', '68': 'BSNL', '69': 'BSNL'
        };

        const prefix = mobileNumber.substring(0, 2);
        return operatorPrefixes[prefix] || 'Unknown';
    }

    /**
     * Extract message content and determine message type
     * @param {Object} messageContent - Message content object
     * @returns {Object} Content information
     */
    extractMessageContent(messageContent) {
        if (!messageContent || typeof messageContent !== 'object') {
            return {
                type: 'unknown',
                text: '',
                hasContent: false
            };
        }

        // Determine message type and extract text content
        let messageType = 'text';
        let messageText = '';

        // Check for different message types
        if (messageContent.conversation) {
            messageType = 'text';
            messageText = messageContent.conversation;
        } else if (messageContent.extendedTextMessage) {
            messageType = 'text';
            messageText = messageContent.extendedTextMessage.text || '';
        } else if (messageContent.imageMessage) {
            messageType = 'image';
            messageText = messageContent.imageMessage.caption || '';
        } else if (messageContent.videoMessage) {
            messageType = 'video';
            messageText = messageContent.videoMessage.caption || '';
        } else if (messageContent.audioMessage) {
            messageType = 'audio';
            messageText = ''; // Audio messages typically don't have text
        } else if (messageContent.documentMessage) {
            messageType = 'document';
            messageText = messageContent.documentMessage.caption || '';
        } else if (messageContent.stickerMessage) {
            messageType = 'sticker';
            messageText = ''; // Stickers don't have text
        } else if (messageContent.locationMessage) {
            messageType = 'location';
            messageText = 'Location shared';
        } else if (messageContent.contactMessage) {
            messageType = 'contact';
            messageText = 'Contact shared';
        } else {
            // Unknown message type
            messageType = 'unknown';
            messageText = JSON.stringify(messageContent).substring(0, 100);
        }

        return {
            type: messageType,
            text: messageText || '',
            hasContent: !!messageText,
            rawContent: messageContent
        };
    }

    /**
     * Extract media information from message content
     * @param {Object} messageContent - Message content object
     * @returns {Object} Media information
     */
    extractMediaInfo(messageContent) {
        const mediaInfo = {
            hasMedia: false,
            mediaType: null,
            mediaUrl: null,
            mediaKey: null,
            mimetype: null,
            fileSize: null,
            fileName: null,
            fileSha256: null,
            mediaKeyTimestamp: null
        };

        if (!messageContent || typeof messageContent !== 'object') {
            return mediaInfo;
        }

        // Check for different media types
        const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];

        for (const mediaType of mediaTypes) {
            if (messageContent[mediaType]) {
                const mediaData = messageContent[mediaType];

                mediaInfo.hasMedia = true;
                mediaInfo.mediaType = mediaType.replace('Message', ''); // Remove 'Message' suffix
                mediaInfo.mediaUrl = mediaData.url;
                mediaInfo.mediaKey = mediaData.mediaKey;
                mediaInfo.mimetype = mediaData.mimetype;
                mediaInfo.fileSize = mediaData.fileLength;
                mediaInfo.fileName = mediaData.fileName || `${mediaInfo.mediaType}_${Date.now()}`;
                mediaInfo.fileSha256 = mediaData.fileSha256;
                mediaInfo.mediaKeyTimestamp = mediaData.mediaKeyTimestamp;

                break; // Only process the first media type found
            }
        }

        return mediaInfo;
    }

    /**
     * Extract reply information from message content
     * @param {Object} messageContent - Message content object
     * @returns {Object} Reply information
     */
    extractReplyInfo(messageContent) {
        const replyInfo = {
            isReply: false,
            quotedMessageId: null,
            quotedText: null,
            quotedParticipant: null
        };

        if (!messageContent || typeof messageContent !== 'object') {
            return replyInfo;
        }

        // Check for quoted message in extended text message
        if (messageContent.extendedTextMessage && messageContent.extendedTextMessage.contextInfo) {
            const contextInfo = messageContent.extendedTextMessage.contextInfo;

            if (contextInfo.stanzaId && contextInfo.quotedMessage) {
                replyInfo.isReply = true;
                replyInfo.quotedMessageId = contextInfo.stanzaId;
                replyInfo.quotedParticipant = contextInfo.participant;

                // Extract quoted text from different message types
                const quotedMessage = contextInfo.quotedMessage;
                if (quotedMessage.conversation) {
                    replyInfo.quotedText = quotedMessage.conversation;
                } else if (quotedMessage.extendedTextMessage) {
                    replyInfo.quotedText = quotedMessage.extendedTextMessage.text;
                } else if (quotedMessage.imageMessage) {
                    replyInfo.quotedText = quotedMessage.imageMessage.caption || '[Image]';
                } else if (quotedMessage.videoMessage) {
                    replyInfo.quotedText = quotedMessage.videoMessage.caption || '[Video]';
                } else if (quotedMessage.audioMessage) {
                    replyInfo.quotedText = '[Audio]';
                } else if (quotedMessage.documentMessage) {
                    replyInfo.quotedText = quotedMessage.documentMessage.caption || '[Document]';
                }
            }
        }

        return replyInfo;
    }

    /**
     * Get processing metrics
     * @returns {Object} Current metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            cacheStats: {
                groupCacheSize: this.groupCache.size,
                userCacheSize: this.userCache.size,
                processedMessagesCount: this.processedMessages.size
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Reset metrics (useful for monitoring)
     */
    resetMetrics() {
        this.metrics = {
            totalMessagesReceived: 0,
            groupMessagesProcessed: 0,
            personalMessagesIgnored: 0,
            duplicateMessagesIgnored: 0,
            processingErrors: 0,
            mediaMessagesProcessed: 0,
            userInfoUpdates: 0,
            newUsersCreated: 0
        };

        logger.info('GroupMessageMonitor metrics reset');
    }

    /**
     * Clear caches (useful for memory management)
     * @param {Object} options - Clear options
     */
    clearCaches(options = {}) {
        const { clearGroups = true, clearUsers = true, clearProcessedMessages = false } = options;

        if (clearGroups) {
            this.groupCache.clear();
            logger.debug('Group cache cleared');
        }

        if (clearUsers) {
            this.userCache.clear();
            logger.debug('User cache cleared');
        }

        if (clearProcessedMessages) {
            this.processedMessages.clear();
            logger.debug('Processed messages cache cleared');
        }

        logger.info('Caches cleared', options);
    }

    /**
     * Validate WasenderClient initialization and availability
     * @returns {Object} Validation result with status and recommendations
     */
    validateWasenderClient() {
        if (!this.wasenderClient) {
            return {
                available: false,
                status: 'not_provided',
                message: 'WasenderClient not provided to constructor',
                recommendation: 'Initialize WasenderClient and pass to GroupMessageMonitor constructor'
            };
        }

        if (!this.wasenderClient.client) {
            return {
                available: false,
                status: 'missing_client',
                message: 'WasenderClient missing HTTP client',
                recommendation: 'Ensure WasenderClient is properly initialized with HTTP client'
            };
        }

        if (typeof this.wasenderClient.client.get !== 'function') {
            return {
                available: false,
                status: 'missing_methods',
                message: 'WasenderClient HTTP client missing required methods',
                recommendation: 'Verify WasenderClient initialization and HTTP client setup'
            };
        }

        return {
            available: true,
            status: 'ready',
            message: 'WasenderClient properly initialized and ready for API calls'
        };
    }

    /**
     * Check if WasenderClient is available for API operations
     * @returns {boolean} True if client is available and functional
     */
    isWasenderClientAvailable() {
        const validation = this.validateWasenderClient();
        return validation.available;
    }

    /**
     * Health check for the service
     * @returns {Object} Health status
     */
    healthCheck() {
        const metrics = this.getMetrics();
        const wasenderStatus = this.validateWasenderClient();

        return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            metrics,
            configuration: {
                duplicateDetectionEnabled: true,
                cachingEnabled: true,
                groupFilteringEnabled: true,
                databaseIntegration: !!this.databaseService,
                wasenderIntegration: wasenderStatus.available
            },
            wasenderClient: wasenderStatus
        };
    }

    /**
     * Process and persist user information to database
     * Integrates with DatabaseService to store user information with profile updates
     * @param {Object} userInfo - Enhanced user information
     * @param {Object} transaction - Database transaction (optional)
     * @returns {Promise<Object>} Database operation result
     */
    async processUserInformation(userInfo, transaction = null) {
        if (!this.databaseService) {
            logger.warn('Database service not available for user information processing', {
                userId: userInfo.userId
            });
            return { success: false, reason: 'no_database_service' };
        }

        try {
            logger.debug('Processing user information for database storage', {
                userId: userInfo.userId,
                displayName: userInfo.displayName,
                phoneNumber: userInfo.phoneNumber,
                isBusiness: userInfo.isBusiness
            });

            // Save user information to database
            const postUser = await this.databaseService.saveUserInfo(userInfo, transaction);

            if (postUser) {
                // Update metrics based on operation type
                if (postUser.created_at && postUser.updated_at &&
                    postUser.created_at.getTime() === postUser.updated_at.getTime()) {
                    this.metrics.newUsersCreated++;
                    logger.info('New user created in database', {
                        postUserId: postUser.id,
                        displayName: postUser.display_name,
                        mobileNumber: postUser.mobile_number
                    });
                } else {
                    this.metrics.userInfoUpdates++;
                    logger.debug('User information updated in database', {
                        postUserId: postUser.id,
                        displayName: postUser.display_name
                    });
                }

                return {
                    success: true,
                    postUser: postUser,
                    operation: postUser.created_at === postUser.updated_at ? 'created' : 'updated'
                };
            } else {
                logger.warn('User information processing returned null result', {
                    userId: userInfo.userId
                });
                return { success: false, reason: 'null_result' };
            }

        } catch (error) {
            logger.error('Error processing user information', {
                error: error.message,
                stack: error.stack,
                userId: userInfo.userId,
                displayName: userInfo.displayName
            });

            return {
                success: false,
                error: error.message,
                userId: userInfo.userId
            };
        }
    }

    /**
     * Set database service for user information persistence
     * @param {Object} databaseService - DatabaseService instance
     */
    setDatabaseService(databaseService) {
        this.databaseService = databaseService;
        logger.info('Database service configured for user information processing');
    }

    /**
     * Sync user cache with database
     * Useful for maintaining consistency between cache and persistent storage
     * @param {Array} userIds - Optional array of specific user IDs to sync
     * @returns {Promise<Object>} Sync operation result
     */
    async syncUserCacheWithDatabase(userIds = null) {
        if (!this.databaseService) {
            logger.warn('Database service not available for cache sync');
            return { success: false, reason: 'no_database_service' };
        }

        try {
            const syncResults = {
                synced: 0,
                errors: 0,
                updated: 0
            };

            const usersToSync = userIds || Array.from(this.userCache.keys());

            for (const userId of usersToSync) {
                try {
                    const cachedUser = this.userCache.get(userId);
                    if (!cachedUser) continue;

                    const dbUser = await this.databaseService.getUserByPlatformId(userId);

                    if (dbUser) {
                        // Update cache with latest database information
                        const updatedCacheUser = {
                            ...cachedUser,
                            messageCount: dbUser.message_count,
                            firstSeen: dbUser.first_seen,
                            lastSeen: dbUser.last_seen,
                            isActive: dbUser.is_active
                        };

                        this.userCache.set(userId, updatedCacheUser);
                        syncResults.updated++;
                    }

                    syncResults.synced++;
                } catch (error) {
                    logger.error('Error syncing user cache entry', {
                        userId,
                        error: error.message
                    });
                    syncResults.errors++;
                }
            }

            logger.info('User cache sync completed', syncResults);
            return { success: true, results: syncResults };

        } catch (error) {
            logger.error('Error during user cache sync', {
                error: error.message,
                stack: error.stack
            });
            return { success: false, error: error.message };
        }
    }

    /**
     * Store message in database with comprehensive data transformation
     * Implements message data transformation for PostBank model and group metadata storage
     * @param {Object} messageData - Raw WhatsApp message data
     * @param {Object} groupInfo - Extracted group information
     * @param {Object} userInfo - Extracted user information
     * @returns {Promise<Object>} Storage operation result
     */
    async storeMessageInDatabase(messageData, groupInfo, userInfo) {
        if (!this.databaseService) {
            return { success: false, reason: 'no_database_service' };
        }

        try {
            logger.debug('Storing message in database', {
                messageId: messageData.key?.id,
                groupId: groupInfo.groupId,
                groupName: groupInfo.groupName,
                userDisplayName: userInfo.displayName,
                messageType: this.determineMessageTypeFromContent(messageData.message)
            });

            // Store the message using the enhanced database service
            const result = await this.databaseService.saveGroupMessage(messageData, groupInfo, userInfo);

            if (result.success) {
                logger.info('Message stored successfully in database', {
                    messageId: result.messageId,
                    postBankId: result.postBankId,
                    groupId: result.groupId,
                    processingStatus: result.processingStatus
                });

                // Update local metrics
                this.updateStorageMetrics(result, userInfo);

                return result;
            } else {
                logger.warn('Message storage returned unsuccessful result', {
                    messageId: messageData.key?.id,
                    reason: result.reason
                });
                return result;
            }

        } catch (error) {
            logger.error('Error storing message in database', {
                messageId: messageData.key?.id,
                error: error.message,
                stack: error.stack
            });

            return {
                success: false,
                error: error.message,
                messageId: messageData.key?.id
            };
        }
    }

    /**
     * Update storage-related metrics based on database operation results
     * @param {Object} storageResult - Result from database storage operation
     * @param {Object} userInfo - User information
     */
    updateStorageMetrics(storageResult, userInfo) {
        // Update user-related metrics if this was a new user
        if (storageResult.userOperation === 'created') {
            this.metrics.newUsersCreated++;
        } else if (storageResult.userOperation === 'updated') {
            this.metrics.userInfoUpdates++;
        }

        // Add storage-specific metrics if not already present
        if (!this.metrics.messagesStored) {
            this.metrics.messagesStored = 0;
        }
        if (!this.metrics.storageErrors) {
            this.metrics.storageErrors = 0;
        }

        this.metrics.messagesStored++;
    }

    /**
     * Determine message type from message content (helper method)
     * @param {Object} message - WhatsApp message object
     * @returns {string} Message type
     */
    determineMessageTypeFromContent(message) {
        if (!message) return 'unknown';

        if (message.conversation || message.extendedTextMessage) return 'text';
        if (message.imageMessage) return 'image';
        if (message.videoMessage) return 'video';
        if (message.audioMessage) return 'audio';
        if (message.documentMessage) return 'document';
        if (message.stickerMessage) return 'sticker';
        if (message.locationMessage) return 'location';
        if (message.contactMessage) return 'contact';

        return 'unknown';
    }

    /**
     * Get comprehensive processing metrics including storage statistics
     * @returns {Object} Enhanced metrics with storage information
     */
    getComprehensiveMetrics() {
        const baseMetrics = this.getMetrics();

        return {
            ...baseMetrics,
            storageMetrics: {
                messagesStored: this.metrics.messagesStored || 0,
                storageErrors: this.metrics.storageErrors || 0,
                storageSuccessRate: this.metrics.messagesStored ?
                    ((this.metrics.messagesStored / (this.metrics.messagesStored + (this.metrics.storageErrors || 0))) * 100).toFixed(2) + '%' :
                    'N/A'
            },
            databaseIntegration: {
                enabled: !!this.databaseService,
                status: this.databaseService ? 'connected' : 'not_available'
            }
        };
    }

    /**
     * Get enhanced user metrics including database statistics
     * @returns {Promise<Object>} Enhanced metrics with database stats
     */
    async getEnhancedUserMetrics() {
        const baseMetrics = this.getComprehensiveMetrics();

        if (!this.databaseService) {
            return {
                ...baseMetrics,
                databaseStats: null,
                note: 'Database service not available'
            };
        }

        try {
            const dbStats = await this.databaseService.getUserStatistics();

            return {
                ...baseMetrics,
                databaseStats: {
                    totalUsers: parseInt(dbStats.total_users) || 0,
                    businessUsers: parseInt(dbStats.business_users) || 0,
                    activeUsers: parseInt(dbStats.active_users) || 0,
                    totalMessages: parseInt(dbStats.total_messages) || 0,
                    avgMessagesPerUser: parseFloat(dbStats.avg_messages_per_user) || 0
                },
                cacheVsDatabase: {
                    cacheSize: this.userCache.size,
                    databaseSize: parseInt(dbStats.total_users) || 0,
                    syncRatio: this.userCache.size / (parseInt(dbStats.total_users) || 1)
                }
            };
        } catch (error) {
            logger.error('Error getting enhanced user metrics', {
                error: error.message
            });

            return {
                ...baseMetrics,
                databaseStats: null,
                error: error.message
            };
        }
    }
}

module.exports = GroupMessageMonitor;