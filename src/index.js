/**
 * Main Application
 * Initializes and starts the WhatsApp group message capture system
 */

require('dotenv').config();

const DatabaseService = require('./services/databaseService');
const MessageProcessor = require('./services/messageProcessor');
const AttachmentService = require('./services/attachmentService');
const DocumentViewerService = require('./services/documentViewerService');
const KeywordUpdateService = require('./services/keywordUpdateService');
const Server = require('./server');

// Wasender API services
const SessionManager = require('./services/wasender/sessionManager');
const WasenderClient = require('./services/wasender/wasenderClient');
const WebhookHandler = require('./services/wasender/webhookHandler');
const NgrokService = require('./services/wasender/ngrokService');

class WhatsAppGroupCapture {
  constructor() {
    this.dbService = new DatabaseService();
    this.attachmentService = new AttachmentService();
    this.messageProcessor = new MessageProcessor();
    this.documentViewerService = new DocumentViewerService(this.attachmentService);
    this.keywordUpdateService = new KeywordUpdateService();

    // Initialize Wasender API services
    if (process.env.WASENDER_API_KEY && process.env.WASENDER_PERSONAL_ACCESS_TOKEN) {
      console.log('Wasender API credentials detected - initializing Wasender services');
      this.sessionManager = new SessionManager();
      this.wasenderClient = new WasenderClient();
      this.webhookHandler = new WebhookHandler(this.sessionManager, this.dbService, this.wasenderClient);

      // Initialize ngrok service for development
      if (process.env.NODE_ENV === 'development' && process.env.NGROK_AUTH_TOKEN) {
        this.ngrokService = new NgrokService();
      }

      this.isWasenderMode = true;
    } else {
      throw new Error('Wasender API credentials are required. Please set WASENDER_API_KEY and WASENDER_PERSONAL_ACCESS_TOKEN in your environment variables.');
    }

    // Initialize server with Wasender services
    this.server = new Server(this.dbService, this.documentViewerService, this.sessionManager, this.webhookHandler);
  }

  /**
   * Initialize and start the application
   * @param {boolean} startWebServer - Whether to start the web server (default: true)
   */
  async start(startWebServer = true) {
    try {
      console.log('Starting WhatsApp Group Message Capture with Wasender API...');

      // Connect to database
      console.log('Connecting to database...');
      await this.dbService.connect();
      console.log('Database connected successfully');

      // Start keyword update service
      console.log('Starting keyword update service...');
      await this.keywordUpdateService.start();
      console.log('✅ Keyword update service started - will check for updates every 6 hours');

      // Wasender API client is already initialized in constructor
      console.log('✅ Wasender API client ready');

      // Skip ngrok - using manual ngrok tunnel
      console.log('✅ Using manual ngrok tunneling or http://matrixsession.gccloud.in/');

      // Start web server
      if (startWebServer) {
        console.log('Starting web server...');
        await this.server.start();
        console.log('Web server started successfully');
      } else {
        console.log('Running in backend-only mode - web server disabled');
        await this.server.start();
      }

      // Skip SessionManager - using existing session from dashboard
      console.log('✅ Using existing Wasender session from dashboard');

      // Set up session event handlers
      this.setupSessionEventHandlers();

      // Webhook handler is already initialized
      console.log('✅ Webhook handler ready');

      console.log('WhatsApp Group Message Capture is now running with Wasender API!');
      console.log('The system will capture and store all group messages via webhooks.');
      console.log(`Webhook endpoint: ${process.env.WEBHOOK_PATH || '/webhook/wasender'}`);

    } catch (error) {
      console.error('Error starting application:', error);
      process.exit(1);
    }
  }

