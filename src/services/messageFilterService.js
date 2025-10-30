/**
 * Message Filter Service for WhatsApp Messages
 * 
 * Implements district and keyword-based filtering for WhatsApp messages
 * Similar to YouTube API filtering logic but adapted for WhatsApp message structure
 * 
 * Key Features:
 * - District Detection: Checks for UP district names in Hindi and English
 * - Keyword Matching: Matches against crime, police, and incident keywords
 * - Efficient Processing: Optimized for continuous message flow
 * - Comprehensive Logging: Detailed filtering decisions for monitoring
 * 
 * Filtering Logic:
 * - Messages must contain BOTH district AND keyword to be saved
 * - Text is checked in post_snippet (message text) and post_title (generated title)
 * - Supports Hindi, English, and Hinglish keywords
 * - Case-insensitive matching for English, exact matching for Hindi
 */

const fs = require('fs');
const path = require('path');
const logger = require('./loggingService').getServiceLogger('message-filter');

class MessageFilterService {
    constructor() {
        this.englishDistricts = [];
        this.hindiDistricts = [];
        this.hindiKeywords = [];
        this.englishKeywords = [];
        this.hinglishKeywords = [];
        
        // Concurrency control
        this.isReloading = false;
        this.reloadQueue = [];
        this.lastReloadTime = null;
        
        // Performance metrics
        this.metrics = {
            totalProcessed: 0,
            passedFilter: 0,
            failedFilter: 0,
            districtMatches: 0,
            keywordMatches: 0,
            bothMatches: 0,
            processingTimeMs: 0,
            dataReloads: 0,
            concurrentAccess: 0,
            reloadConflicts: 0
        };

        // Load district and keyword data
        this.loadFilterData();

        // Watch for keyword updates
        this.setupKeywordUpdateWatcher();

        logger.info('MessageFilterService initialized', {
            englishDistricts: this.englishDistricts.length,
            hindiDistricts: this.hindiDistricts.length,
            totalKeywords: this.hindiKeywords.length + this.englishKeywords.length + this.hinglishKeywords.length
        });
    }

    /**
     * Load district names and keywords from JSON files
     */
    loadFilterData() {
        try {
            // Load district data
            const districtPath = path.join(process.cwd(), 'youtube_hindi_Eng_District.json');
            if (fs.existsSync(districtPath)) {
                const districtData = JSON.parse(fs.readFileSync(districtPath, 'utf8'));
                this.englishDistricts = districtData.EnglishDistrictsName || [];
                this.hindiDistricts = districtData.HindiDistrictsName || [];
                
                logger.info('District data loaded successfully', {
                    englishDistricts: this.englishDistricts.length,
                    hindiDistricts: this.hindiDistricts.length
                });
            } else {
                logger.error('District data file not found', { path: districtPath });
            }

            // Load keyword matrix data
            const keywordPath = path.join(process.cwd(), 'youtube_matrix_keywords.json');
            if (fs.existsSync(keywordPath)) {
                const keywordData = JSON.parse(fs.readFileSync(keywordPath, 'utf8'));
                
                this.hindiKeywords = [];
                this.englishKeywords = [];
                this.hinglishKeywords = [];
                
                keywordData.forEach(item => {
                    if (item.hindiKeyword) {
                        const keywords = item.hindiKeyword.split(',').map(k => k.trim()).filter(k => k);
                        this.hindiKeywords.push(...keywords);
                    }
                    if (item.englishKeyword) {
                        const keywords = item.englishKeyword.split(',').map(k => k.trim()).filter(k => k);
                        this.englishKeywords.push(...keywords);
                    }
                    if (item.hinglishKeyword) {
                        const keywords = item.hinglishKeyword.split(',').map(k => k.trim()).filter(k => k);
                        this.hinglishKeywords.push(...keywords);
                    }
                });

                logger.info('Keyword data loaded successfully', {
                    hindiKeywords: this.hindiKeywords.length,
                    englishKeywords: this.englishKeywords.length,
                    hinglishKeywords: this.hinglishKeywords.length
                });
            } else {
                logger.error('Keyword data file not found', { path: keywordPath });
            }

        } catch (error) {
            logger.error('Error loading filter data', {
                error: error.message,
                stack: error.stack
            });
            
            // Initialize with empty arrays as fallback
            this.englishDistricts = [];
            this.hindiDistricts = [];
            this.hindiKeywords = [];
            this.englishKeywords = [];
            this.hinglishKeywords = [];
        }
    }

