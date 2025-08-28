/**
 * Main Application
 * Initializes and starts the WhatsApp group message capture system
 */

require('dotenv').config();

const DatabaseService = require('./services/databaseService');
const MessageProcessor = require('./services/messageProcessor');
const WhatsAppClient = require('./services/whatsappClient');
const Server = require('./server');

class WhatsAppGroupCapture {
  constructor() {
    this.dbService = new DatabaseService();
    this.messageProcessor = new MessageProcessor();
    this.server = new Server(this.dbService);
    this.whatsappClient = new WhatsAppClient(this.messageProcessor, this.dbService, this.server);
  }

  /**
   * Initialize and start the application
   * @param {boolean} startWebServer - Whether to start the web server (default: true)
   */
  async start(startWebServer = true) {
    try {
      console.log('Starting WhatsApp Group Message Capture...');

      // Connect to database
      console.log('Connecting to database...');
      await this.dbService.connect();
      console.log('Database connected successfully');

      // Start web server if not in backend-only mode
      if (startWebServer) {
        console.log('Starting web server...');
        await this.server.start();
        console.log('Web server started successfully');
      } else {
        console.log('Running in backend-only mode - web server disabled');
                await this.server.start();

      }

      // Initialize WhatsApp client
      console.log('Initializing WhatsApp client...');
      await this.whatsappClient.initializeClient();
      
      console.log('WhatsApp Group Message Capture is now running!');
      console.log('The system will capture and store all group messages.');
      
      // Test group access after a delay to ensure client is ready
      // Use force initialization in backend-only mode
      setTimeout(() => {
        this.testGroupAccess(!startWebServer); // Force initialization in backend-only mode
      }, startWebServer ? 10000 : 20000); // Wait longer in backend-only mode

    } catch (error) {
      console.error('Error starting application:', error);
      process.exit(1);
    }
  }

  /**
   * Test group access and display available groups
   * @param {boolean} forceInitialization - Whether to force group initialization
   */
  async testGroupAccess(forceInitialization = false) {
    try {
      console.log('\n=== Testing Group Access ===');
      
      let groups;
      if (forceInitialization) {
        console.log('Forcing group initialization (backend-only mode)...');
        groups = await this.whatsappClient.forceGroupInitialization();
      } else {
        // Use the more robust initializeGroups method instead of getAllGroups
        groups = await this.whatsappClient.initializeGroups();
      }
      
      if (groups.length === 0) {
        console.log('No groups found. Make sure your WhatsApp account is a member of some groups.');
        console.log('The system will continue to retry group initialization automatically.');
        
        // Schedule another force initialization attempt for backend-only mode
        if (forceInitialization) {
          console.log('Scheduling another force initialization attempt in 60 seconds...');
          setTimeout(() => {
            this.testGroupAccess(true);
          }, 60000);
        }
      } else {
        console.log(`Successfully found ${groups.length} groups. Message capture is active.`);
      }
      
      // Optional: Test fetching recent messages
      // await this.whatsappClient.testGroupMessages();
      
    } catch (error) {
      console.error('Error testing group access:', error);
      console.log('The system will continue to retry group initialization automatically.');
      
      // Schedule another attempt for backend-only mode
      if (forceInitialization) {
        console.log('Scheduling another force initialization attempt in 90 seconds...');
        setTimeout(() => {
          this.testGroupAccess(true);
        }, 90000);
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      console.log('Shutting down application...');
      
      // Check if server was started
      if (this.server && typeof this.server.stop === 'function') {
        try {
          await this.server.stop();
          console.log('Web server stopped');
        } catch (serverError) {
          console.error('Error stopping web server:', serverError);
        }
      }
      
      // Shutdown WhatsApp client
      if (this.whatsappClient) {
        try {
          await this.whatsappClient.shutdown();
          console.log('WhatsApp client stopped');
        } catch (clientError) {
          console.error('Error stopping WhatsApp client:', clientError);
        }
      }
      
      // Disconnect from database
      if (this.dbService) {
        try {
          await this.dbService.disconnect();
          console.log('Database disconnected');
        } catch (dbError) {
          console.error('Error disconnecting from database:', dbError);
        }
      }
      
      console.log('Application shutdown complete');
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  if (global.app) {
    await global.app.shutdown();
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', async () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  if (global.app) {
    await global.app.shutdown();
  } else {
    process.exit(0);
  }
});

// Start the application
async function main() {
  // Check for backend-only mode from command line arguments
  const backendOnly = process.argv.includes('--backend-only');
  
  if (backendOnly) {
    console.log('Starting in backend-only mode (no web server)');
  }
  
  const app = new WhatsAppGroupCapture();
  global.app = app; // For graceful shutdown
  await app.start(!backendOnly); // Pass false to disable web server in backend-only mode
}

main().catch(error => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

module.exports = WhatsAppGroupCapture;