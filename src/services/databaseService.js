/**
 * Database Service
 * Handles all MySQL database operations
 */

const mysql = require('mysql2/promise');

class DatabaseService {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  /**
   * Connect to MySQL database
   */
  async connect() {
    try {
      this.pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 3306,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
      });

      // Test connection
      const connection = await this.pool.getConnection();
      connection.release();
      this.isConnected = true;
      
      // Create tables if they don't exist
      await this.initializeTables();
      
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
    if (this.pool) {
      await this.pool.end();
      this.isConnected = false;
      console.log('Database disconnected');
    }
  }

  /**
   * Initialize database tables
   */
  async initializeTables() {
    const createMessagesTable = `
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id VARCHAR(255) NOT NULL,
        group_name VARCHAR(255),
        sender_name VARCHAR(255) NOT NULL,
        message_text TEXT NOT NULL,
        timestamp DATETIME NOT NULL,
        image_attachment_path VARCHAR(255),
        document_attachment_path VARCHAR(255),
        video_attachment_path VARCHAR(255),
        audio_attachment_path VARCHAR(255),
        link_metadata JSON,
        batch_attachment_path VARCHAR(255),
        batch_metadata JSON,
        reply_to_message_id VARCHAR(255),
        reply_text TEXT,
        reply_attachment_type VARCHAR(50),
        reply_attachment_path VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_group_id (group_id),
        INDEX idx_timestamp (timestamp),
        INDEX idx_reply_to_message_id (reply_to_message_id)
      );
    `;

    // Check and add new columns if they don't exist
    const checkAndAddColumns = [
      { name: 'video_attachment_path', definition: 'VARCHAR(255)' },
      { name: 'audio_attachment_path', definition: 'VARCHAR(255)' },
      { name: 'link_metadata', definition: 'JSON' },
      { name: 'batch_attachment_path', definition: 'VARCHAR(255)' },
      { name: 'batch_metadata', definition: 'JSON' },
      { name: 'reply_to_message_id', definition: 'VARCHAR(255)' },
      { name: 'reply_text', definition: 'TEXT' },
      { name: 'reply_attachment_type', definition: 'VARCHAR(50)' },
      { name: 'reply_attachment_path', definition: 'VARCHAR(255)' },
      { name: 'attachment_type', definition: 'VARCHAR(50)' }
    ];
    
    try {
      // Create the messages table if it doesn't exist
      await this.pool.query(createMessagesTable);
      
      // Check for each column and add if it doesn't exist
      for (const column of checkAndAddColumns) {
        const [rows] = await this.pool.query(`
          SELECT COUNT(*) as count 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'messages' 
          AND COLUMN_NAME = ?
        `, [column.name]);
        
        if (rows[0].count === 0) {
          console.log(`Adding column ${column.name} to messages table...`);
          await this.pool.query(`ALTER TABLE messages ADD COLUMN ${column.name} ${column.definition}`);
          console.log(`Column ${column.name} added successfully.`);
        }
      }
      
      // Check if link_attachment_path exists and remove it if it does
      const [linkPathRows] = await this.pool.query(`
        SELECT COUNT(*) as count 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'messages' 
        AND COLUMN_NAME = 'link_attachment_path'
      `);
      
      if (linkPathRows[0].count > 0) {
        console.log('Removing deprecated link_attachment_path column...');
        await this.pool.query('ALTER TABLE messages DROP COLUMN link_attachment_path');
        console.log('Column link_attachment_path removed successfully.');
      }
      
      console.log('Database tables initialized successfully');
    } catch (error) {
      console.error('Error initializing database tables:', error);
      throw error;
    }

    try {
      await this.pool.query(createMessagesTable);
      
      // Check and add columns if they don't exist
      for (const column of checkAndAddColumns) {
        try {
          // Check if column exists
          const [rows] = await this.pool.query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE() 
            AND TABLE_NAME = 'messages' 
            AND COLUMN_NAME = ?
          `, [column.name]);
          
          // If column doesn't exist, add it
          if (rows[0].count === 0) {
            await this.pool.query(`ALTER TABLE messages ADD COLUMN ${column.name} ${column.definition}`);
            console.log(`Added column ${column.name} to messages table`);
          }
        } catch (alterError) {
          // Log error but continue with other columns
          console.error(`Error checking/adding column ${column.name}:`, alterError);
        }
      }
      
      console.log('Database tables initialized and updated with new columns');
    } catch (error) {
      console.error('Error initializing tables:', error);
      throw error;
    }
  }

  /**
   * Save message to database
   * @param {string} groupId - Group ID
   * @param {string} groupName - Group name
   * @param {string} senderName - Sender name
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
  async saveMessage(groupId, groupName, senderName, messageText, timestamp, 
    imageAttachmentPath = null, documentAttachmentPath = null, videoAttachmentPath = null, 
    audioAttachmentPath = null, linkMetadata = null, batchAttachmentPath = null, batchMetadata = null,
    replyToMessageId = null, replyText = null, replyAttachmentType = null, replyAttachmentPath = null,
    attachmentType = null) {
    
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const query = `
        INSERT INTO messages 
        (group_id, group_name, sender_name, message_text, timestamp, 
         image_attachment_path, document_attachment_path, video_attachment_path, audio_attachment_path, 
         link_metadata, batch_attachment_path, batch_metadata,
         reply_to_message_id, reply_text, reply_attachment_type, reply_attachment_path, attachment_type) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      // Convert JSON objects to strings if they exist
      console.log('Link metadata before stringify:', linkMetadata);
      
      // Ensure linkMetadata is not null or undefined before stringifying
      let linkMetadataStr = null;
      if (linkMetadata) {
        // If it's an empty array, create a default metadata object
        if (Array.isArray(linkMetadata) && linkMetadata.length === 0) {
          linkMetadata = [{
            url: 'No URL provided',
            title: 'No title',
            description: 'No description'
          }];
        }
        linkMetadataStr = JSON.stringify(linkMetadata);
      }
      
      console.log('Link metadata after stringify:', linkMetadataStr);
      const batchMetadataStr = batchMetadata ? JSON.stringify(batchMetadata) : null;
      
      const [result] = await this.pool.query(query, [
        groupId,
        groupName,
        senderName,
        messageText,
        timestamp,
        imageAttachmentPath,
        documentAttachmentPath,
        videoAttachmentPath,
        audioAttachmentPath,
        linkMetadataStr,
        batchAttachmentPath,
        batchMetadataStr,
        replyToMessageId,
        replyText,
        replyAttachmentType,
        replyAttachmentPath,
        attachmentType
      ]);
      
      return result.insertId;
    } catch (error) {
      console.error('Error saving message:', error);
      throw error;
    }
  }

  /**
   * Get messages by group ID
   * @param {string} groupId - Group ID
   * @param {number} limit - Maximum number of messages to retrieve
   * @param {number} offset - Offset for pagination
   */
  async getMessagesByGroup(groupId, limit = 100, offset = 0) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const query = `
        SELECT * FROM messages 
        WHERE group_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ? OFFSET ?
      `;
      
      const [rows] = await this.pool.query(query, [groupId, limit, offset]);
      return rows;
    } catch (error) {
      console.error('Error getting messages by group:', error);
      throw error;
    }
  }

  /**
   * Get all groups with message counts
   */
  async getAllGroups() {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const query = `
        SELECT 
          group_id, 
          group_name, 
          COUNT(*) as message_count, 
          MAX(timestamp) as last_message_time 
        FROM messages 
        GROUP BY group_id, group_name 
        ORDER BY last_message_time DESC
      `;
      
      const [rows] = await this.pool.query(query);
      return rows;
    } catch (error) {
      console.error('Error getting all groups:', error);
      throw error;
    }
  }

  /**
   * Get all messages with pagination
   * @param {number} limit - Maximum number of messages to retrieve
   * @param {number} offset - Offset for pagination
   */
  async getAllMessages(limit = 100, offset = 0) {
    if (!this.isConnected) {
      await this.reconnect();
    }

    try {
      const query = `
        SELECT * FROM messages 
        ORDER BY timestamp DESC 
        LIMIT ? OFFSET ?
      `;
      
      const [rows] = await this.pool.query(query, [limit, offset]);
      return rows;
    } catch (error) {
      console.error('Error getting all messages:', error);
      throw error;
    }
  }
}

module.exports = DatabaseService;