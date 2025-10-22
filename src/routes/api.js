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
      res.json({ success: true, messages: messages });
    } catch (error) {
      console.error('Error fetching messages by group:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch messages' });
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
      
      // Use Wasender SessionManager (new architecture)
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        console.log('API: Wasender SessionManager not initialized');
        return res.status(503).json({
          authenticated: false,
          status: 'service_unavailable',
          message: 'Wasender SessionManager not initialized',
          architecture: 'wasender',
          error: 'Service not available'
        });
      }
      
      console.log('API: Using Wasender SessionManager');
      const sessionInfo = sessionManager.getSessionInfo();
      const status = await sessionManager.getSessionStatus();
      
      return res.json({
        authenticated: status.status === 'connected',
        isAuthenticated: status.status === 'connected',
        isReady: status.status === 'connected',
        status: status.status,
        sessionId: sessionInfo.sessionId,
        sessionName: sessionInfo.sessionName,
        message: status.message || `Session status: ${status.status}`,
        architecture: 'wasender',
        sessionInfo: {
          createdAt: sessionInfo.createdAt,
          lastSuccessfulConnection: sessionInfo.lastSuccessfulConnection,
          reconnectAttempts: sessionInfo.reconnectAttempts,
          isMonitoring: sessionInfo.isMonitoring,
          connectionFailures: sessionInfo.connectionFailures
        }
      });
    } catch (error) {
      console.error('Error getting WhatsApp status:', error);
      res.status(500).json({ 
        authenticated: false,
        isAuthenticated: false,
        isReady: false,
        status: 'error',
        architecture: 'wasender',
        error: 'Failed to get WhatsApp status',
        message: error.message
      });
    }
  });

  /**
   * Get QR code for authentication
   * GET /api/whatsapp/qr
   */
  router.get('/whatsapp/qr', async (req, res) => {
    try {
      // Use Wasender SessionManager (new architecture)
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        console.log('API: Wasender SessionManager not initialized');
        return res.status(503).json({
          success: false,
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      console.log('API: Getting QR code from Wasender SessionManager');
      
      const sessionInfo = sessionManager.getSessionInfo();
      if (!sessionInfo.sessionId) {
        // Create session if none exists
        console.log('API: Creating new session for QR code');
        await sessionManager.createSession();
      }
      
      const qrData = await sessionManager.getQRCode();
      
      return res.json({
        success: true,
        qrCode: qrData.qrCode,
        sessionId: sessionInfo.sessionId,
        sessionName: sessionInfo.sessionName,
        architecture: 'wasender',
        timestamp: qrData.timestamp || new Date().toISOString(),
        qrCodeTime: qrData.timestamp || new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting QR code:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to get QR code',
        message: error.message,
        architecture: 'wasender'
      });
    }
  });

  /**
   * Refresh QR code
   * POST /api/whatsapp/refresh-qr
   */
  router.post('/whatsapp/refresh-qr', async (req, res) => {
    try {
      // Use Wasender SessionManager (new architecture)
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        console.log('API: Wasender SessionManager not initialized');
        return res.status(503).json({
          success: false,
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      console.log('API: Refreshing QR code via Wasender SessionManager');
      
      const sessionInfo = sessionManager.getSessionInfo();
      if (!sessionInfo.sessionId) {
        // Create session if none exists
        console.log('API: Creating new session for QR refresh');
        await sessionManager.createSession();
      }
      
      // Get fresh QR code
      const qrData = await sessionManager.getQRCode();
      
      return res.json({
        success: true,
        message: 'QR code refreshed successfully',
        qrCode: qrData.qrCode,
        sessionId: sessionInfo.sessionId,
        sessionName: sessionInfo.sessionName,
        architecture: 'wasender',
        timestamp: qrData.timestamp || new Date().toISOString()
      });
    } catch (error) {
      console.error('Error refreshing QR code:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to refresh QR code',
        message: error.message,
        architecture: 'wasender'
      });
    }
  });

  /**
   * Force WhatsApp session logout and cleanup
   * POST /api/whatsapp/force-logout
   */
  router.post('/whatsapp/force-logout', async (req, res) => {
    try {
      // Use Wasender SessionManager (new architecture)
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        console.log('API: Wasender SessionManager not initialized');
        return res.status(503).json({
          success: false,
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      console.log('API: Force logout requested via Wasender');
      
      // Disconnect the current session
      await sessionManager.disconnectSession();
      
      res.json({ 
        success: true, 
        message: 'WhatsApp session has been disconnected. Please scan QR code to reconnect.',
        architecture: 'wasender'
      });
    } catch (error) {
      console.error('Error forcing WhatsApp logout:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to force logout',
        message: error.message,
        architecture: 'wasender'
      });
    }
  });

  /**
   * Get WhatsApp session expiry status
   * GET /api/whatsapp/session-status
   */
  router.get('/whatsapp/session-status', async (req, res) => {
    try {
      // Use Wasender SessionManager (new architecture)
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        console.log('API: Wasender SessionManager not initialized');
        return res.status(503).json({
          sessionActive: false,
          status: 'service_unavailable',
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      console.log('API: Getting session status from Wasender SessionManager');
      
      const sessionInfo = sessionManager.getSessionInfo();
      const status = await sessionManager.getSessionStatus();
      
      return res.json({
        sessionActive: status.status === 'connected',
        status: status.status,
        sessionId: sessionInfo.sessionId,
        sessionName: sessionInfo.sessionName,
        sessionCreatedAt: sessionInfo.createdAt?.toISOString(),
        lastSuccessfulConnection: sessionInfo.lastSuccessfulConnection?.toISOString(),
        lastStatusCheck: sessionInfo.lastStatusCheck?.toISOString(),
        reconnectAttempts: sessionInfo.reconnectAttempts,
        connectionFailures: sessionInfo.connectionFailures,
        isMonitoring: sessionInfo.isMonitoring,
        architecture: 'wasender',
        message: status.message || `Session status: ${status.status}`,
        // Additional Wasender-specific fields
        sessionHealth: {
          uptime: sessionInfo.lastSuccessfulConnection ? 
            Date.now() - sessionInfo.lastSuccessfulConnection.getTime() : null,
          healthScore: sessionInfo.connectionFailures < 3 ? 'good' : 
            sessionInfo.connectionFailures < 10 ? 'warning' : 'critical'
        }
      });
    } catch (error) {
      console.error('Error getting session status:', error);
      res.status(500).json({ 
        sessionActive: false,
        status: 'error',
        error: 'Failed to get session status',
        message: error.message,
        architecture: 'wasender'
      });
    }
  });

  /**
   * Wasender-specific session management endpoints
   */

  /**
   * Get Wasender session status
   * GET /api/wasender/session-status
   */
  router.get('/wasender/session-status', async (req, res) => {
    try {
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        return res.status(503).json({
          success: false,
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      const sessionInfo = sessionManager.getSessionInfo();
      const status = await sessionManager.getSessionStatus();
      
      res.json({
        success: true,
        sessionInfo: {
          sessionId: sessionInfo.sessionId,
          sessionName: sessionInfo.sessionName,
          createdAt: sessionInfo.createdAt?.toISOString(),
          lastSuccessfulConnection: sessionInfo.lastSuccessfulConnection?.toISOString(),
          lastStatusCheck: sessionInfo.lastStatusCheck?.toISOString(),
          reconnectAttempts: sessionInfo.reconnectAttempts,
          connectionFailures: sessionInfo.connectionFailures,
          isMonitoring: sessionInfo.isMonitoring
        },
        status: {
          status: status.status,
          message: status.message,
          connected: status.status === 'connected',
          needsQR: status.status === 'qr' || status.status === 'created'
        },
        health: {
          uptime: sessionInfo.lastSuccessfulConnection ? 
            Date.now() - sessionInfo.lastSuccessfulConnection.getTime() : null,
          healthScore: sessionInfo.connectionFailures < 3 ? 'good' : 
            sessionInfo.connectionFailures < 10 ? 'warning' : 'critical',
          lastError: sessionInfo.lastError
        },
        timestamp: new Date().toISOString(),
        architecture: 'wasender'
      });
    } catch (error) {
      console.error('Error getting Wasender session status:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to get Wasender session status',
        message: error.message,
        architecture: 'wasender'
      });
    }
  });

  /**
   * Reconnect Wasender session
   * POST /api/wasender/reconnect
   */
  router.post('/wasender/reconnect', async (req, res) => {
    try {
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        return res.status(503).json({
          success: false,
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      console.log('API: Manual reconnection requested');
      
      const sessionInfo = sessionManager.getSessionInfo();
      if (!sessionInfo.sessionId) {
        // Create session if none exists
        console.log('API: Creating new session for reconnection');
        await sessionManager.createSession();
      }
      
      // Attempt to connect the session
      const result = await sessionManager.connectSession();
      
      res.json({
        success: true,
        message: 'Reconnection initiated successfully',
        sessionId: sessionInfo.sessionId,
        sessionName: sessionInfo.sessionName,
        result: result,
        timestamp: new Date().toISOString(),
        architecture: 'wasender'
      });
    } catch (error) {
      console.error('Error reconnecting Wasender session:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to reconnect session',
        message: error.message,
        architecture: 'wasender'
      });
    }
  });

  /**
   * Create new Wasender session
   * POST /api/wasender/create-session
   */
  router.post('/wasender/create-session', async (req, res) => {
    try {
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        return res.status(400).json({
          error: 'Wasender SessionManager not initialized'
        });
      }
      
      const { sessionName, phoneNumber } = req.body;
      
      console.log('API: Creating new session', { sessionName, phoneNumber });
      
      const response = await sessionManager.createSession(sessionName, phoneNumber);
      
      res.json({
        success: true,
        message: 'Session created successfully',
        sessionId: response.sessionId,
        sessionName: sessionName || sessionManager.sessionName,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating Wasender session:', error);
      res.status(500).json({ 
        error: 'Failed to create session',
        message: error.message
      });
    }
  });

  /**
   * Disconnect Wasender session
   * POST /api/wasender/disconnect
   */
  router.post('/wasender/disconnect', async (req, res) => {
    try {
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        return res.status(503).json({
          success: false,
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      console.log('API: Disconnecting session');
      
      const response = await sessionManager.disconnectSession();
      
      res.json({
        success: true,
        message: 'Session disconnected successfully',
        response,
        timestamp: new Date().toISOString(),
        architecture: 'wasender'
      });
    } catch (error) {
      console.error('Error disconnecting Wasender session:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to disconnect session',
        message: error.message,
        architecture: 'wasender'
      });
    }
  });

  /**
   * Get WhatsApp groups information via Wasender API
   * GET /api/wasender/groups
   */
  router.get('/wasender/groups', async (req, res) => {
    try {
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        return res.status(503).json({
          success: false,
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      // Check if session is connected
      const status = await sessionManager.getSessionStatus();
      if (status.status !== 'connected') {
        return res.status(400).json({
          success: false,
          error: 'WhatsApp session not connected',
          status: status.status,
          message: 'Please connect to WhatsApp first',
          architecture: 'wasender'
        });
      }
      
      console.log('API: Getting groups information from database');
      
      // Get groups from database (captured via webhooks)
      const groups = await dbService.getAllGroups();
      
      // Enhance with Wasender session info
      const sessionInfo = sessionManager.getSessionInfo();
      
      res.json({
        success: true,
        groups: groups.map(group => ({
          groupId: group.group_id,
          groupName: group.group_name,
          messageCount: group.message_count,
          lastMessageTime: group.last_message_time,
          // Add Wasender-specific metadata
          platform: 'whatsapp',
          source: 'wasender_webhook',
          isActive: true
        })),
        totalGroups: groups.length,
        sessionInfo: {
          sessionId: sessionInfo.sessionId,
          sessionName: sessionInfo.sessionName,
          isMonitoring: sessionInfo.isMonitoring
        },
        timestamp: new Date().toISOString(),
        architecture: 'wasender'
      });
    } catch (error) {
      console.error('Error getting Wasender groups:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to get groups information',
        message: error.message,
        architecture: 'wasender'
      });
    }
  });

  /**
   * Get Wasender webhook metrics and statistics
   * GET /api/wasender/metrics
   */
  router.get('/wasender/metrics', async (req, res) => {
    try {
      const sessionManager = global.app?.sessionManager;
      if (!sessionManager) {
        return res.status(503).json({
          success: false,
          error: 'Wasender SessionManager not initialized',
          architecture: 'wasender'
        });
      }
      
      // Get webhook handler metrics if available
      const webhookHandler = global.app?.webhookHandler;
      let webhookMetrics = null;
      
      if (webhookHandler && typeof webhookHandler.getMetrics === 'function') {
        webhookMetrics = webhookHandler.getMetrics();
      }
      
      // Get session info
      const sessionInfo = sessionManager.getSessionInfo();
      const status = await sessionManager.getSessionStatus();
      
      // Get database statistics
      const groups = await dbService.getAllGroups();
      const totalMessages = groups.reduce((sum, group) => sum + group.message_count, 0);
      
      res.json({
        success: true,
        metrics: {
          session: {
            status: status.status,
            uptime: sessionInfo.lastSuccessfulConnection ? 
              Date.now() - sessionInfo.lastSuccessfulConnection.getTime() : null,
            reconnectAttempts: sessionInfo.reconnectAttempts,
            connectionFailures: sessionInfo.connectionFailures,
            isMonitoring: sessionInfo.isMonitoring
          },
          webhook: webhookMetrics || {
            message: 'Webhook metrics not available'
          },
          database: {
            totalGroups: groups.length,
            totalMessages: totalMessages,
            activeGroups: groups.filter(g => 
              new Date(g.last_message_time) > new Date(Date.now() - 24 * 60 * 60 * 1000)
            ).length
          }
        },
        timestamp: new Date().toISOString(),
        architecture: 'wasender'
      });
    } catch (error) {
      console.error('Error getting Wasender metrics:', error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to get metrics',
        message: error.message,
        architecture: 'wasender'
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