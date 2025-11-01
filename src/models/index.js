const { Sequelize } = require('sequelize');

// Import model definitions
const PostBankModel = require('./PostBank');
const CommonAttachmentModel = require('./CommonAttachment');
const PostUserModel = require('./PostUser');
const WhatsappGroupNamesModel = require('./WhatsappGroupNames');

/**
 * Initialize models and set up associations
 * @param {Sequelize} sequelize - Sequelize instance
 * @returns {Object} - Object containing all models
 */
function initializeModels(sequelize) {
  // Initialize models
  const PostBank = PostBankModel(sequelize);
  const CommonAttachment = CommonAttachmentModel(sequelize);
  const PostUser = PostUserModel(sequelize);
  const WhatsappGroupNames = WhatsappGroupNamesModel;

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

  // PostUser associations
  PostUser.hasMany(PostBank, {
    foreignKey: 'author_user_id',
    as: 'messages'
  });

  PostBank.belongsTo(PostUser, {
    foreignKey: 'author_user_id',
    as: 'author'
  });

  // Return models object
  return {
    PostBank,
    CommonAttachment,
    PostUser,
    WhatsappGroupNames,
    sequelize,
    Sequelize
  };
}

module.exports = {
  initializeModels,
  PostBankModel,
  CommonAttachmentModel,
  PostUserModel,
  WhatsappGroupNamesModel
};