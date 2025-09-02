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

  /**
   * Get WhatsApp authentication status and QR code
   * GET /api/whatsapp/status
   */
  router.get('/whatsapp/status', async (req, res) => {
    try {
      console.log('API: Status request received');
      console.log('API: global.app exists:', !!global.app);
      console.log('API: global.app.whatsappClient exists:', !!global.app?.whatsappClient);
      
      // Get WhatsApp client instance from global app
      const whatsappClient = global.app?.whatsappClient;
      
      if (!whatsappClient) {
        console.log('API: WhatsApp client not initialized');
        return res.json({
          authenticated: false,
          message: 'WhatsApp client not initialized'
        });
      }
      
      console.log('API: Calling getAuthStatus...');
      const status = whatsappClient.getAuthStatus();
      console.log('API: Returning status:', JSON.stringify(status, null, 2));
      res.json(status);
    } catch (error) {
      console.error('Error getting WhatsApp status:', error);
      res.status(500).json({ 
        authenticated: false,
        error: 'Failed to get WhatsApp status' 
      });
    }
  });

  /**
   * Refresh QR code
   * POST /api/whatsapp/refresh-qr
   */
  router.post('/whatsapp/refresh-qr', async (req, res) => {
    try {
      const whatsappClient = global.app?.whatsappClient;
      
      if (!whatsappClient) {
        return res.status(400).json({
          error: 'WhatsApp client not initialized'
        });
      }
      
      await whatsappClient.refreshQRCode();
      res.json({ success: true, message: 'QR code refresh requested' });
    } catch (error) {
      console.error('Error refreshing QR code:', error);
      res.status(500).json({ 
        error: 'Failed to refresh QR code' 
      });
    }
  });

  return router;
};