    /**
     * Main filtering method - determines if a message should be saved
     * Thread-safe with concurrent reload protection
     * @param {Object} messageData - WhatsApp message data from groupMessageMonitor
     * @returns {Object} Filtering result with decision and details
     */
    shouldSaveMessage(messageData) {
        const startTime = Date.now();
        this.metrics.totalProcessed++;

        // Handle concurrent access during reload
        if (this.isReloading) {
            this.metrics.concurrentAccess++;
            logger.debug('Filtering during reload - using current data', {
                messageId: messageData.messageId,
                reloadInProgress: true
            });
        }

        try {
            // Extract text content for filtering
            const textContent = this.extractTextContent(messageData);
            
            // Log the filtering attempt
            logger.debug('Processing message for filtering', {
                messageId: messageData.messageId,
                messageType: messageData.messageType,
                hasText: !!textContent.combinedText,
                textLength: textContent.combinedText ? textContent.combinedText.length : 0
            });

            // Check for district presence
            const districtResult = this.checkDistrictPresence(textContent.combinedText);
            
            // Check for keyword presence
            const keywordResult = this.checkKeywordPresence(textContent.combinedText);

            // Determine if message should be saved (requires BOTH district AND keyword)
            const shouldSave = districtResult.hasDistrict && keywordResult.hasKeyword;

            // Update metrics
            if (districtResult.hasDistrict) this.metrics.districtMatches++;
            if (keywordResult.hasKeyword) this.metrics.keywordMatches++;
            if (shouldSave) {
                this.metrics.passedFilter++;
                this.metrics.bothMatches++;
            } else {
                this.metrics.failedFilter++;
            }

            const processingTime = Date.now() - startTime;
            this.metrics.processingTimeMs += processingTime;

            // Create detailed result
            const result = {
                shouldSave: shouldSave,
                hasDistrict: districtResult.hasDistrict,
                hasKeyword: keywordResult.hasKeyword,
                districtMatches: districtResult.matches,
                keywordMatches: keywordResult.matches,
                reason: this.getFilterReason(districtResult.hasDistrict, keywordResult.hasKeyword),
                textContent: textContent,
                processingTime
            };

            // Log filtering decision
            if (shouldSave) {
                logger.info('Message PASSED filter - will be saved', {
                    messageId: messageData.messageId,
                    districts: districtResult.matches,
                    keywords: keywordResult.matches,
                    processingTime
                });
            } else {
                logger.debug('Message FAILED filter - will be skipped', {
                    messageId: messageData.messageId,
                    hasDistrict: districtResult.hasDistrict,
                    hasKeyword: keywordResult.hasKeyword,
                    reason: result.reason,
                    processingTime
                });
            }

            return result;

        } catch (error) {
            logger.error('Error in message filtering', {
                messageId: messageData.messageId,
                error: error.message,
                stack: error.stack
            });

            // Default to not saving on error
            return {
                shouldSave: false,
                hasDistrict: false,
                hasKeyword: false,
                districtMatches: [],
                keywordMatches: [],
                reason: 'filtering_error',
                error: error.message,
                processingTime: Date.now() - startTime
            };
        }
    }

    /**
     * Extract text content from WhatsApp message data
     * @param {Object} messageData - Message data from groupMessageMonitor
     * @returns {Object} Extracted text content
     */
    extractTextContent(messageData) {
        let messageText = '';
        let titleText = '';
        let combinedText = '';

        try {
            // Extract message text (post_snippet equivalent)
            if (messageData.messageText) {
                messageText = messageData.messageText;
            }

            // Extract title text if available
            if (messageData.groupInfo && messageData.groupInfo.groupName) {
                titleText = messageData.groupInfo.groupName;
            }

            // For media messages, check caption
            if (messageData.mediaInfo && messageData.mediaInfo.hasMedia) {
                // Caption is usually included in messageText, but double-check
                if (messageData.mediaInfo.caption) {
                    messageText += ' ' + messageData.mediaInfo.caption;
                }
            }

            // Combine all text for comprehensive checking
            combinedText = `${messageText} ${titleText}`.trim();

            return {
                messageText: messageText.trim(),
                titleText: titleText.trim(),
                combinedText: combinedText,
                hasContent: !!combinedText
            };

        } catch (error) {
            logger.error('Error extracting text content', {
                error: error.message,
                messageData: JSON.stringify(messageData).substring(0, 200)
            });

            return {
                messageText: '',
                titleText: '',
                combinedText: '',
                hasContent: false
            };
        }
    }

