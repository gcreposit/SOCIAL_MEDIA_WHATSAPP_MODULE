const { Sequelize } = require('sequelize');

// Import model definitions
const PostBankModel = require('./PostBank');
const CommonAttachmentModel = require('./CommonAttachment');

/**
 * Initialize models and set up associations
 * @param {Sequelize} sequelize - Sequelize instance
 * @returns {Object} - Object containing all models
 */
function initializeModels(sequelize) {
  // Initialize models
  const PostBank = PostBankModel(sequelize);
  const CommonAttachment = CommonAttachmentModel(sequelize);

  // Set up associations
  PostBank.hasMany(CommonAttachment, {
    foreignKey: 'post_bank_id',
    as: 'commonAttachments',
    onDelete: 'CASCADE'
  });

  CommonAttachment.belongsTo(PostBank, {
    foreignKey: 'post_bank_id',
    as: 'postBank'
  });

  // Return models object
  return {
    PostBank,
    CommonAttachment,
    sequelize,
    Sequelize
  };
}

module.exports = {
  initializeModels,
  PostBankModel,
  CommonAttachmentModel
};