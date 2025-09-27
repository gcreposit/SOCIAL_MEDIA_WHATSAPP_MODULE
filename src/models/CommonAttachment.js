const { DataTypes } = require('sequelize');

/**
 * CommonAttachment Model - Handles all attachment types for PostBank
 * Stores attachment information from WhatsApp messages
 */
module.exports = (sequelize) => {
  const CommonAttachment = sequelize.define('CommonAttachment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // Foreign key to PostBank
    post_bank_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'post_bank',
        key: 'id'
      },
      onDelete: 'CASCADE',
      comment: 'References the post_bank record this attachment belongs to'
    },
    
    // Attachment type
    attachment_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      comment: 'Type of attachment: image, video, audio, document, link, batch'
    },
    
    // File paths for different attachment types
    image_attachment_path: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Path to image attachment file'
    },
    
    document_attachment_path: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Path to document attachment file'
    },
    
    video_attachment_path: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Path to video attachment file'
    },
    
    audio_attachment_path: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Path to audio attachment file'
    },
    
    // Metadata fields
    link_metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Metadata for link attachments'
    },
    
    // Reply attachment information
    reply_attachment_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Type of attachment in replied message'
    },
    
    reply_attachment_path: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Path to replied message attachment'
    },
    
    // File information
    mime_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'MIME type of the attachment'
    },
    
    // WhatsApp specific fields from original messages table
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: 'Timestamp from original WhatsApp message'
    },
    
    group_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: 'WhatsApp group ID'
    },
    
    mobile_number: {
      type: DataTypes.STRING(20),
      allowNull: true,
      comment: 'Mobile number of the sender'
    },
    
    // Status and processing information
    download_status: {
      type: DataTypes.STRING(20),
      defaultValue: 'PENDING',
      comment: 'Status of attachment download: PENDING, DOWNLOADED, FAILED'
    },
    
    processing_status: {
      type: DataTypes.STRING(20),
      defaultValue: 'NOT_PROCESSED',
      comment: 'Status of attachment processing: NOT_PROCESSED, PROCESSING, PROCESSED, FAILED'
    },
    
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Error message if download or processing failed'
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
    tableName: 'common_attachments',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        fields: ['post_bank_id']
      },
      {
        fields: ['attachment_type']
      },
      {
        fields: ['download_status']
      },
      {
        fields: ['processing_status']
      },
      {
        fields: ['group_id']
      },
      {
        fields: ['timestamp']
      },
      {
        fields: ['mobile_number']
      }
    ]
  });

  // Define associations
  CommonAttachment.associate = (models) => {
    // Many-to-one relationship with PostBank
    CommonAttachment.belongsTo(models.PostBank, {
      foreignKey: 'post_bank_id',
      as: 'postBank'
    });
  };

  return CommonAttachment;
};