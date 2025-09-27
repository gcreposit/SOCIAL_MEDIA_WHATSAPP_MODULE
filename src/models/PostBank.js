const { DataTypes } = require('sequelize');

/**
 * PostBank Model - Replaces messages table for WhatsApp integration
 * Maps WhatsApp messages to a standardized post format
 */
module.exports = (sequelize) => {
  const PostBank = sequelize.define('PostBank', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // Post content fields
    post_title: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Will be blank for WhatsApp messages'
    },
    
    post_snippet: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'Contains message_text from WhatsApp'
    },
    
    post_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'URL if any in the message'
    },
    
    // Source identification
    core_source: {
      type: DataTypes.STRING(255),
      defaultValue: 'WhatsApp',
      comment: 'Always WhatsApp for this integration'
    },
    
    source: {
      type: DataTypes.STRING(255),
      defaultValue: 'WhatsApp',
      comment: 'Always WhatsApp for this integration'
    },
    
    // Timestamp fields
    post_timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      comment: 'Original message timestamp from WhatsApp'
    },
    
    post_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      comment: 'Date in dd/mm/yyyy format when data was received'
    },
    
    post_time: {
      type: DataTypes.TIME,
      allowNull: false,
      comment: 'Time when message was received in 24-hour format'
    },
    
    // Author information
    author_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Group name from WhatsApp'
    },
    
    author_username: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Sender name from WhatsApp'
    },
    
    // Language and location
    post_language: {
      type: DataTypes.STRING(50),
      defaultValue: 'hi',
      comment: 'Hindi as default for WhatsApp news'
    },
    
    post_location: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Not used for WhatsApp, kept null'
    },
    
    // Post type
    post_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'Type of WhatsApp message (text, image, video, etc.)'
    },
    
    // Social media metrics (not applicable for WhatsApp, kept for compatibility)
    retweets: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    bookmarks: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    comments: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    likes: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    
    views: {
      type: DataTypes.BIGINT,
      defaultValue: 0
    },
    
    // Metadata fields (not used for WhatsApp)
    attachments: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    mention_ids: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    mention_hashtags: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    
    keyword: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    
    unique_hash: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    
    video_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    
    duration: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    
    category_id: {
      type: DataTypes.STRING(10),
      allowNull: true
    },
    
    channel_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    
    post_id: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    
    // Analysis status for new WhatsApp messages
    analysisStatus: {
      type: DataTypes.STRING(20),
      defaultValue: 'NOT_ANALYZED',
      comment: 'Analysis status for new WhatsApp messages'
    },
    
    // WhatsApp specific fields for reference
    mobile_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Mobile number from original WhatsApp message'
    },
    
    group_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'WhatsApp group ID for reference'
    },
    
    reply_to_message_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'ID of message being replied to'
    },
    
    reply_text: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Text of the message being replied to'
    },
    
    // Attachment references (will be handled by CommonAttachment table)
    photo_attachment: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Indicates if message has photo attachment'
    },
    
    video_attachment: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Indicates if message has video attachment'
    },
    
    // Timestamps
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'post_bank',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
    // Indexes removed to prevent duplicate key errors
    // Existing indexes in database will be used
  });

  // AUTO-MIGRATION FUNCTION - Ensures WhatsApp-specific fields are added to existing table
  PostBank.autoMigrate = async () => {
    try {
      console.log('Starting PostBank auto-migration...');
      const queryInterface = sequelize.getQueryInterface();
      
      // Check if table exists first
      const tables = await queryInterface.showAllTables();
      if (!tables.includes('post_bank')) {
        console.log('post_bank table does not exist, will be created by sync()');
        return;
      }

      // Get existing columns
      const tableInfo = await queryInterface.describeTable('post_bank');
      console.log('Existing columns in post_bank:', Object.keys(tableInfo));
      
      // Define ALL WhatsApp-specific columns that need to be added
      const whatsappColumns = {
        mobile_number: {
          type: DataTypes.STRING(20),
          allowNull: true,
          comment: 'Mobile number from original WhatsApp message'
        },
        group_id: {
          type: DataTypes.STRING(100),
          allowNull: true,
          comment: 'WhatsApp group ID for reference'
        },
        reply_to_message_id: {
          type: DataTypes.STRING(100),
          allowNull: true,
          comment: 'ID of message being replied to'
        },
        reply_text: {
          type: DataTypes.TEXT,
          allowNull: true,
          comment: 'Text of the message being replied to'
        },
        created_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW,
          comment: 'Record creation timestamp'
        },
        updated_at: {
          type: DataTypes.DATE,
          defaultValue: DataTypes.NOW,
          comment: 'Record update timestamp'
        }
      };

      // Add missing columns
      let columnsAdded = 0;
      for (const [columnName, columnDef] of Object.entries(whatsappColumns)) {
        if (!tableInfo[columnName]) {
          console.log(`Adding missing column: ${columnName}`);
          await queryInterface.addColumn('post_bank', columnName, columnDef);
          columnsAdded++;
        } else {
          console.log(`Column ${columnName} already exists, skipping...`);
        }
      }

      console.log(`PostBank auto-migration completed. ${columnsAdded} columns added.`);
    } catch (error) {
      console.error('Error during PostBank auto-migration:', error);
      // Don't throw error to prevent app crash
    }
  };

  return PostBank;
};