  /**
   * Set up SessionManager event handlers
   */
  setupSessionEventHandlers() {
    if (!this.sessionManager) return;

    // Session lifecycle events
    this.sessionManager.on('sessionCreated', (data) => {
      console.log(`✅ Session created: ${data.sessionId}`);
    });

    this.sessionManager.on('sessionConnected', (data) => {
      console.log(`🔗 Session connected: ${data.sessionId}`);
    });

    this.sessionManager.on('sessionDisconnected', (data) => {
      console.log(`❌ Session disconnected: ${data.sessionId}`);
    });

    // QR code events
    this.sessionManager.on('qrRequired', (data) => {
      console.log(`📱 QR code authentication required for session: ${data.sessionId}`);
      console.log('Please scan the QR code in the web interface at /qr');
    });

    this.sessionManager.on('qrCodeReceived', (data) => {
      console.log(`📱 QR code received for session: ${data.sessionId}`);
    });

    this.sessionManager.on('qrCodeUpdated', (data) => {
      console.log(`🔄 QR code updated for session: ${data.sessionId}`);
    });

    // Status change events
    this.sessionManager.on('statusChanged', (data) => {
      console.log(`🔄 Session status changed: ${data.previousStatus} → ${data.newStatus}`);

      // Handle specific status transitions
      switch (data.newStatus) {
        case 'connected':
          console.log('✅ WhatsApp session is now connected and ready for message capture');
          break;
        case 'disconnected':
          console.log('❌ WhatsApp session disconnected - automatic reconnection will be attempted');
          break;
        case 'qr':
          console.log('📱 QR code authentication required - please visit /qr to scan');
          break;
        case 'error':
          console.log('⚠️ Session error occurred - check logs for details');
          break;
      }
    });

    // Health monitoring events
    this.sessionManager.on('healthCheck', (data) => {
      const healthEmoji = data.healthScore >= 80 ? '💚' : data.healthScore >= 60 ? '💛' : '❤️';
      console.log(`${healthEmoji} Session health check: ${data.healthScore}% (${data.status})`);

      if (data.healthScore < 60) {
        console.log(`⚠️ Session health degraded - consecutive failures: ${data.consecutiveFailures}`);
      }
    });

    // Administrator notification events
    this.sessionManager.on('adminNotification', (notification) => {
      const levelEmoji = {
        'info': 'ℹ️',
        'warning': '⚠️',
        'critical': '🚨'
      };

      console.log(`${levelEmoji[notification.level] || '📢'} Admin Alert [${notification.level.toUpperCase()}]: ${notification.message}`);

      if (notification.level === 'critical') {
        console.log('🚨 CRITICAL: Immediate attention required for WhatsApp session');
      }
    });

    // Connection and authentication events
    this.sessionManager.on('connectionUpdate', (data) => {
      console.log(`🔗 Connection update: ${data.connection} (Session: ${data.sessionId})`);
    });

    this.sessionManager.on('authFailure', (data) => {
      console.log(`🚫 Authentication failed: ${data.reason} (Session: ${data.sessionId})`);
      console.log('📱 Please check QR code authentication or session credentials');
    });

    this.sessionManager.on('authSuccess', (data) => {
      console.log(`✅ Authentication successful (Session: ${data.sessionId})`);
      if (data.user) {
        console.log(`👤 Authenticated as: ${data.user.name || data.user.id}`);
      }
    });

    // Reconnection events
    this.sessionManager.on('reconnectionScheduled', (data) => {
      console.log(`🔄 Reconnection scheduled - attempt ${data.attempt} in ${Math.round(data.delay / 1000)}s`);
    });

    this.sessionManager.on('reconnectionFailed', (data) => {
      console.log(`❌ All reconnection attempts failed after ${data.totalAttempts} attempts`);
      console.log('🔧 Manual intervention may be required - check session status');
    });

    this.sessionManager.on('maxReconnectAttemptsReached', (data) => {
      console.log(`🚨 Maximum reconnection attempts reached (${data.attempts})`);
      console.log('🔧 Please check the session status and manually reconnect if needed');
    });

    // Error events
    this.sessionManager.on('error', (error) => {
      console.error('❌ SessionManager error:', error.message);
    });

    this.sessionManager.on('sessionError', (error) => {
      console.error('❌ Session error:', error.message);
    });

    this.sessionManager.on('connectionError', (error) => {
      console.error('❌ Connection error:', error.message);
    });

    this.sessionManager.on('qrCodeError', (error) => {
      console.error('❌ QR code error:', error.message);
    });

    // System events
    this.sessionManager.on('reset', () => {
      console.log('🔄 SessionManager has been reset');
    });

    this.sessionManager.on('initialized', () => {
      console.log('🚀 SessionManager initialization complete');
    });
  }

