/**
 * Database Service for Wasender API Migration
 * Handles all database operations using Sequelize ORM with PostBank, CommonAttachment, and PostUser models
 * Implements WhatsApp message to PostBank mapping logic and duplicate message detection
 */

const { Sequelize } = require('sequelize');
const { initializeModels } = require('../models');
const crypto = require('crypto');
const MediaDownloadService = require('./mediaDownloadService');
const MediaQueueService = require('./mediaQueueService');

class DatabaseService {
  constructor() {
    this.sequelize = null;
    this.models = null;
    this.isConnected = false;
    this.attachmentProcessingService = null;
    this.mediaDownloadService = new MediaDownloadService();
    this.mediaQueueService = null; // Will be initialized after database connection
  }

  /**
   * Set the AttachmentProcessingService for enhanced attachment handling
   * @param {AttachmentProcessingService} attachmentProcessingService - The service instance
   */
  setAttachmentProcessingService(attachmentProcessingService) {
    this.attachmentProcessingService = attachmentProcessingService;
    console.log('✅ AttachmentProcessingService integrated with DatabaseService');
  }

  /**
   * Get media processing priority based on type
   * @param {string} mediaType - Media type
   * @returns {number} Priority (1 = highest, 10 = lowest)
   */
  getMediaPriority(mediaType) {
    const priorities = {
      'image': 2,     // High priority - quick to process
      'sticker': 1,   // Highest priority - smallest files
      'audio': 3,     // Medium-high priority
      'document': 4,  // Medium priority
      'video': 5      // Lower priority - largest files
    };
    
    return priorities[mediaType] || 5;
  }

  /**
   * Connect to database using Sequelize
   */
  async connect() {
    try {
      // Initialize Sequelize connection
      this.sequelize = new Sequelize(
        process.env.DB_NAME,
        process.env.DB_USER,
        process.env.DB_PASSWORD,
        {
          host: process.env.DB_HOST,
          port: process.env.DB_PORT || 3306,
          dialect: 'mysql',
          logging: false,
          pool: {
            max: 20,        // Maximum number of connections in pool
            min: 5,         // Minimum number of connections in pool
            acquire: 60000, // Maximum time to get connection (60 seconds)
            idle: 10000,    // Maximum time connection can be idle (10 seconds)
            evict: 1000,    // Time interval to run eviction (1 second)
            handleDisconnects: true
          },
          retry: {
            match: [
              /ETIMEDOUT/,
              /EHOSTUNREACH/,
              /ECONNRESET/,
              /ECONNREFUSED/,
              /ETIMEDOUT/,
              /ESOCKETTIMEDOUT/,
              /EHOSTUNREACH/,
              /EPIPE/,
              /EAI_AGAIN/,
              /ER_CON_COUNT_ERROR/,
              /ECONNREFUSED/
            ],
            max: 3
          }
        }
      );

      // Test connection
      await this.sequelize.authenticate();
      console.log('✅ Database connection test successful');

      // Initialize models
      this.models = initializeModels(this.sequelize);

      // Sync database
      await this.sequelize.sync({ force: false });
      console.log('✅ Database models synchronized');

      // Run auto-migration for all models
      await this.models.PostBank.autoMigrate();
      console.log('✅ PostBank auto-migration completed');

      if (this.models.CommonAttachment && typeof this.models.CommonAttachment.autoMigrate === 'function') {
        await this.models.CommonAttachment.autoMigrate();
        console.log('✅ CommonAttachment auto-migration completed');
      }

      if (this.models.PostUser && typeof this.models.PostUser.autoMigrate === 'function') {
        await this.models.PostUser.autoMigrate();
        console.log('✅ PostUser auto-migration completed');
      }

      // Initialize media queue service after database connection
      this.mediaQueueService = new MediaQueueService(this.mediaDownloadService, this);
      console.log('✅ Media queue service initialized');

      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('Database connection error:', error);
      this.isConnected = false;
      setTimeout(() => this.reconnect(), 5000);
      throw error;
    }
  }

