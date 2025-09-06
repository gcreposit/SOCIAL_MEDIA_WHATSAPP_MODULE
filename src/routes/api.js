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
module.exports = function(dbService, documentViewerService = null) {
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
      
      console.log('API: Calling getStatus...');
      const status = whatsappClient.getStatus();
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

  /**
   * Trigger MongoDB session cleanup (for RemoteAuth chunks)
   * POST /api/cleanup/mongo-sessions
   */
  router.post('/cleanup/mongo-sessions', async (req, res) => {
    try {
      // MongoDB session cleanup service has been disabled
      return res.status(400).json({
        error: 'MongoDB session cleanup service has been disabled'
      });
      
      /* Service disabled
      const mongoSessionCleanupService = global.app?.mongoSessionCleanupService;
      
      if (!mongoSessionCleanupService) {
        return res.status(400).json({
          error: 'MongoDB session cleanup service not available'
        });
      }
      
      // Trigger session cleanup in background
      mongoSessionCleanupService.triggerManualSessionCleanup().catch(console.error);
      
      res.json({ 
        success: true, 
        message: 'MongoDB session cleanup triggered successfully',
        note: 'This only cleans WhatsApp session data, NOT your messages'
      });
      */
    } catch (error) {
      console.error('Error triggering MongoDB session cleanup:', error);
      res.status(500).json({ 
        error: 'Failed to trigger MongoDB session cleanup' 
      });
    }
  });

  /**
   * Get MongoDB session storage info
   * GET /api/cleanup/mongo-sessions/info
   */
  router.get('/cleanup/mongo-sessions/info', async (req, res) => {
    try {
      // MongoDB session cleanup service has been disabled
      return res.status(400).json({
        error: 'MongoDB session cleanup service has been disabled'
      });
      
      /* Service disabled
      const mongoSessionCleanupService = global.app?.mongoSessionCleanupService;
      
      if (!mongoSessionCleanupService) {
        return res.status(400).json({
          error: 'MongoDB session cleanup service not available'
        });
      }
      
      const info = await mongoSessionCleanupService.getSessionStorageInfo();
      res.json(info);
      */
    } catch (error) {
      console.error('Error getting MongoDB session info:', error);
      res.status(500).json({ 
        error: 'Failed to get MongoDB session info' 
      });
    }
  });

  /**
   * Get document statistics
   * GET /api/documents/stats
   */
  router.get('/documents/stats', async (req, res) => {
    try {
      if (!documentViewerService) {
        return res.status(400).json({
          error: 'Document viewer service not available'
        });
      }
      
      // Get recent messages with attachments
      const messages = await dbService.getAllMessages(1000, 0);
      const stats = await documentViewerService.getDocumentStats(messages);
      
      res.json(stats);
    } catch (error) {
      console.error('Error getting document stats:', error);
      res.status(500).json({ 
        error: 'Failed to get document statistics' 
      });
    }
  });

  /**
   * Search documents
   * GET /api/documents/search?q=query
   */
  router.get('/documents/search', async (req, res) => {
    try {
      if (!documentViewerService) {
        return res.status(400).json({
          error: 'Document viewer service not available'
        });
      }
      
      const query = req.query.q || '';
      const limit = parseInt(req.query.limit) || 100;
      
      // Get recent messages
      const messages = await dbService.getAllMessages(limit, 0);
      const documents = await documentViewerService.searchDocuments(query, messages);
      
      res.json({
        query,
        total: documents.length,
        documents
      });
    } catch (error) {
      console.error('Error searching documents:', error);
      res.status(500).json({ 
        error: 'Failed to search documents' 
      });
    }
  });

  return router;
};