  /**
   * Test session connectivity and webhook setup
   */
  async testSessionConnectivity() {
    try {
      console.log('\n=== Testing Session Connectivity ===');

      // Check session status
      const sessionStatus = await this.sessionManager.getSessionStatus();
      console.log(`Session Status: ${sessionStatus.status}`);

      if (sessionStatus.status === 'connected') {
        console.log('✅ WhatsApp session is connected and ready for message capture');
      } else if (sessionStatus.status === 'qr') {
        console.log('📱 QR code authentication required - visit /qr to scan');
      } else {
        console.log(`⚠️ Session status: ${sessionStatus.status}`);
      }

      // Test webhook endpoint
      if (this.ngrokService) {
        const tunnelUrl = await this.ngrokService.getTunnelUrl();
        console.log(`🌐 Webhook URL: ${tunnelUrl}${process.env.WEBHOOK_PATH || '/webhook/wasender'}`);
      }

    } catch (error) {
      console.error('Error testing session connectivity:', error);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      console.log('🛑 Shutting down application...');

      const activeTimers = setTimeout(() => { }, 0);
      for (let i = 0; i < activeTimers; i++) {
        clearTimeout(i);
        clearInterval(i);
      }

      // Stop ngrok tunnel
      if (this.ngrokService) {
        try {
          await this.ngrokService.stopTunnel();
          console.log('✅ Ngrok tunnel stopped');
        } catch (ngrokError) {
          console.error('❌ Error stopping ngrok tunnel:', ngrokError);
        }
      }

      // Check if server was started
      if (this.server && typeof this.server.stop === 'function') {
        try {
          await this.server.stop();
          console.log('✅ Web server stopped');
        } catch (serverError) {
          console.error('❌ Error stopping web server:', serverError);
        }
      }

      // Shutdown Wasender services
      if (this.webhookHandler) {
        try {
          await this.webhookHandler.cleanup();
          console.log('✅ Webhook handler stopped');
        } catch (webhookError) {
          console.error('❌ Error stopping webhook handler:', webhookError);
        }
      }

      if (this.sessionManager) {
        try {
          await this.sessionManager.cleanup();
          console.log('✅ SessionManager stopped');
        } catch (sessionError) {
          console.error('❌ Error stopping SessionManager:', sessionError);
        }
      }

      if (this.wasenderClient) {
        try {
          await this.wasenderClient.cleanup();
          console.log('✅ Wasender client stopped');
        } catch (clientError) {
          console.error('❌ Error stopping Wasender client:', clientError);
        }
      }

      // Stop keyword update service
      if (this.keywordUpdateService) {
        try {
          this.keywordUpdateService.stop();
          console.log('✅ Keyword update service stopped');
        } catch (keywordError) {
          console.error('❌ Error stopping keyword update service:', keywordError);
        }
      }

      // Disconnect from database
      if (this.dbService) {
        try {
          await this.dbService.disconnect();
          console.log('✅ Database disconnected');
        } catch (dbError) {
          console.error('❌ Error disconnecting from database:', dbError);
        }
      }

      console.log('👋 Application shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Initialize global shutdown flag
global.isShuttingDown = false;

// Start the application
async function main() {
  // Check for backend-only mode from command line arguments
  const backendOnly = process.argv.includes('--backend-only');

  if (backendOnly) {
    console.log('Starting in backend-only mode (no web server)');
  }

  // Check if shutdown signal received during startup
  if (global.isShuttingDown) {
    console.log('🛑 Shutdown signal detected during startup, aborting...');
    process.exit(0);
  }

  const app = new WhatsAppGroupCapture();
  global.app = app; // For graceful shutdown

  // Expose services globally for API access
  global.app.documentViewerService = app.documentViewerService;
  global.app.sessionManager = app.sessionManager; // For Wasender API access
  global.app.webhookHandler = app.webhookHandler; // For webhook access
  global.app.keywordUpdateService = app.keywordUpdateService; // For keyword update API access

  await app.start(!backendOnly); // Pass false to disable web server in backend-only mode

  // Test session connectivity after startup
  setTimeout(() => {
    app.testSessionConnectivity();
  }, 5000);

  // Add graceful shutdown handler
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    gracefulShutdown();
  });
}

// Additional graceful shutdown function
async function gracefulShutdown() {
  console.log('🛑 Graceful shutdown initiated...');
  try {
    if (global.app) {
      await global.app.shutdown();
    } else {
      console.log('👋 Application shutdown complete');
      process.exit(0);
    }
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Enhanced signal handling with proper shutdown detection
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT signal. Gracefully shutting down...');

  global.isShuttingDown = true;

  try {
    // Allow some time for current operations to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (global.app) {
      await global.app.shutdown();
    }

    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM signal. Gracefully shutting down...');

  global.isShuttingDown = true;

  try {
    // Allow some time for current operations to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (global.app) {
      await global.app.shutdown();
    }

    console.log('✅ Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
});

main().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

module.exports = WhatsAppGroupCapture;