    /**
     * Check if text contains any UP district name (Hindi or English)
     * @param {string} text - Text to check
     * @returns {Object} District check result
     */
    checkDistrictPresence(text) {
        if (!text || typeof text !== 'string') {
            return { hasDistrict: false, matches: [] };
        }

        const matches = [];
        const textLower = text.toLowerCase();

        // Check English districts (case-insensitive)
        for (const district of this.englishDistricts) {
            if (textLower.includes(district.toLowerCase())) {
                matches.push({ district, language: 'english', type: 'district' });
            }
        }

        // Check Hindi districts (exact match, case-sensitive for Hindi)
        for (const district of this.hindiDistricts) {
            if (text.includes(district)) {
                matches.push({ district, language: 'hindi', type: 'district' });
            }
        }

        return {
            hasDistrict: matches.length > 0,
            matches: matches
        };
    }

    /**
     * Check if text contains any relevant keywords
     * @param {string} text - Text to check
     * @returns {Object} Keyword check result
     */
    checkKeywordPresence(text) {
        if (!text || typeof text !== 'string') {
            return { hasKeyword: false, matches: [] };
        }

        const matches = [];
        const textLower = text.toLowerCase();

        // Check Hindi keywords (exact match, case-sensitive)
        for (const keyword of this.hindiKeywords) {
            if (keyword && text.includes(keyword)) {
                matches.push({ keyword, language: 'hindi', type: 'keyword' });
            }
        }

        // Check English keywords (case-insensitive)
        for (const keyword of this.englishKeywords) {
            if (keyword && textLower.includes(keyword.toLowerCase())) {
                matches.push({ keyword, language: 'english', type: 'keyword' });
            }
        }

        // Check Hinglish keywords (case-insensitive)
        for (const keyword of this.hinglishKeywords) {
            if (keyword && textLower.includes(keyword.toLowerCase())) {
                matches.push({ keyword, language: 'hinglish', type: 'keyword' });
            }
        }

        return {
            hasKeyword: matches.length > 0,
            matches: matches
        };
    }

    /**
     * Get human-readable reason for filtering decision
     * @param {boolean} hasDistrict - Whether district was found
     * @param {boolean} hasKeyword - Whether keyword was found
     * @returns {string} Reason string
     */
    getFilterReason(hasDistrict, hasKeyword) {
        if (hasDistrict && hasKeyword) {
            return 'contains_district_and_keyword';
        } else if (hasDistrict && !hasKeyword) {
            return 'has_district_but_no_keyword';
        } else if (!hasDistrict && hasKeyword) {
            return 'has_keyword_but_no_district';
        } else {
            return 'no_district_or_keyword';
        }
    }

