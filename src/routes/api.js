/**
 * API Routes
 * Handles all API endpoints for the web interface
 */

const express = require('express');

/**
 * Create API router with database service dependency
 * @param {Object} dbService - Database service
 * @returns {Object} - Express router
 */
module.exports = function(dbService) {
  const router = express.Router();

  /**
   * Get all groups with message counts
   * GET /api/groups
   */
  router.get('/groups', async (req, res) => {
    try {
      const groups = await dbService.getAllGroups();
      res.json(groups);
    } catch (error) {
      console.error('Error fetching groups:', error);
      res.status(500).json({ error: 'Failed to fetch groups' });
    }
  });

  /**
   * Get messages for a specific group
   * GET /api/messages/:groupId
   */
  router.get('/messages/:groupId', async (req, res) => {
    try {
      const { groupId } = req.params;
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      
      const messages = await dbService.getMessagesByGroup(groupId, limit, offset);
      res.json(messages);
    } catch (error) {
      console.error('Error fetching messages by group:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  /**
   * Get all messages with pagination
   * GET /api/messages
   */
  router.get('/messages', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      
      const messages = await dbService.getAllMessages(limit, offset);
      res.json(messages);
    } catch (error) {
      console.error('Error fetching all messages:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  });

  return router;
};