  /**
   * Reconnect to database
   */
  async reconnect() {
    if (!this.isConnected) {
      try {
        await this.connect();
        console.log('Database reconnected successfully');
      } catch (error) {
        console.error('Database reconnection failed:', error);
        setTimeout(() => this.reconnect(), 5000);
      }
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    if (this.sequelize) {
      await this.sequelize.close();
      this.isConnected = false;
      console.log('Database disconnected');
    }
  }

  /**
   * Save group message from Wasender API webhook to database
   * Maps WhatsApp message data to PostBank model with proper relationships
   * Implements message data transformation, group metadata extraction and storage, and message status tracking
   * @param {Object} messageData - WhatsApp message data from Wasender webhook
   * @param {Object} groupInfo - Group information extracted from message
   * @param {Object} userInfo - User information extracted from message
   * @returns {Promise<number>} - PostBank record ID
   */
  async saveGroupMessage(messageData, groupInfo, userInfo) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    const transaction = await this.sequelize.transaction();

    try {
      console.log('📝 Processing WhatsApp message for database storage:');
      console.log('- Message ID:', messageData.key?.id);
      console.log('- Group ID:', groupInfo?.groupId || groupInfo?.id);
      console.log('- Group Name:', groupInfo?.groupName);
      console.log('- Sender:', userInfo?.displayName);
      console.log('- Message Type:', this.determineMessageType(messageData.message));

      // Check for duplicate message using enhanced duplicate detection
      const isDuplicate = await this.checkDuplicateMessage(messageData.key?.id);
      if (isDuplicate) {
        console.log('⚠️ Duplicate message detected, skipping save');
        await transaction.rollback();
        return { success: false, reason: 'duplicate_message', messageId: messageData.key?.id };
      }

      // Save or update user information with enhanced processing
      const postUser = await this.saveUserInfo(userInfo, transaction);

      // Extract and store group metadata
      const enhancedGroupInfo = await this.processGroupMetadata(groupInfo, messageData, transaction);

      // Transform message data for PostBank model with comprehensive mapping
      const postBankData = this.transformMessageDataForPostBank(messageData, enhancedGroupInfo, userInfo, postUser?.id);

      // Create PostBank record with message status tracking
      console.log('🔄 Creating PostBank record with enhanced data...');
      const postBankRecord = await this.models.PostBank.create(postBankData, { transaction });
      console.log('✅ PostBank record created with ID:', postBankRecord.id);

      // Process attachments if any with enhanced attachment handling
      if (messageData.message && this.hasAttachments(messageData.message)) {
        const attachmentResults = await this.processMessageAttachments(messageData, postBankRecord.id, enhancedGroupInfo, userInfo, transaction);
        console.log(`📎 Processed ${attachmentResults.length} attachment(s)`);
      }

      // Update message status to indicate successful processing
      await this.updateMessageProcessingStatus(postBankRecord.id, 'PROCESSED', transaction);

      await transaction.commit();
      console.log('✅ MESSAGE SAVE SUCCESSFUL!');
      console.log('PostBank ID:', postBankRecord.id);
      console.log('Group:', enhancedGroupInfo.groupName || enhancedGroupInfo.groupId);
      console.log('Processing Status: PROCESSED');

      return {
        success: true,
        postBankId: postBankRecord.id,
        messageId: messageData.key?.id,
        groupId: enhancedGroupInfo.groupId,
        processingStatus: 'PROCESSED'
      };
    } catch (error) {
      await transaction.rollback();
      console.error('Error saving group message:', error);

      // Update message status to indicate processing failure
      try {
        await this.updateMessageProcessingStatus(null, 'FAILED', null, messageData.key?.id);
      } catch (statusError) {
        console.error('Error updating message status after failure:', statusError);
      }

      // Implement retry logic for database operations
      if (this.shouldRetryOperation(error)) {
        console.log('Retrying database operation...');
        return await this.saveGroupMessage(messageData, groupInfo, userInfo);
      }

      throw error;
    }
  }

  /**
   * Save or update user information in PostUser table with comprehensive data processing
   * Implements enhanced user data extraction and profile updates when new information is available
   * @param {Object} userInfo - Enhanced user information from GroupMessageMonitor
   * @param {Object} transaction - Database transaction
   * @returns {Promise<Object>} - PostUser record
   */
  async saveUserInfo(userInfo, transaction = null) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const platformUserId = userInfo.jid || userInfo.platformUserId || userInfo.phoneNumber;
      if (!platformUserId) {
        console.log('⚠️ No platform user ID available, skipping user save');
        return null;
      }

      console.log('📝 Processing user information for database storage:');
      console.log('- Platform User ID:', platformUserId);
      console.log('- Display Name:', userInfo.displayName);
      console.log('- Phone Number:', userInfo.phoneNumber);
      console.log('- Is Business:', userInfo.isBusiness);

      // Check if user already exists
      const existingUser = await this.models.PostUser.findOne({
        where: {
          platform: 'whatsapp',
          platform_user_id: platformUserId
        },
        transaction
      });