    /**
     * Check if message should be processed based on content type
     * Implements the logic for different message scenarios:
     * a) message + media - check criteria, save if met
     * b) message only - check criteria, save if met  
     * c) media only - skip (no text to check)
     * @param {Object} messageData - Message data from groupMessageMonitor
     * @returns {Object} Processing decision
     */
    shouldProcessMessage(messageData) {
        try {
            const hasText = !!(messageData.messageText && messageData.messageText.trim());
            const hasMedia = !!(messageData.mediaInfo && messageData.mediaInfo.hasMedia);

            // Case c: Only media, no text - skip
            if (hasMedia && !hasText) {
                logger.debug('Skipping media-only message (no text to filter)', {
                    messageId: messageData.messageId,
                    mediaType: messageData.mediaInfo?.mediaType
                });

                return {
                    shouldProcess: false,
                    shouldSave: false,
                    reason: 'media_only_no_text',
                    scenario: 'media_only'
                };
            }

            // Case a & b: Has text (with or without media) - apply filtering
            if (hasText) {
                const filterResult = this.shouldSaveMessage(messageData);
                
                const scenario = hasMedia ? 'message_with_media' : 'message_only';
                
                return {
                    shouldProcess: true,
                    shouldSave: filterResult.shouldSave,
                    reason: filterResult.reason,
                    scenario: scenario,
                    filterDetails: filterResult
                };
            }

            // Fallback: No text, no media - skip
            return {
                shouldProcess: false,
                shouldSave: false,
                reason: 'no_content',
                scenario: 'empty_message'
            };

        } catch (error) {
            logger.error('Error in message processing decision', {
                messageId: messageData.messageId,
                error: error.message
            });

            return {
                shouldProcess: false,
                shouldSave: false,
                reason: 'processing_error',
                scenario: 'error',
                error: error.message
            };
        }
    }

