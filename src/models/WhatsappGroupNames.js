const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const WhatsappGroupNames = sequelize.define('WhatsappGroupNames', {
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true
  },
  group_name: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'WhatsApp group name'
  },
  group_id: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
    comment: 'WhatsApp group ID'
  },
  img_url: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Group image URL'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'whatsapp_group_names',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

  return WhatsappGroupNames;
};