      if (existingUser) {
        // Prepare update data with comprehensive user information
        const updateData = this.prepareUserUpdateData(userInfo, existingUser);

        // Check if there are actual changes to update
        const hasChanges = this.hasUserDataChanges(existingUser, updateData);

        if (hasChanges) {
          await existingUser.update(updateData, { transaction });
          console.log('✅ Updated existing PostUser with new information:', existingUser.id);
          console.log('- Updated fields:', Object.keys(updateData).filter(key =>
            existingUser[key] !== updateData[key]
          ));
        } else {
          // Still update last_seen and message_count
          await existingUser.update({
            last_seen: new Date(),
            message_count: existingUser.message_count + 1
          }, { transaction });
          console.log('✅ Updated PostUser activity (no profile changes):', existingUser.id);
        }

        return existingUser;
      } else {
        // Create new user with comprehensive data
        const userData = this.prepareNewUserData(userInfo);

        const newUser = await this.models.PostUser.create(userData, { transaction });
        console.log('✅ Created new PostUser with comprehensive data:', newUser.id);
        console.log('- Display Name:', userData.display_name);
        console.log('- Mobile Number:', userData.mobile_number);
        console.log('- Business Account:', userData.is_business);

        return newUser;
      }
    } catch (error) {
      console.error('Error saving user info:', error);
      console.error('User info data:', JSON.stringify(userInfo, null, 2));
      throw error;
    }
  }

  /**
   * Prepare update data for existing user with comprehensive information
   * @param {Object} userInfo - Enhanced user information
   * @param {Object} existingUser - Existing PostUser record
   * @returns {Object} Update data object
   */
  prepareUserUpdateData(userInfo, existingUser) {
    const updateData = {
      // Always update activity tracking
      last_seen: new Date(),
      message_count: existingUser.message_count + 1
    };

    // Update display name if new information is available
    if (userInfo.displayName && userInfo.displayName !== existingUser.display_name) {
      updateData.display_name = userInfo.displayName;
    }

    // Update username with display name if available
    if (userInfo.displayName && userInfo.displayName !== existingUser.username) {
      updateData.username = userInfo.displayName;
    }

    // Update mobile number with phone number if available
    if (userInfo.phoneNumber && userInfo.phoneNumber !== existingUser.mobile_number) {
      updateData.mobile_number = userInfo.phoneNumber;
    }

    // Update business status if changed
    if (userInfo.isBusiness !== undefined && userInfo.isBusiness !== existingUser.is_business) {
      updateData.is_business = userInfo.isBusiness;
    }

    // Update profile image URL if available
    if (userInfo.profileImageUrl && userInfo.profileImageUrl !== existingUser.profile_image_url) {
      updateData.profile_image_url = userInfo.profileImageUrl;
    }

    // Always update the updated_at timestamp
    updateData.updated_at = new Date();

    return updateData;
  }

  /**
   * Prepare data for new user creation with comprehensive information
   * @param {Object} userInfo - Enhanced user information
   * @returns {Object} New user data object
   */
  prepareNewUserData(userInfo) {
    const currentTime = new Date();

    return {
      // Core identification fields
      platform: 'whatsapp',
      platform_user_id: userInfo.jid || userInfo.platformUserId || userInfo.phoneNumber,
      username: userInfo.displayName || userInfo.phoneNumber,
      display_name: userInfo.displayName || userInfo.phoneNumber,
      mobile_number: userInfo.phoneNumber,

      // Profile information
      profile_image_url: userInfo.profileImageUrl || null,

      // Business account information
      is_business: userInfo.isBusiness || false,

      // Activity tracking
      first_seen: currentTime,
      last_seen: currentTime,
      message_count: 1,
      is_active: true,

      // Timestamps
      created_at: currentTime,
      updated_at: currentTime
    };
  }

  /**
   * Check if user data has actual changes that need to be updated
   * @param {Object} existingUser - Existing PostUser record
   * @param {Object} updateData - Prepared update data
   * @returns {boolean} True if there are changes to update
   */
  hasUserDataChanges(existingUser, updateData) {
    // Fields to check for changes (excluding activity tracking fields)
    const fieldsToCheck = [
      'display_name',
      'username',
      'mobile_number',
      'is_business',
      'profile_image_url'
    ];

    for (const field of fieldsToCheck) {
      if (updateData[field] !== undefined && existingUser[field] !== updateData[field]) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get user information by platform user ID
   * @param {string} platformUserId - Platform user ID (JID or phone number)
   * @returns {Promise<Object|null>} PostUser record or null
   */
  async getUserByPlatformId(platformUserId) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const user = await this.models.PostUser.findOne({
        where: {
          platform: 'whatsapp',
          platform_user_id: platformUserId
        }
      });

      return user;
    } catch (error) {
      console.error('Error getting user by platform ID:', error);
      return null;
    }
  }

  /**
   * Get user statistics for monitoring
   * @returns {Promise<Object>} User statistics
   */
  async getUserStatistics() {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const stats = await this.models.PostUser.findAll({
        attributes: [
          [this.models.sequelize.fn('COUNT', this.models.sequelize.col('id')), 'total_users'],
          [this.models.sequelize.fn('COUNT', this.models.sequelize.literal('CASE WHEN is_business = true THEN 1 END')), 'business_users'],
          [this.models.sequelize.fn('COUNT', this.models.sequelize.literal('CASE WHEN is_active = true THEN 1 END')), 'active_users'],
          [this.models.sequelize.fn('SUM', this.models.sequelize.col('message_count')), 'total_messages'],
          [this.models.sequelize.fn('AVG', this.models.sequelize.col('message_count')), 'avg_messages_per_user']
        ],
        where: {
          platform: 'whatsapp'
        },
        raw: true
      });

      return stats[0] || {};
    } catch (error) {
      console.error('Error getting user statistics:', error);
      return {};
    }
  }

  /**
   * Save attachment information to CommonAttachment table
   * @param {Object} attachmentData - Attachment data from WhatsApp message
   * @param {number} postBankId - Foreign key to PostBank record
   * @param {Object} transaction - Database transaction
   * @returns {Promise<Object>} - CommonAttachment record
   */
  async saveAttachment(attachmentData, postBankId, transaction = null) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const attachmentRecord = {
        post_bank_id: postBankId,
        attachment_type: attachmentData.type,
        platform_name: 'whatsapp',
        mime_type: attachmentData.mimeType,
        download_status: 'PENDING',
        processing_status: 'NOT_PROCESSED',
        timestamp: new Date(),
        group_id: attachmentData.groupId,
        mobile_number: attachmentData.senderPhone
      };

      // Add media to queue for background processing (production-ready approach)
      let mediaPath = attachmentData.url || attachmentData.filePath; // Default to original URL
      
      if (attachmentData.url && attachmentData.mediaKey && this.mediaQueueService) {
        try {
          // Reconstruct the message object for queue processing
          const messageDataForDecryption = {
            message: {}
          };
          
          const messageKey = `${attachmentData.type}Message`;
          messageDataForDecryption.message[messageKey] = {
            url: attachmentData.url,
            mediaKey: attachmentData.mediaKey,
            mimetype: attachmentData.mimeType,
            fileSha256: attachmentData.fileSha256,
            fileName: attachmentData.fileName
          };

          // Add to queue for background processing
          const jobId = await this.mediaQueueService.addMediaJob({
            messageId: `${postBankId}_${Date.now()}`,
            messageData: messageDataForDecryption,
            mediaType: attachmentData.type,
            postBankId: postBankId,
            priority: this.getMediaPriority(attachmentData.type)
          });

          console.log(`📋 Media job queued for background processing: ${jobId}`);
          
          // For now, store original URL - will be updated by queue when processing completes
          mediaPath = attachmentData.url;
          
        } catch (error) {
          console.log('❌ Failed to queue media job:', error.message);
          mediaPath = attachmentData.url || attachmentData.filePath;
        }
      }

      switch (attachmentData.type) {
        case 'image':
          attachmentRecord.image_attachment_path = mediaPath;
          break;
        case 'video':
          attachmentRecord.video_attachment_path = mediaPath;
          break;
        case 'audio':
          attachmentRecord.audio_attachment_path = mediaPath;
          break;
        case 'document':
          attachmentRecord.document_attachment_path = mediaPath;
          break;
        case 'sticker':
          attachmentRecord.image_attachment_path = mediaPath; // Store stickers as images
          break;
      }

      const attachment = await this.models.CommonAttachment.create(attachmentRecord, { transaction });
      console.log('✅ Created CommonAttachment record:', attachment.id);
      return attachment;
    } catch (error) {
      console.error('Error saving attachment:', error);
      throw error;
    }
  }

  /**
   * Check if a message with the given ID already exists (duplicate detection)
   * @param {string} messageId - WhatsApp message ID
   * @returns {Promise<boolean>} - True if duplicate exists
   */
  async checkDuplicateMessage(messageId) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      if (!messageId) {
        return false;
      }

      const existingMessage = await this.models.PostBank.findOne({
        where: {
          post_id: messageId,
          source: 'whatsapp'
        }
      });

      return !!existingMessage;
    } catch (error) {
      console.error('Error checking duplicate message:', error);
      return false;
    }
  }

  /**
   * Update message status (for message updates from webhooks)
   * @param {string} messageId - WhatsApp message ID
   * @param {string} status - New status
   * @returns {Promise<boolean>} - Success status
   */
  async updateMessageStatus(messageId, status) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const [updatedRows] = await this.models.PostBank.update(
        { analysisStatus: status },
        {
          where: {
            post_id: messageId,
            source: 'whatsapp'
          }
        }
      );

      console.log(`✅ Updated ${updatedRows} message(s) with status: ${status}`);
      return updatedRows > 0;
    } catch (error) {
      console.error('Error updating message status:', error);
      return false;
    }
  }

  /**
   * Transform WhatsApp message data to PostBank model format with comprehensive mapping
   * Implements enhanced message data transformation for PostBank model
   * @param {Object} messageData - WhatsApp message from Wasender
   * @param {Object} groupInfo - Enhanced group information with metadata
   * @param {Object} userInfo - User information
   * @param {number} authorUserId - PostUser ID
   * @returns {Object} - PostBank data object with comprehensive mapping
   */
  transformMessageDataForPostBank(messageData, groupInfo, userInfo, authorUserId = null) {
    const messageTimestamp = new Date(messageData.messageTimestamp * 1000);
    const postDate = messageTimestamp.toISOString().split('T')[0]; // YYYY-MM-DD format
    const postTime = messageTimestamp.toLocaleTimeString('en-US', { hour12: false });

    // Extract comprehensive message text content
    const messageContent = this.extractComprehensiveMessageContent(messageData.message);

    // Determine message type with enhanced detection
    const messageType = this.determineMessageType(messageData.message);

    // Extract reply information for enhanced context
    const replyInfo = this.extractReplyInformation(messageData.message);

    // Extract mention information
    const mentionInfo = this.extractMentionInformation(messageData.message);

    // Generate comprehensive unique hash for duplicate detection
    const uniqueHash = this.generateEnhancedMessageHash(messageData, groupInfo, userInfo);

    // Extract device and platform information
    const deviceInfo = this.extractDeviceInformation(messageData);

    return {
      // Core message identification
      post_id: messageData.key?.id,
      post_title: this.generateMessageTitle(messageContent, messageType),
      post_snippet: messageContent.text,
      post_url: '', // WhatsApp messages don't have URLs

      // Source information
      core_source: 'whatsapp',
      source: 'whatsapp',

      // Timestamp information
      post_timestamp: messageTimestamp,
      post_date: postDate,
      post_time: postTime,

      // Author information with enhanced mapping
      author_name: groupInfo?.groupName || groupInfo?.name || 'Unknown Group',
      author_username: userInfo?.displayName || userInfo?.phoneNumber || 'Unknown User',
      author_user_id: authorUserId,

      // Content metadata
      post_language: this.detectMessageLanguage(messageContent.text),
      post_location: this.extractLocationInfo(messageData.message),
      post_type: messageType,

      // Engagement metrics (initialized to 0 for WhatsApp)
      retweets: 0,
      bookmarks: 0,
      comments: 0,
      likes: 0,
      views: 0,

      // Enhanced attachment information
      attachments: this.hasAttachments(messageData.message) ? this.getAttachmentCount(messageData.message) : null,

      // Mention and hashtag information
      mention_ids: mentionInfo.mentionIds,
      mention_hashtags: mentionInfo.hashtags,

      // Search and categorization
      keyword: this.extractKeywords(messageContent.text),
      unique_hash: uniqueHash,

      // Media specific fields
      video_id: null, // WhatsApp doesn't use video IDs
      duration: this.extractMediaDuration(messageData.message),

      // Categorization
      category_id: null, // To be set by analysis later

      // WhatsApp specific fields
      channel_id: groupInfo?.groupId || groupInfo?.id,
      mobile_number: userInfo?.phoneNumber,
      group_id: groupInfo?.groupId || groupInfo?.id,

      // Reply information with enhanced extraction
      reply_to_message_id: replyInfo.quotedMessageId,
      reply_text: replyInfo.quotedText,

      // Attachment flags
      photo_attachment: messageType === 'image',
      video_attachment: messageType === 'video',
      audio_attachment: messageType === 'audio',
      document_attachment: messageType === 'document',

      // Processing status with enhanced tracking
      analysisStatus: 'PENDING_ANALYSIS',
      processingStatus: 'PROCESSING',

      // Device and platform information
      device_source: deviceInfo.deviceType,
      client_version: deviceInfo.clientVersion,

      // Message context
      is_reply: replyInfo.isReply,
      is_forwarded: this.isForwardedMessage(messageData.message),
      is_from_me: messageData.key?.fromMe || false,

      // Group context
      group_name: groupInfo?.groupName,
      group_participant_count: groupInfo?.participantCount,

      // Timestamps for tracking
      created_at: new Date(),
      updated_at: new Date()
    };
  }

  /**
   * Process message attachments using AttachmentProcessingService
   * @param {Object} messageData - WhatsApp message data
   * @param {number} postBankId - PostBank record ID
   * @param {Object} groupInfo - Group information
   * @param {Object} userInfo - User information
   * @param {Object} transaction - Database transaction
   */
  async processMessageAttachments(messageData, postBankId, groupInfo, userInfo, transaction) {
    const message = messageData.message;
    const attachments = [];

    // Process different types of attachments
    if (message.imageMessage) {
      attachments.push({
        type: 'image',
        mimeType: message.imageMessage.mimetype,
        url: message.imageMessage.url,
        mediaKey: message.imageMessage.mediaKey,
        fileSha256: message.imageMessage.fileSha256,
        fileName: message.imageMessage.caption || 'image',
        groupId: groupInfo?.groupId || groupInfo?.id,
        senderPhone: userInfo?.phoneNumber
      });
    }

    if (message.videoMessage) {
      attachments.push({
        type: 'video',
        mimeType: message.videoMessage.mimetype,
        url: message.videoMessage.url,
        mediaKey: message.videoMessage.mediaKey,
        fileSha256: message.videoMessage.fileSha256,
        fileName: message.videoMessage.caption || 'video',
        groupId: groupInfo?.groupId || groupInfo?.id,
        senderPhone: userInfo?.phoneNumber
      });
    }

    if (message.audioMessage) {
      attachments.push({
        type: 'audio',
        mimeType: message.audioMessage.mimetype,
        url: message.audioMessage.url,
        mediaKey: message.audioMessage.mediaKey,
        fileSha256: message.audioMessage.fileSha256,
        fileName: 'audio',
        groupId: groupInfo?.groupId || groupInfo?.id,
        senderPhone: userInfo?.phoneNumber
      });
    }

    if (message.documentMessage) {
      attachments.push({
        type: 'document',
        mimeType: message.documentMessage.mimetype,
        url: message.documentMessage.url,
        mediaKey: message.documentMessage.mediaKey,
        fileSha256: message.documentMessage.fileSha256,
        fileName: message.documentMessage.fileName || 'document',
        groupId: groupInfo?.groupId || groupInfo?.id,
        senderPhone: userInfo?.phoneNumber
      });
    }

    if (message.stickerMessage) {
      attachments.push({
        type: 'sticker',
        mimeType: message.stickerMessage.mimetype,
        url: message.stickerMessage.url,
        mediaKey: message.stickerMessage.mediaKey,
        fileSha256: message.stickerMessage.fileSha256,
        fileName: 'sticker',
        groupId: groupInfo?.groupId || groupInfo?.id,
        senderPhone: userInfo?.phoneNumber
      });
    }

    // Use AttachmentProcessingService if available
    if (this.attachmentProcessingService) {
      const results = await this.attachmentProcessingService.processMultipleAttachments(
        attachments,
        postBankId,
        groupInfo,
        userInfo,
        transaction
      );

      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      console.log(`✅ Processed ${successCount} attachment(s) successfully`);
      if (failedCount > 0) {
        console.log(`⚠️ Failed to process ${failedCount} attachment(s)`);
      }

      return results;
    } else {
      // Fallback to legacy attachment processing
      for (const attachmentData of attachments) {
        await this.saveAttachment(attachmentData, postBankId, transaction);
      }

      console.log(`✅ Processed ${attachments.length} attachment(s) using legacy method`);
      return attachments.map(a => ({ success: true, attachmentType: a.type }));
    }
  }

  /**
   * Check if message has attachments
   * @param {Object} message - WhatsApp message object
   * @returns {boolean} - True if message has attachments
   */
  hasAttachments(message) {
    return !!(message.imageMessage || message.videoMessage ||
      message.audioMessage || message.documentMessage);
  }

  /**
   * Determine message type from WhatsApp message data
   * @param {Object} message - WhatsApp message object
   * @returns {string} - Message type
   */
  determineMessageType(message) {
    if (!message) return 'text';

    if (message.imageMessage) return 'image';
    if (message.videoMessage) return 'video';
    if (message.audioMessage) return 'audio';
    if (message.documentMessage) return 'document';
    if (message.conversation || message.extendedTextMessage) return 'text';

    return 'unknown';
  }

  /**
   * Generate unique hash for message (for duplicate detection)
   * @param {Object} messageData - WhatsApp message data
   * @returns {string} - MD5 hash
   */
  generateMessageHash(messageData) {
    const hashData = {
      id: messageData.key?.id,
      remoteJid: messageData.key?.remoteJid,
      timestamp: messageData.messageTimestamp
    };

    return crypto.createHash('md5').update(JSON.stringify(hashData)).digest('hex');
  }

  /**
   * Process and store group metadata with enhanced information extraction
   * Implements group metadata extraction and storage for comprehensive group tracking
   * @param {Object} groupInfo - Basic group information
   * @param {Object} messageData - Full message data for additional context
   * @param {Object} transaction - Database transaction
   * @returns {Promise<Object>} Enhanced group information
   */
  async processGroupMetadata(groupInfo, messageData, transaction) {
    try {
      // Extract enhanced group information
      const enhancedGroupInfo = {
        groupId: groupInfo?.groupId || groupInfo?.id || messageData.key?.remoteJid,
        groupName: groupInfo?.groupName || groupInfo?.name || this.extractGroupNameFromMessage(messageData),
        groupJid: messageData.key?.remoteJid,
        isGroup: true,
        participantCount: groupInfo?.participantCount || null,
        groupDescription: groupInfo?.description || null,
        groupCreatedAt: groupInfo?.createdAt || null,
        lastMessageTimestamp: new Date(messageData.messageTimestamp * 1000),
        extractedAt: new Date()
      };

      // Log group metadata processing
      console.log('📊 Processing group metadata:', {
        groupId: enhancedGroupInfo.groupId,
        groupName: enhancedGroupInfo.groupName,
        participantCount: enhancedGroupInfo.participantCount
      });

      return enhancedGroupInfo;
    } catch (error) {
      console.error('Error processing group metadata:', error);
      // Return basic group info as fallback
      return {
        groupId: groupInfo?.groupId || groupInfo?.id || messageData.key?.remoteJid,
        groupName: groupInfo?.groupName || groupInfo?.name || 'Unknown Group',
        groupJid: messageData.key?.remoteJid,
        isGroup: true
      };
    }
  }

  /**
   * Extract comprehensive message content from WhatsApp message
   * @param {Object} message - WhatsApp message object
   * @returns {Object} Comprehensive message content
   */
  extractComprehensiveMessageContent(message) {
    if (!message || typeof message !== 'object') {
      return { text: '', type: 'unknown', hasContent: false };
    }

    let messageText = '';
    let contentType = 'text';

    // Extract text from different message types
    if (message.conversation) {
      messageText = message.conversation;
      contentType = 'text';
    } else if (message.extendedTextMessage) {
      messageText = message.extendedTextMessage.text || '';
      contentType = 'extended_text';
    } else if (message.imageMessage) {
      messageText = message.imageMessage.caption || '';
      contentType = 'image';
    } else if (message.videoMessage) {
      messageText = message.videoMessage.caption || '';
      contentType = 'video';
    } else if (message.audioMessage) {
      messageText = ''; // Audio messages typically don't have text
      contentType = 'audio';
    } else if (message.documentMessage) {
      messageText = message.documentMessage.caption || message.documentMessage.fileName || '';
      contentType = 'document';
    } else if (message.stickerMessage) {
      messageText = ''; // Stickers don't have text
      contentType = 'sticker';
    } else if (message.locationMessage) {
      messageText = `Location: ${message.locationMessage.degreesLatitude}, ${message.locationMessage.degreesLongitude}`;
      contentType = 'location';
    } else if (message.contactMessage) {
      messageText = `Contact: ${message.contactMessage.displayName || 'Unknown'}`;
      contentType = 'contact';
    }

    return {
      text: messageText || '',
      type: contentType,
      hasContent: !!messageText,
      rawMessage: message
    };
  }

  /**
   * Extract reply information with enhanced context
   * @param {Object} message - WhatsApp message object
   * @returns {Object} Reply information
   */
  extractReplyInformation(message) {
    const replyInfo = {
      isReply: false,
      quotedMessageId: null,
      quotedText: null,
      quotedParticipant: null,
      quotedMessageType: null
    };

    if (!message || !message.extendedTextMessage || !message.extendedTextMessage.contextInfo) {
      return replyInfo;
    }

    const contextInfo = message.extendedTextMessage.contextInfo;

    if (contextInfo.stanzaId && contextInfo.quotedMessage) {
      replyInfo.isReply = true;
      replyInfo.quotedMessageId = contextInfo.stanzaId;
      replyInfo.quotedParticipant = contextInfo.participant;

      // Extract quoted text and determine quoted message type
      const quotedMessage = contextInfo.quotedMessage;
      if (quotedMessage.conversation) {
        replyInfo.quotedText = quotedMessage.conversation;
        replyInfo.quotedMessageType = 'text';
      } else if (quotedMessage.extendedTextMessage) {
        replyInfo.quotedText = quotedMessage.extendedTextMessage.text;
        replyInfo.quotedMessageType = 'extended_text';
      } else if (quotedMessage.imageMessage) {
        replyInfo.quotedText = quotedMessage.imageMessage.caption || '[Image]';
        replyInfo.quotedMessageType = 'image';
      } else if (quotedMessage.videoMessage) {
        replyInfo.quotedText = quotedMessage.videoMessage.caption || '[Video]';
        replyInfo.quotedMessageType = 'video';
      } else if (quotedMessage.audioMessage) {
        replyInfo.quotedText = '[Audio]';
        replyInfo.quotedMessageType = 'audio';
      } else if (quotedMessage.documentMessage) {
        replyInfo.quotedText = quotedMessage.documentMessage.caption || '[Document]';
        replyInfo.quotedMessageType = 'document';
      }
    }

    return replyInfo;
  }

  /**
   * Extract mention information from message
   * @param {Object} message - WhatsApp message object
   * @returns {Object} Mention information
   */
  extractMentionInformation(message) {
    const mentionInfo = {
      mentionIds: null,
      hashtags: null,
      hasMentions: false,
      hasHashtags: false
    };

    // Extract mentions from extended text message
    if (message && message.extendedTextMessage && message.extendedTextMessage.contextInfo) {
      const contextInfo = message.extendedTextMessage.contextInfo;
      if (contextInfo.mentionedJid && contextInfo.mentionedJid.length > 0) {
        mentionInfo.mentionIds = contextInfo.mentionedJid.join(',');
        mentionInfo.hasMentions = true;
      }
    }

    // Extract hashtags from message text
    const messageText = this.extractComprehensiveMessageContent(message).text;
    if (messageText) {
      const hashtagMatches = messageText.match(/#\w+/g);
      if (hashtagMatches && hashtagMatches.length > 0) {
        mentionInfo.hashtags = hashtagMatches.join(',');
        mentionInfo.hasHashtags = true;
      }
    }

    return mentionInfo;
  }

  /**
   * Generate enhanced unique hash for comprehensive duplicate detection
   * @param {Object} messageData - WhatsApp message data
   * @param {Object} groupInfo - Group information
   * @param {Object} userInfo - User information
   * @returns {string} Enhanced MD5 hash
   */
  generateEnhancedMessageHash(messageData, groupInfo, userInfo) {
    const hashData = {
      messageId: messageData.key?.id,
      remoteJid: messageData.key?.remoteJid,
      participant: messageData.key?.participant,
      timestamp: messageData.messageTimestamp,
      groupId: groupInfo?.groupId,
      senderId: userInfo?.userId,
      messageType: this.determineMessageType(messageData.message)
    };

    return crypto.createHash('md5').update(JSON.stringify(hashData)).digest('hex');
  }

  /**
   * Extract device information from message data
   * @param {Object} messageData - WhatsApp message data
   * @returns {Object} Device information
   */
  extractDeviceInformation(messageData) {
    return {
      deviceType: messageData.deviceType || null,
      clientVersion: messageData.clientVersion || null,
      platform: 'whatsapp'
    };
  }

  /**
   * Generate message title based on content and type
   * @param {Object} messageContent - Message content object
   * @param {string} messageType - Message type
   * @returns {string} Generated title
   */
  generateMessageTitle(messageContent, messageType) {
    if (messageContent.text && messageContent.text.length > 0) {
      // Use first 50 characters of message as title
      return messageContent.text.substring(0, 50) + (messageContent.text.length > 50 ? '...' : '');
    }

    // Generate title based on message type
    switch (messageType) {
      case 'image': return 'Image Message';
      case 'video': return 'Video Message';
      case 'audio': return 'Audio Message';
      case 'document': return 'Document Message';
      case 'sticker': return 'Sticker Message';
      case 'location': return 'Location Message';
      case 'contact': return 'Contact Message';
      default: return 'WhatsApp Message';
    }
  }

  /**
   * Detect message language (basic implementation)
   * @param {string} text - Message text
   * @returns {string} Language code
   */
  detectMessageLanguage(text) {
    if (!text || text.length === 0) {
      return 'unknown';
    }

    // Basic language detection - can be enhanced with proper language detection library
    const hindiPattern = /[\u0900-\u097F]/;
    const arabicPattern = /[\u0600-\u06FF]/;

    if (hindiPattern.test(text)) {
      return 'hi';
    } else if (arabicPattern.test(text)) {
      return 'ar';
    } else {
      return 'en'; // Default to English
    }
  }

  /**
   * Extract location information from message
   * @param {Object} message - WhatsApp message object
   * @returns {string|null} Location information
   */
  extractLocationInfo(message) {
    if (message && message.locationMessage) {
      return `${message.locationMessage.degreesLatitude},${message.locationMessage.degreesLongitude}`;
    }
    return null;
  }

  /**
   * Extract keywords from message text
   * @param {string} text - Message text
   * @returns {string|null} Comma-separated keywords
   */
  extractKeywords(text) {
    if (!text || text.length === 0) {
      return null;
    }

    // Simple keyword extraction - remove common words and extract meaningful terms
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['this', 'that', 'with', 'have', 'will', 'from', 'they', 'been', 'said', 'each', 'which', 'their'].includes(word));

    return words.length > 0 ? words.slice(0, 5).join(',') : null;
  }

  /**
   * Extract media duration from message
   * @param {Object} message - WhatsApp message object
   * @returns {number|null} Duration in seconds
   */
  extractMediaDuration(message) {
    if (message && message.audioMessage && message.audioMessage.seconds) {
      return message.audioMessage.seconds;
    }
    if (message && message.videoMessage && message.videoMessage.seconds) {
      return message.videoMessage.seconds;
    }
    return null;
  }

  /**
   * Get attachment count from message
   * @param {Object} message - WhatsApp message object
   * @returns {number} Number of attachments
   */
  getAttachmentCount(message) {
    let count = 0;
    if (message.imageMessage) count++;
    if (message.videoMessage) count++;
    if (message.audioMessage) count++;
    if (message.documentMessage) count++;
    if (message.stickerMessage) count++;
    return count;
  }

  /**
   * Check if message is forwarded
   * @param {Object} message - WhatsApp message object
   * @returns {boolean} True if forwarded
   */
  isForwardedMessage(message) {
    // Check for forwarded message indicators
    if (message && message.extendedTextMessage && message.extendedTextMessage.contextInfo) {
      return !!message.extendedTextMessage.contextInfo.forwardingScore;
    }
    return false;
  }

  /**
   * Extract group name from message data
   * @param {Object} messageData - Full message data
   * @returns {string|null} Group name
   */
  extractGroupNameFromMessage(messageData) {
    // Try to extract group name from various possible locations
    if (messageData.groupMetadata && messageData.groupMetadata.subject) {
      return messageData.groupMetadata.subject;
    }
    if (messageData.chat && messageData.chat.name) {
      return messageData.chat.name;
    }
    return null;
  }

  /**
   * Update message processing status with enhanced tracking
   * @param {number} postBankId - PostBank record ID
   * @param {string} status - Processing status
   * @param {Object} transaction - Database transaction
   * @param {string} messageId - Message ID for fallback lookup
   * @returns {Promise<boolean>} Success status
   */
  async updateMessageProcessingStatus(postBankId, status, transaction = null, messageId = null) {
    try {
      let updateCondition = {};

      if (postBankId) {
        updateCondition.id = postBankId;
      } else if (messageId) {
        updateCondition = {
          post_id: messageId,
          source: 'whatsapp'
        };
      } else {
        console.warn('No postBankId or messageId provided for status update');
        return false;
      }

      const updateData = {
        processingStatus: status,
        updated_at: new Date()
      };

      // Add status-specific fields
      if (status === 'PROCESSED') {
        updateData.analysisStatus = 'PENDING_ANALYSIS';
      } else if (status === 'FAILED') {
        updateData.analysisStatus = 'PROCESSING_FAILED';
      }

      const [updatedRows] = await this.models.PostBank.update(
        updateData,
        {
          where: updateCondition,
          transaction
        }
      );

      console.log(`✅ Updated message processing status to ${status} for ${updatedRows} record(s)`);
      return updatedRows > 0;
    } catch (error) {
      console.error('Error updating message processing status:', error);
      return false;
    }
  }

  /**
   * Determine if database operation should be retried
   * @param {Error} error - Database error
   * @returns {boolean} - True if should retry
   */
  shouldRetryOperation(error) {
    const retryableErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ER_LOCK_DEADLOCK',
      'ER_LOCK_WAIT_TIMEOUT'
    ];

    return retryableErrors.some(errorCode =>
      error.code === errorCode || error.message.includes(errorCode)
    );
  }

  // Legacy methods for backward compatibility
  /**
   * Get messages by group ID from PostBank
   * @param {string} groupId - Group ID
   * @param {number} limit - Maximum number of posts to retrieve
   * @param {number} offset - Offset for pagination
   */
  async getMessagesByGroup(groupId, limit = 100, offset = 0) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const posts = await this.models.PostBank.findAll({
        where: { group_id: groupId },
        include: [
          {
            model: this.models.CommonAttachment,
            as: 'commonAttachments',
            required: false
          },
          {
            model: this.models.PostUser,
            as: 'author',
            required: false
          }
        ],
        order: [['post_timestamp', 'DESC']],
        limit: limit,
        offset: offset
      });

      return posts;
    } catch (error) {
      console.error('Error getting posts by group:', error);
      throw error;
    }
  }

  /**
   * Get all groups with post counts from PostBank
   */
  async getAllGroups() {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const groups = await this.models.PostBank.findAll({
        attributes: [
          'group_id',
          'author_name',
          [this.models.sequelize.fn('COUNT', this.models.sequelize.col('id')), 'message_count'],
          [this.models.sequelize.fn('MAX', this.models.sequelize.col('post_timestamp')), 'last_message_time']
        ],
        where: {
          group_id: {
            [this.models.Sequelize.Op.ne]: null
          }
        },
        group: ['group_id', 'author_name'],
        order: [[this.models.sequelize.fn('MAX', this.models.sequelize.col('post_timestamp')), 'DESC']]
      });

      // Format the response to match the expected structure
      const formattedGroups = groups.map(group => ({
        group_id: group.group_id,
        group_name: group.author_name,
        message_count: parseInt(group.dataValues.message_count),
        last_message_time: group.dataValues.last_message_time
      }));

      return formattedGroups;
    } catch (error) {
      console.error('Error getting all groups:', error);
      throw error;
    }
  }

  /**
   * Get all messages with pagination from PostBank
   * @param {number} limit - Maximum number of posts to retrieve
   * @param {number} offset - Offset for pagination
   */
  async getAllMessages(limit = 100, offset = 0) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const posts = await this.models.PostBank.findAll({
        where: this.models.sequelize.where(
          this.models.sequelize.fn('LOWER', this.models.sequelize.col('source')),
          'whatsapp'
        ),
        include: [
          {
            model: this.models.CommonAttachment,
            as: 'commonAttachments',
            required: false
          },
          {
            model: this.models.PostUser,
            as: 'author',
            required: false
          }
        ],
        order: [['post_timestamp', 'DESC']],
        limit: limit,
        offset: offset
      });

      return posts;
    } catch (error) {
      console.error('Error getting all posts:', error);
      throw error;
    }
  }
}

module.exports = DatabaseService;