    /**
     * Get filtering metrics and statistics
     * @returns {Object} Current metrics
     */
    getMetrics() {
        const totalProcessed = this.metrics.totalProcessed;
        const avgProcessingTime = totalProcessed > 0 ? 
            (this.metrics.processingTimeMs / totalProcessed).toFixed(2) : 0;

        return {
            ...this.metrics,
            passRate: totalProcessed > 0 ? 
                ((this.metrics.passedFilter / totalProcessed) * 100).toFixed(2) + '%' : '0%',
            failRate: totalProcessed > 0 ? 
                ((this.metrics.failedFilter / totalProcessed) * 100).toFixed(2) + '%' : '0%',
            avgProcessingTimeMs: parseFloat(avgProcessingTime),
            configuration: {
                englishDistricts: this.englishDistricts.length,
                hindiDistricts: this.hindiDistricts.length,
                hindiKeywords: this.hindiKeywords.length,
                englishKeywords: this.englishKeywords.length,
                hinglishKeywords: this.hinglishKeywords.length,
                totalKeywords: this.hindiKeywords.length + this.englishKeywords.length + this.hinglishKeywords.length
            },
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Reset metrics (useful for monitoring periods)
     */
    resetMetrics() {
        this.metrics = {
            totalProcessed: 0,
            passedFilter: 0,
            failedFilter: 0,
            districtMatches: 0,
            keywordMatches: 0,
            bothMatches: 0,
            processingTimeMs: 0
        };

        logger.info('MessageFilterService metrics reset');
    }

    /**
     * Setup watcher for keyword update notifications
     */
    setupKeywordUpdateWatcher() {
        const notificationPath = path.join(process.cwd(), '.keyword_update_notification');
        
        // Check for updates every 30 seconds
        setInterval(async () => {
            try {
                if (fs.existsSync(notificationPath)) {
                    const stats = await fs.promises.stat(notificationPath);
                    const lastModified = stats.mtime.getTime();
                    
                    // Check if file was modified in the last 60 seconds
                    if (Date.now() - lastModified < 60000) {
                        logger.info('Keyword update notification detected - reloading filter data');
                        this.reloadFilterData();
                        
                        // Delete notification file after processing
                        try {
                            await fs.promises.unlink(notificationPath);
                        } catch (error) {
                            // Ignore deletion errors
                        }
                    }
                }
            } catch (error) {
                // Ignore watcher errors
            }
        }, 30000); // Check every 30 seconds
    }

    /**
     * Thread-safe reload of filter data from JSON files
     * Prevents concurrent reloads and ensures data consistency
     */
    async reloadFilterData() {
        // Prevent concurrent reloads
        if (this.isReloading) {
            this.metrics.reloadConflicts++;
            logger.debug('Reload already in progress - skipping duplicate request');
            return false;
        }

        // Check if reload is too frequent (prevent spam)
        const now = Date.now();
        if (this.lastReloadTime && (now - this.lastReloadTime) < 5000) {
            logger.debug('Reload too frequent - skipping (last reload was less than 5 seconds ago)');
            return false;
        }

        this.isReloading = true;
        this.lastReloadTime = now;

        try {
            logger.info('Reloading filter data from JSON files');
            
            const oldConfig = {
                englishDistricts: this.englishDistricts.length,
                hindiDistricts: this.hindiDistricts.length,
                totalKeywords: this.hindiKeywords.length + this.englishKeywords.length + this.hinglishKeywords.length
            };

            // Create backup of current data in case reload fails
            const backupData = {
                englishDistricts: [...this.englishDistricts],
                hindiDistricts: [...this.hindiDistricts],
                hindiKeywords: [...this.hindiKeywords],
                englishKeywords: [...this.englishKeywords],
                hinglishKeywords: [...this.hinglishKeywords]
            };

            try {
                // Load new data
                this.loadFilterData();
                this.metrics.dataReloads++;

                const newConfig = {
                    englishDistricts: this.englishDistricts.length,
                    hindiDistricts: this.hindiDistricts.length,
                    totalKeywords: this.hindiKeywords.length + this.englishKeywords.length + this.hinglishKeywords.length
                };

                const hasChanges = JSON.stringify(oldConfig) !== JSON.stringify(newConfig);

                logger.info('Filter data reloaded successfully', {
                    before: oldConfig,
                    after: newConfig,
                    changed: hasChanges,
                    reloadCount: this.metrics.dataReloads,
                    reloadTime: Date.now() - now
                });

                return hasChanges;

            } catch (loadError) {
                // Restore backup data if reload fails
                logger.error('Failed to reload filter data - restoring backup', {
                    error: loadError.message
                });

                this.englishDistricts = backupData.englishDistricts;
                this.hindiDistricts = backupData.hindiDistricts;
                this.hindiKeywords = backupData.hindiKeywords;
                this.englishKeywords = backupData.englishKeywords;
                this.hinglishKeywords = backupData.hinglishKeywords;

                throw loadError;
            }

        } finally {
            this.isReloading = false;
        }
    }

    /**
     * Test the filter with sample data
     * @param {string} text - Text to test
     * @returns {Object} Test result
     */
    testFilter(text) {
        const testData = {
            messageText: text,
            messageType: 'text',
            groupInfo: { groupName: 'Test Group' },
            mediaInfo: { hasMedia: false }
        };

        const result = this.shouldSaveMessage(testData);
        
        return {
            text: text,
            shouldSave: result.shouldSave,
            hasDistrict: result.hasDistrict,
            hasKeyword: result.hasKeyword,
            districtMatches: result.districtMatches,
            keywordMatches: result.keywordMatches,
            reason: result.reason
        };
    }

    /**
     * Get sample of loaded districts and keywords for verification
     * @returns {Object} Sample data
     */
    getSampleData() {
        return {
            englishDistricts: this.englishDistricts.slice(0, 5),
            hindiDistricts: this.hindiDistricts.slice(0, 5),
            hindiKeywords: this.hindiKeywords.slice(0, 5),
            englishKeywords: this.englishKeywords.slice(0, 5),
            hinglishKeywords: this.hinglishKeywords.slice(0, 5),
            totalCounts: {
                englishDistricts: this.englishDistricts.length,
                hindiDistricts: this.hindiDistricts.length,
                hindiKeywords: this.hindiKeywords.length,
                englishKeywords: this.englishKeywords.length,
                hinglishKeywords: this.hinglishKeywords.length
            }
        };
    }

    /**
     * Health check for the filter service
     * @returns {Object} Health status
     */
    healthCheck() {
        const hasDistricts = this.englishDistricts.length > 0 || this.hindiDistricts.length > 0;
        const hasKeywords = this.hindiKeywords.length > 0 || this.englishKeywords.length > 0 || this.hinglishKeywords.length > 0;
        
        return {
            status: hasDistricts && hasKeywords ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            dataLoaded: {
                districts: hasDistricts,
                keywords: hasKeywords,
                englishDistricts: this.englishDistricts.length,
                hindiDistricts: this.hindiDistricts.length,
                totalKeywords: this.hindiKeywords.length + this.englishKeywords.length + this.hinglishKeywords.length
            },
            metrics: this.getMetrics(),
            issues: [
                ...(hasDistricts ? [] : ['No district data loaded']),
                ...(hasKeywords ? [] : ['No keyword data loaded'])
            ]
        };
    }
}

module.exports = MessageFilterService;