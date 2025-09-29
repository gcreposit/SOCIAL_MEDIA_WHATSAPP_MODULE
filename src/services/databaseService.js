/**
 * Database Service
 * Handles all database operations using Sequelize ORM with PostBank and CommonAttachment models
 */

const { Sequelize } = require('sequelize');
const { initializeModels } = require('../models');

class DatabaseService {
  constructor() {
    this.sequelize = null;
    this.models = null;
    this.isConnected = false;
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
          logging: false, // Set to console.log to see SQL queries
          pool: {
            max: 10,
            min: 0,
            acquire: 30000,
            idle: 10000
          }
        }
      );

      // Test connection
      await this.sequelize.authenticate();
      console.log('✅ Database connection test successful');
      
      // Initialize models
      this.models = initializeModels(this.sequelize);
      
      // Sync database (create tables if they don't exist, but don't alter existing ones)
      await this.sequelize.sync({ force: false }); // Don't alter existing tables to avoid duplicate column errors
      console.log('✅ Database models synchronized without altering existing tables');
      
      // Run auto-migration for PostBank to add missing WhatsApp-specific columns
      await this.models.PostBank.autoMigrate();
      console.log('✅ PostBank auto-migration completed');
      
      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('Database connection error:', error);
      this.isConnected = false;
      // Attempt reconnection after delay
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
        // Try again after delay
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
   * Save message to PostBank with attachments in CommonAttachment table
   * @param {string} groupId - Group ID
   * @param {string} groupName - Group name
   * @param {string} senderName - Sender name
   * @param {string} mobileNumber - Mobile number
   * @param {string} messageText - Message content
   * @param {Date} timestamp - Message timestamp
   * @param {string} imageAttachmentPath - Path to image attachment (optional)
   * @param {string} documentAttachmentPath - Path to document attachment (optional)
   * @param {string} videoAttachmentPath - Path to video attachment (optional)
   * @param {string} audioAttachmentPath - Path to audio attachment (optional)
   * @param {Object} linkMetadata - Metadata for link attachment (optional)
   * @param {string} batchAttachmentPath - Path to batch attachment JSON (optional)
   * @param {Object} batchMetadata - Metadata for batch attachments (optional)
   * @param {string} replyToMessageId - ID of the message being replied to (optional)
   * @param {string} replyText - Text of the message being replied to (optional)
   * @param {string} replyAttachmentType - Type of attachment in the replied message (optional)
   * @param {string} replyAttachmentPath - Path to attachment in the replied message (optional)
   * @param {string} attachmentType - Unified type of attachment (optional)
   */
  async saveMessage(groupId, groupName, senderName, mobileNumber, messageText, timestamp, 
    imageAttachmentPath = null, documentAttachmentPath = null, videoAttachmentPath = null, 
    audioAttachmentPath = null, linkMetadata = null, batchAttachmentPath = null, batchMetadata = null,
    replyToMessageId = null, replyText = null, replyAttachmentType = null, replyAttachmentPath = null,
    attachmentType = null) {
    
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      console.log('📝 Preparing data for PostBank insertion:');
      console.log('- Group ID:', groupId);
      console.log('- Group Name:', groupName);
      console.log('- Sender:', senderName);
      console.log('- Mobile Number:', mobileNumber);
      console.log('- Message Text Length:', messageText ? messageText.length : 0);

      // Format date and time for post_date and post_time
      const messageDate = new Date(timestamp);
      const postDate = messageDate.toLocaleDateString('en-GB'); // dd/mm/yyyy format
      const postTime = messageDate.toLocaleTimeString('en-US', { hour12: false }); // HH:mm:ss format

      // Create PostBank record
      const postBankData = {
        post_title: '', // Blank as specified
        post_snippet: messageText || '',
        post_url: '',
        core_source: 'Whatsapp',
        source: 'Whatsapp',
        post_timestamp: timestamp,
        photo_attachment: imageAttachmentPath ? true : false,
        video_attachment: videoAttachmentPath ? true : false,
        post_date: postDate,
        post_time: postTime,
        author_name: groupName || '',
        author_username: senderName || '',
        post_language: 'hi',
        post_location: null,
        post_type: null,
        retweets: null,
        bookmarks: null,
        comments: null,
        likes: null,
        views: null,
        attachments: null,
        mention_ids: null,
        mention_hashtags: null,
        keyword: null,
        unique_hash: null,
        video_id: null,
        duration: null,
        category_id: null,
        channel_id: null,
        analysisStatus: 'NOT_ANALYZED', // Default for new WhatsApp messages
        post_id: null,
        // WhatsApp specific fields
        mobile_number: mobileNumber,
        group_id: groupId,
        reply_to_message_id: replyToMessageId,
        reply_text: replyText
      };

      console.log('🔄 Creating PostBank record...');
      const postBankRecord = await this.models.PostBank.create(postBankData);
      console.log('✅ PostBank record created with ID:', postBankRecord.id);

      // Create attachment records if any attachments exist
      const attachments = [];
      
      if (imageAttachmentPath || documentAttachmentPath || videoAttachmentPath || 
          audioAttachmentPath || batchAttachmentPath || linkMetadata) {
        
        const attachmentData = {
          post_bank_id: postBankRecord.id,
          attachment_type: attachmentType || this.determineAttachmentType({
            imageAttachmentPath,
            documentAttachmentPath,
            videoAttachmentPath,
            audioAttachmentPath,
            batchAttachmentPath,
            linkMetadata
          }),
          image_attachment_path: imageAttachmentPath,
          document_attachment_path: documentAttachmentPath,
          video_attachment_path: videoAttachmentPath,
          audio_attachment_path: audioAttachmentPath,
          batch_attachment_path: batchAttachmentPath,
          link_metadata: linkMetadata,
          batch_metadata: batchMetadata,
          reply_attachment_type: replyAttachmentType,
          reply_attachment_path: replyAttachmentPath,
          timestamp: timestamp,
          group_id: groupId,
          group_name: groupName,
          sender_name: senderName,
          mobile_number: mobileNumber,
          reply_to_message_id: replyToMessageId,
          download_status: 'DOWNLOADED', // Assuming files are already downloaded
          processing_status: 'NOT_PROCESSED'
        };

        console.log('🔄 Creating CommonAttachment record...');
        const attachmentRecord = await this.models.CommonAttachment.create(attachmentData);
        console.log('✅ CommonAttachment record created with ID:', attachmentRecord.id);
        attachments.push(attachmentRecord);
      }

      console.log('✅ MESSAGE SAVE SUCCESSFUL!');
      console.log('PostBank ID:', postBankRecord.id);
      console.log('Attachments created:', attachments.length);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      return postBankRecord.id;
    } catch (error) {
      console.error('Error saving message to PostBank:', error);
      throw error;
    }
  }

  /**
   * Determine attachment type based on available attachment paths
   * @param {Object} attachments - Object containing attachment paths
   * @returns {string} - Attachment type
   */
  determineAttachmentType(attachments) {
    if (attachments.imageAttachmentPath) return 'image';
    if (attachments.videoAttachmentPath) return 'video';
    if (attachments.audioAttachmentPath) return 'audio';
    if (attachments.documentAttachmentPath) return 'document';
    if (attachments.batchAttachmentPath) return 'batch';
    if (attachments.linkMetadata) return 'link';
    return 'text';
  }

  /**
   * Get posts by group ID from PostBank
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
        include: [{
          model: this.models.CommonAttachment,
          as: 'commonAttachments',
          required: false
        }],
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
   * Get all posts with pagination from PostBank
   * @param {number} limit - Maximum number of posts to retrieve
   * @param {number} offset - Offset for pagination
   */
  async getAllMessages(limit = 100, offset = 0) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      // Only fetch WhatsApp-sourced posts (case-insensitive)
      const posts = await this.models.PostBank.findAll({
        where: this.models.sequelize.where(
          this.models.sequelize.fn('LOWER', this.models.sequelize.col('source')),
          'whatsapp'
        ),
        include: [{
          model: this.models.CommonAttachment,
          as: 'commonAttachments',
          required: false
        }],
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