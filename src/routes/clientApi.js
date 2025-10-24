/**
 * Client API Routes
 * Handles client-facing WhatsApp integration setup and management
 */

const express = require('express');
const router = express.Router();

/**
 * Create client API router with dependencies
 * @param {Object} sessionManager - SessionManager instance
 * @param {Object} databaseService - Database service
 * @param {Object} wasenderClient - Wasender client
 * @returns {Object} - Express router
 */
module.exports = function(sessionManager, databaseService, wasenderClient) {

  /**
   * Create new client session (always uses samSession)
   * POST /api/client/create-session
   */
  router.post('/create-session', async (req, res) => {
    try {
      // Always use samSession - no need for dynamic session names
      const sessionName = 'samSession';
      const phoneNumber = process.env.WASENDER_PHONE_NUMBER || '7275147094';
      
      // Create session via Wasender API
      const sessionResponse = await wasenderClient.createSession(sessionName, phoneNumber);
      
      res.json({
        success: true,
        sessionId: sessionName,
        sessionData: sessionResponse,
        message: 'samSession created successfully'
      });

    } catch (error) {
      console.error('Error creating samSession:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create samSession',
        message: error.message
      });
    }
  });

  /**
   * Get QR code for samSession
   * GET /api/client/qr-code (sessionId not needed - always samSession)
   */
  router.get('/qr-code/:sessionId', async (req, res) => {
    try {
      // Always use samSession
      const sessionId = 'samSession';
      
      // Get QR code from session manager
      const qrData = await sessionManager.getQRCode();
      
      if (!qrData || !qrData.qrCode) {
        return res.status(404).json({
          success: false,
          error: 'QR code not available',
          message: 'Please ensure samSession is created and ready'
        });
      }

      res.json({
        success: true,
        qrCode: qrData.qrCode,
        sessionId: sessionId,
        timestamp: qrData.timestamp || new Date().toISOString(),
        expiresIn: 60 // seconds
      });

    } catch (error) {
      console.error('Error getting QR code:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get QR code',
        message: error.message
      });
    }
  });

  /**
   * Get samSession status
   * GET /api/client/session-status (always returns samSession status)
   */
  router.get('/session-status/:sessionId', async (req, res) => {
    try {
      // Always use samSession
      const sessionId = 'samSession';
      
      // Get session status from session manager
      const status = await sessionManager.getSessionStatus();
      const sessionInfo = sessionManager.getSessionInfo();
      
      res.json({
        success: true,
        sessionId: sessionId,
        status: status.status,
        connected: status.status === 'connected',
        sessionInfo: {
          sessionName: sessionInfo.sessionName || 'samSession',
          createdAt: sessionInfo.createdAt,
          lastSuccessfulConnection: sessionInfo.lastSuccessfulConnection,
          isMonitoring: sessionInfo.isMonitoring
        },
        message: status.message || `samSession status: ${status.status}`
      });

    } catch (error) {
      console.error('Error getting samSession status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get samSession status',
        message: error.message
      });
    }
  });

  /**
   * Refresh QR code for client session
   * POST /api/client/refresh-qr/:sessionId
   */
  router.post('/refresh-qr/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      
      // Get fresh QR code
      const qrData = await sessionManager.getQRCode();
      
      if (!qrData || !qrData.qrCode) {
        return res.status(404).json({
          success: false,
          error: 'Failed to refresh QR code',
          message: 'Unable to generate new QR code'
        });
      }

      res.json({
        success: true,
        qrCode: qrData.qrCode,
        sessionId: sessionId,
        timestamp: new Date().toISOString(),
        expiresIn: 60,
        message: 'QR code refreshed successfully'
      });

    } catch (error) {
      console.error('Error refreshing QR code:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to refresh QR code',
        message: error.message
      });
    }
  });

  /**
   * Disconnect client session
   * POST /api/client/disconnect/:sessionId
   */
  router.post('/disconnect/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      
      // Disconnect session
      const result = await sessionManager.disconnectSession();
      
      res.json({
        success: true,
        sessionId: sessionId,
        message: 'Session disconnected successfully',
        result
      });

    } catch (error) {
      console.error('Error disconnecting session:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to disconnect session',
        message: error.message
      });
    }
  });

  /**
   * Get samSession dashboard data
   * GET /api/client/dashboard (always returns samSession data)
   */
  router.get('/dashboard/:sessionId', async (req, res) => {
    try {
      // Always use samSession
      const sessionId = 'samSession';
      
      // Get session status
      const status = await sessionManager.getSessionStatus();
      const sessionInfo = sessionManager.getSessionInfo();
      
      // Get groups and message statistics
      const groups = await databaseService.getAllGroups();
      const totalMessages = groups.reduce((sum, group) => sum + group.message_count, 0);
      
      // Get today's message count
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayMessages = await databaseService.getMessagesSince(today);
      
      res.json({
        success: true,
        dashboard: {
          session: {
            id: sessionId,
            name: sessionInfo.sessionName,
            status: status.status,
            connected: status.status === 'connected',
            lastConnection: sessionInfo.lastSuccessfulConnection
          },
          statistics: {
            totalGroups: groups.length,
            totalMessages: totalMessages,
            todayMessages: todayMessages.length,
            activeGroups: groups.filter(g => 
              new Date(g.last_message_time) > new Date(Date.now() - 24 * 60 * 60 * 1000)
            ).length
          },
          recentGroups: groups.slice(0, 10).map(group => ({
            id: group.group_id,
            name: group.group_name,
            messageCount: group.message_count,
            lastMessage: group.last_message_time
          }))
        }
      });

    } catch (error) {
      console.error('Error getting dashboard data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get dashboard data',
        message: error.message
      });
    }
  });

  /**
   * Get client session statistics
   * GET /api/client/statistics/:sessionId
   */
  router.get('/statistics/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { period = '24h' } = req.query;
      
      let since;
      switch (period) {
        case '1h':
          since = new Date(Date.now() - 60 * 60 * 1000);
          break;
        case '24h':
          since = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }
      
      const messages = await databaseService.getMessagesSince(since);
      const groups = await databaseService.getAllGroups();
      
      // Group messages by hour for chart data
      const hourlyData = {};
      messages.forEach(msg => {
        const hour = new Date(msg.post_timestamp).getHours();
        hourlyData[hour] = (hourlyData[hour] || 0) + 1;
      });
      
      res.json({
        success: true,
        statistics: {
          period,
          totalMessages: messages.length,
          totalGroups: groups.length,
          averageMessagesPerHour: Math.round(messages.length / 24),
          hourlyDistribution: hourlyData,
          topGroups: groups
            .sort((a, b) => b.message_count - a.message_count)
            .slice(0, 10)
            .map(group => ({
              name: group.group_name,
              messageCount: group.message_count
            }))
        }
      });

    } catch (error) {
      console.error('Error getting statistics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get statistics',
        message: error.message
      });
    }
  });

  /**
   * Get client groups
   * GET /api/client/groups/:sessionId
   */
  router.get('/groups/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      
      const groups = await databaseService.getAllGroups();
      
      // Apply pagination
      const paginatedGroups = groups
        .slice(parseInt(offset), parseInt(offset) + parseInt(limit))
        .map(group => ({
          id: group.group_id,
          name: group.group_name,
          messageCount: group.message_count,
          lastMessage: group.last_message_time,
          isActive: new Date(group.last_message_time) > new Date(Date.now() - 24 * 60 * 60 * 1000)
        }));
      
      res.json({
        success: true,
        groups: paginatedGroups,
        pagination: {
          total: groups.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: parseInt(offset) + parseInt(limit) < groups.length
        }
      });

    } catch (error) {
      console.error('Error getting groups:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get groups',
        message: error.message
      });
    }
  });

  // Add simplified routes without sessionId for samSession-only system
  router.get('/qr-code', async (req, res) => {
    try {
      // Always use samSession
      const sessionId = 'samSession';
      
      // Get QR code from session manager
      const qrData = await sessionManager.getQRCode();
      
      if (!qrData || !qrData.qrCode) {
        return res.status(404).json({
          success: false,
          error: 'QR code not available',
          message: 'Please ensure samSession is created and ready'
        });
      }

      res.json({
        success: true,
        qrCode: qrData.qrCode,
        sessionId: sessionId,
        timestamp: qrData.timestamp || new Date().toISOString(),
        expiresIn: 60 // seconds
      });

    } catch (error) {
      console.error('Error getting QR code:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get QR code',
        message: error.message
      });
    }
  });

  router.get('/session-status', async (req, res) => {
    try {
      // Always use samSession
      const sessionId = 'samSession';
      
      // Get session status from session manager
      const status = await sessionManager.getSessionStatus();
      const sessionInfo = sessionManager.getSessionInfo();
      
      res.json({
        success: true,
        sessionId: sessionId,
        status: status.status,
        connected: status.status === 'connected',
        sessionInfo: {
          sessionName: sessionInfo.sessionName || 'samSession',
          createdAt: sessionInfo.createdAt,
          lastSuccessfulConnection: sessionInfo.lastSuccessfulConnection,
          isMonitoring: sessionInfo.isMonitoring
        },
        message: status.message || `samSession status: ${status.status}`
      });

    } catch (error) {
      console.error('Error getting samSession status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get samSession status',
        message: error.message
      });
    }
  });

  router.get('/dashboard', async (req, res) => {
    try {
      // Always use samSession
      const sessionId = 'samSession';
      
      // Get session status
      const status = await sessionManager.getSessionStatus();
      const sessionInfo = sessionManager.getSessionInfo();
      
      // Get groups and message statistics
      const groups = await databaseService.getAllGroups();
      const totalMessages = groups.reduce((sum, group) => sum + group.message_count, 0);
      
      // Get today's message count
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayMessages = await databaseService.getMessagesSince(today);
      
      res.json({
        success: true,
        dashboard: {
          session: {
            id: sessionId,
            name: sessionInfo.sessionName,
            status: status.status,
            connected: status.status === 'connected',
            lastConnection: sessionInfo.lastSuccessfulConnection
          },
          statistics: {
            totalGroups: groups.length,
            totalMessages: totalMessages,
            todayMessages: todayMessages.length,
            activeGroups: groups.filter(g => 
              new Date(g.last_message_time) > new Date(Date.now() - 24 * 60 * 60 * 1000)
            ).length
          },
          recentGroups: groups.slice(0, 10).map(group => ({
            id: group.group_id,
            name: group.group_name,
            messageCount: group.message_count,
            lastMessage: group.last_message_time
          }))
        }
      });

    } catch (error) {
      console.error('Error getting dashboard data:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get dashboard data',
        message: error.message
      });
    }
  });

  return router;
};