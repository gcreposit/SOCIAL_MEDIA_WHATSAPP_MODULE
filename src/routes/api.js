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
module.exports = function (dbService, documentViewerService = null) {
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

      // First, get the session list to find our session
      const sessionName = process.env.WASENDER_SESSION_NAME || 'matrixSession';
      const sessionData = await getSessionByName(sessionName);

      if (!sessionData) {
        console.log('API: Session not found, needs to be created');
        return res.json({
          authenticated: false,
          isAuthenticated: false,
          isReady: false,
          status: 'need_scan',
          sessionName: sessionName,
          message: 'Session not found, QR code scan required',
          architecture: 'wasender'
        });
      }

      // Check the session status from Wasender API
      const isConnected = sessionData.status === 'connected';
      const needsScan = sessionData.status === 'need_scan' || sessionData.status === 'created' || sessionData.status === 'logged_out';

      // If session is logged out, we need to connect it first to get QR code
      if (sessionData.status === 'logged_out') {
        console.log('API: Session is logged out, needs to be connected for QR code');
        return res.json({
          authenticated: false,
          isAuthenticated: false,
          isReady: false,
          status: 'need_scan', // Treat logged_out as need_scan for frontend
          sessionId: sessionData.id,
          sessionName: sessionData.name,
          phoneNumber: sessionData.phone_number,
          message: 'Session logged out, QR code scan required',
          architecture: 'wasender',
          sessionInfo: {
            id: sessionData.id,
            name: sessionData.name,
            phoneNumber: sessionData.phone_number,
            createdAt: sessionData.created_at,
            lastActiveAt: sessionData.last_active_at,
            status: sessionData.status,
            originalStatus: 'logged_out'
          }
        });
      }

      return res.json({
        authenticated: isConnected,
        isAuthenticated: isConnected,
        isReady: isConnected,
        status: sessionData.status,
        sessionId: sessionData.id,
        sessionName: sessionData.name,
        phoneNumber: sessionData.phone_number,
        message: `Session status: ${sessionData.status}`,
        architecture: 'wasender',
        sessionInfo: {
          id: sessionData.id,
          name: sessionData.name,
          phoneNumber: sessionData.phone_number,
          createdAt: sessionData.created_at,
          lastActiveAt: sessionData.last_active_at,
          status: sessionData.status
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
      console.log('API: Getting QR code');

      // Get session name from environment or default
      const sessionName = process.env.WASENDER_SESSION_NAME || 'matrixSession';

      // First, get the session list to find our session
      let sessionData = await getSessionByName(sessionName);

      if (!sessionData) {
        console.log('API: Session not found, creating new session');
        // Create session first
        sessionData = await createWasenderSession(sessionName);
        if (!sessionData) {
          throw new Error('Failed to create session');
        }
      }

      console.log('API: Using session ID:', sessionData.id, 'Status:', sessionData.status);

      // If session is logged out or needs connection, connect it first
      if (sessionData.status === 'logged_out' || sessionData.status === 'created' || sessionData.status === 'need_scan') {
        console.log('API: Session needs connection, connecting first...');
        const connectResult = await connectWasenderSession(sessionData.id);
        console.log('API: Connect result:', connectResult);

        // Check if connect response already contains QR code
        if (connectResult.success && connectResult.data && connectResult.data.qrCode) {
          console.log('API: Using QR code from connect response');
          const qrCodeImage = await generateQRCodeImage(connectResult.data.qrCode);
          
          return res.json({
            success: true,
            qrCode: qrCodeImage,
            qrCodeString: connectResult.data.qrCode,
            sessionId: sessionData.id,
            sessionName: sessionData.name,
            architecture: 'wasender',
            timestamp: new Date().toISOString(),
            qrCodeTime: new Date().toISOString()
          });
        }

        // Wait a moment for session to initialize if no QR in connect response
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Only get QR code separately if not already obtained from connect
      const qrData = await getWasenderQRCode(sessionData.id);
      const qrCodeImage = await generateQRCodeImage(qrData.qrCode);

      return res.json({
        success: true,
        qrCode: qrCodeImage,
        qrCodeString: qrData.qrCode,
        sessionId: sessionData.id,
        sessionName: sessionData.name,
        architecture: 'wasender',
        timestamp: new Date().toISOString(),
        qrCodeTime: new Date().toISOString()
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
      console.log('API: Manual reconnection requested');

      // Get session name from environment or default
      const sessionName = process.env.WASENDER_SESSION_NAME || 'matrixSession';

      // First, get the session list to find our session
      let sessionData = await getSessionByName(sessionName);

      if (!sessionData) {
        console.log('API: Session not found, creating new session for reconnection');
        sessionData = await createWasenderSession(sessionName);
        if (!sessionData) {
          throw new Error('Failed to create session');
        }
      }

      console.log('API: Reconnecting session ID:', sessionData.id);

      // Attempt to connect the session
      const result = await connectWasenderSession(sessionData.id);

      res.json({
        success: true,
        message: 'Reconnection initiated successfully',
        sessionId: sessionData.id,
        sessionName: sessionData.name,
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
   * Get keyword update service status
   * GET /api/keywords/status
   */
  router.get('/keywords/status', async (req, res) => {
    try {
      const keywordService = global.app?.keywordUpdateService;
      if (!keywordService) {
        return res.status(503).json({
          success: false,
          error: 'Keyword update service not available'
        });
      }

      const stats = keywordService.getStats();
      const health = keywordService.healthCheck();

      res.json({
        success: true,
        status: health.status,
        isRunning: stats.isRunning,
        stats: {
          totalFetches: stats.totalFetches,
          successfulFetches: stats.successfulFetches,
          failedFetches: stats.failedFetches,
          updatesApplied: stats.updatesApplied,
          noChangeSkips: stats.noChangeSkips,
          lastSuccessTime: stats.lastSuccessTime,
          lastUpdateTime: stats.lastUpdateTime,
          nextUpdateIn: stats.nextUpdateIn
        },
        configuration: {
          apiUrl: stats.apiUrl,
          updateInterval: `${stats.updateInterval / 1000 / 60 / 60} hours`,
          currentDataHash: stats.currentDataHash
        },
        health: {
          status: health.status,
          lastSuccessAge: health.lastSuccessAge,
          issues: health.issues
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting keyword service status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get keyword service status',
        message: error.message
      });
    }
  });

  /**
   * Force keyword update
   * POST /api/keywords/update
   */
  router.post('/keywords/update', async (req, res) => {
    try {
      const keywordService = global.app?.keywordUpdateService;
      if (!keywordService) {
        return res.status(503).json({
          success: false,
          error: 'Keyword update service not available'
        });
      }

      console.log('API: Manual keyword update requested');
      const result = await keywordService.forceUpdate();

      res.json({
        success: true,
        updated: result.updated,
        message: result.updated ? 'Keywords updated successfully' : 'No changes detected',
        result: {
          recordCount: result.recordCount,
          newHash: result.newHash?.substring(0, 8),
          processingTime: result.processingTime,
          reason: result.reason
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error forcing keyword update:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update keywords',
        message: error.message
      });
    }
  });

  /**
   * Get current keyword configuration
   * GET /api/keywords/config
   */
  router.get('/keywords/config', async (req, res) => {
    try {
      const MessageFilterService = require('../services/messageFilterService');
      const filterService = new MessageFilterService();
      
      const sampleData = filterService.getSampleData();
      const metrics = filterService.getMetrics();

      res.json({
        success: true,
        configuration: sampleData.totalCounts,
        samples: {
          englishDistricts: sampleData.englishDistricts,
          hindiDistricts: sampleData.hindiDistricts,
          hindiKeywords: sampleData.hindiKeywords,
          englishKeywords: sampleData.englishKeywords,
          hinglishKeywords: sampleData.hinglishKeywords
        },
        filterMetrics: {
          totalProcessed: metrics.totalProcessed,
          passedFilter: metrics.passedFilter,
          failedFilter: metrics.failedFilter,
          passRate: metrics.passRate,
          avgProcessingTime: metrics.avgProcessingTimeMs,
          dataReloads: metrics.dataReloads
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting keyword configuration:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get keyword configuration',
        message: error.message
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

/**
 * Helper functions for Wasender API integration
 */

/**
 * Get session by name from Wasender API
 */
async function getSessionByName(sessionName) {
  try {
    const axios = require('axios');
    const baseURL = process.env.WASENDER_BASE_URL;
    const token = process.env.WASENDER_PERSONAL_ACCESS_TOKEN;

    if (!baseURL || !token) {
      throw new Error('Wasender API configuration missing');
    }

    console.log('Fetching sessions from Wasender API...');

    const response = await axios.get(`${baseURL}/api/whatsapp-sessions`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.data && response.data.success && response.data.data) {
      const sessions = response.data.data;
      const session = sessions.find(s => s.name === sessionName);

      if (session) {
        console.log('Found session:', { id: session.id, name: session.name, status: session.status });
        return session;
      } else {
        console.log('Session not found:', sessionName);
        return null;
      }
    } else {
      console.log('Invalid response from sessions API:', response.data);
      return null;
    }
  } catch (error) {
    console.error('Error fetching session by name:', error.message);
    return null;
  }
}

/**
 * Create new Wasender session
 */
async function createWasenderSession(sessionName) {
  try {
    const axios = require('axios');
    const baseURL = process.env.WASENDER_BASE_URL;
    const token = process.env.WASENDER_PERSONAL_ACCESS_TOKEN;
    const phoneNumber = process.env.WASENDER_PHONE_NUMBER;

    console.log('Creating new Wasender session:', sessionName);

    const response = await axios.post(`${baseURL}/api/whatsapp-sessions`, {
      name: sessionName,
      phone_number: phoneNumber
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    if (response.data && response.data.success) {
      console.log('Session created successfully:', response.data);
      // Return the created session data
      return {
        id: response.data.data?.id || response.data.id,
        name: sessionName,
        phone_number: phoneNumber,
        status: 'created'
      };
    } else {
      throw new Error(response.data?.error || 'Failed to create session');
    }
  } catch (error) {
    console.error('Error creating Wasender session:', error.message);
    throw error;
  }
}

/**
 * Connect Wasender session
 */
async function connectWasenderSession(sessionId) {
  try {
    const axios = require('axios');
    const baseURL = process.env.WASENDER_BASE_URL;
    const token = process.env.WASENDER_PERSONAL_ACCESS_TOKEN;

    console.log('Connecting Wasender session:', sessionId);

    const response = await axios.post(`${baseURL}/api/whatsapp-sessions/${sessionId}/connect`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log('Connect response:', response.data);
    return response.data;
  } catch (error) {
    console.error('Error connecting Wasender session:', error.message);
    // Don't throw error here as this might be expected for QR flow
    return { success: false, error: error.message };
  }
}

/**
 * Get QR code from Wasender session
 */
async function getWasenderQRCode(sessionId) {
  try {
    const axios = require('axios');
    const baseURL = process.env.WASENDER_BASE_URL;
    const token = process.env.WASENDER_PERSONAL_ACCESS_TOKEN;

    console.log('Getting QR code for session:', sessionId);

    const response = await axios.get(`${baseURL}/api/whatsapp-sessions/${sessionId}/qrcode`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (response.data && response.data.success && response.data.data && response.data.data.qrCode) {
      console.log('QR code retrieved successfully');
      return {
        qrCode: response.data.data.qrCode,
        timestamp: new Date().toISOString()
      };
    } else {
      throw new Error(response.data?.error || 'Invalid QR code response');
    }
  } catch (error) {
    console.error('Error getting QR code:', error.message);
    throw error;
  }
}

/**
 * Generate QR code image from string
 */
async function generateQRCodeImage(qrString) {
  try {
    const QRCode = require('qrcode');
    
    // Generate QR code as base64 data URL
    const qrCodeDataURL = await QRCode.toDataURL(qrString, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    // Extract base64 part (remove data:image/png;base64, prefix)
    const base64Data = qrCodeDataURL.split(',')[1];
    
    console.log('QR code image generated successfully');
    return base64Data;
  } catch (error) {
    console.error('Error generating QR code image:', error.message);
    // Return a simple placeholder if QR generation fails
    return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  }
}