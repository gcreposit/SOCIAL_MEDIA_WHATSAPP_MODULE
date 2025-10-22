const { DataTypes } = require('sequelize');

/**
 * PostUser Model - Handles user information from WhatsApp messages
 * Stores sender details with platform-specific information
 */
module.exports = (sequelize) => {
  const PostUser = sequelize.define('PostUser', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    
    // Platform identification
    platform: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'whatsapp',
      comment: 'Source platform (whatsapp for this integration)'
    },
    
    // User identification
    platform_user_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
      comment: 'Platform-specific user identifier'
    },
    
    username: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Username on the platform'
    },
    
    display_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      comment: 'Display name of the user'
    },
    
    // Contact information
    mobile_number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Mobile phone number'
    },
    
    // Profile information from NEW_CHANGED_MODELS
    bio_description: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'User bio description'
    },
    
    profile_image_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Profile picture URL'
    },
    
    banner_image_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Banner image URL'
    },
    
    website_url: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Website URL'
    },
    
    location: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'User location'
    },
    
    // Social metrics
    followers_count: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Number of followers'
    },
    
    following_count: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Number of following'
    },
    
    posts_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Total posts count'
    },
    
    total_engagement: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Total engagement metrics'
    },
    
    // Verification and status
    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Whether user is verified'
    },
    
    is_private: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Whether account is private'
    },
    
    is_business: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Whether account is business'
    },
    
    account_status: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Account status'
    },
    
    platform_specific_data: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Platform-specific data as JSON'
    },
    
    profile_created_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When profile was created'
    },
    
    last_post_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Last post timestamp'
    },
    
    // NEW FIELDS from NEW_CHANGED_MODELS
    is_blue_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Twitter Blue verification'
    },
    
    verified_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'Type of verification (Government, Business, etc.)'
    },
    
    favourites_count: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: 'Total likes given'
    },
    
    media_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Total media posted'
    },
    
    statuses_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Status count (same as posts_count)'
    },
    
    fast_followers_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Fast followers count'
    },
    
    has_custom_timelines: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Has custom timelines'
    },
    
    is_translator: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Is translator'
    },
    
    can_dm: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Can receive direct messages'
    },
    
    can_media_tag: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: 'Can be tagged in media'
    },
    
    possibly_sensitive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Possibly sensitive content'
    },
    
    pinned_tweet_ids: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Pinned tweet IDs as JSON array'
    },
    
    withheld_in_countries: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: 'Withheld in countries as JSON array'
    },
    
    is_automated: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      comment: 'Is automated account'
    },
    
    automated_by: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment: 'Automated by which service'
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
    tableName: 'post_users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['platform', 'platform_user_id'],
        name: 'unique_platform_user'
      },
      {
        fields: ['platform']
      },
      {
        fields: ['username']
      },
      {
        fields: ['is_verified']
      },
      {
        fields: ['is_business']
      },
      {
        fields: ['account_status']
      }
    ]
  });

  // Define associations
  PostUser.associate = (models) => {
    // One-to-many relationship with PostBank (user can have many messages)
    PostUser.hasMany(models.PostBank, {
      foreignKey: 'author_user_id',
      as: 'messages'
    });
  };

  // AUTO-MIGRATION FUNCTION - Ensures PostUser table exists with all required columns
  PostUser.autoMigrate = async () => {
    try {
      console.log('Starting PostUser auto-migration...');
      const queryInterface = sequelize.getQueryInterface();

      // Check if table exists first
      const tables = await queryInterface.showAllTables();
      if (!tables.includes('post_users')) {
        console.log('post_users table does not exist, will be created by sync()');
        return;
      }

      // Check and add missing columns
      const tableDescription = await queryInterface.describeTable('post_users');
      const existingColumns = Object.keys(tableDescription);
      
      console.log('Existing columns in post_users:', existingColumns);

      // Add mobile_number column if it doesn't exist
      if (!existingColumns.includes('mobile_number')) {
        console.log('Adding mobile_number column to post_users table...');
        await queryInterface.addColumn('post_users', 'mobile_number', {
          type: DataTypes.STRING(50),
          allowNull: true,
          comment: 'Mobile phone number'
        });
        console.log('✅ mobile_number column added successfully');
      } else {
        console.log('mobile_number column already exists, skipping...');
      }

      console.log('PostUser auto-migration completed.');
    } catch (error) {
      console.error('Error during PostUser auto-migration:', error);
      // Don't throw error to prevent app crash
    }
  };

  return PostUser;
};