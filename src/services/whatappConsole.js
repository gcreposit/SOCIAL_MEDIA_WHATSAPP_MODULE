/**
 * WhatsApp Client Service
 * Manages WhatsApp Web connection and message listening
 */

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

class WhatsAppClient {
  /**
   * Constructor
   * @param {Object} messageProcessor - Message processor service
   * @param {Object} dbService - Database service
   * @param {Object} server - Server instance (optional)
   */
  constructor(messageProcessor, dbService, server = null) {
    this.client = null;
    this.messageProcessor = messageProcessor;
    this.dbService = dbService;
    this.businessPhoneNumber = null;
    this.server = server;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000; // Start with 5 seconds
  }

  /**
   * Initialize WhatsApp Web client
   * @param {boolean} isRetry - Whether this is a retry attempt
   * @returns {Promise<boolean>} - Promise resolving to true if initialization successful
   */
  async initializeClient(isRetry = false) {
    try {
      if (isRetry) {
        console.log('Retrying WhatsApp client initialization...');
      } else {
        console.log('Starting WhatsApp client initialization...');
      }
      
      // Create client with local authentication
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: process.env.WHATSAPP_SESSION_DATA_PATH || path.join(process.cwd(), 'whatsapp-session')
        }),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
          timeout: 120000 // Increase timeout to 2 minutes
        },
        qrMaxRetries: 5, // Maximum number of QR code refreshes
        authTimeoutMs: 60000, // Authentication timeout
        restartOnAuthFail: true // Restart on authentication failure
      });

      // Register event handlers
      this.registerEventHandlers();

      // Initialize client
      await this.client.initialize();
      console.log('WhatsApp client initialization completed successfully');
      return true;
    } catch (error) {
      console.error('Error initializing WhatsApp client:', error);
      
      // If this is not already a retry attempt, try once more after a delay
      if (!isRetry) {
        console.log('Will retry initialization after 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        return this.initializeClient(true);
      }
      
      throw error;
    }
  }

  /**
   * Register WhatsApp client event handlers
   */
  registerEventHandlers() {
    // QR code event
    this.client.on('qr', (qr) => {
      this.handleQRCode(qr);
    });

    // Ready event
    this.client.on('ready', async () => {
      console.log('WhatsApp client is ready!');
      // Get business phone number for filtering own messages
      const info = this.client.info;
      this.businessPhoneNumber = info.wid.user;
      console.log(`Business phone number: ${this.businessPhoneNumber}`);
      
      // Reset reconnection attempts counter on successful connection
      this.reconnectAttempts = 0;
      console.log('Connection successful, reset reconnection counter');
      
      // Initialize groups after client is ready with a slight delay
      // to ensure the client is fully ready
      setTimeout(() => this.initializeGroups(), 3000);
    });

    // Authentication failure event
    this.client.on('auth_failure', (msg) => {
      console.error('WhatsApp authentication failed:', msg);
    });

    // Disconnected event
    this.client.on('disconnected', (reason) => {
      console.log('WhatsApp client disconnected:', reason);
      
      // Implement exponential backoff for reconnection
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const delay = Math.min(this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1), 60000); // Cap at 60 seconds
        
        console.log(`Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay/1000} seconds...`);
        
        setTimeout(() => {
          console.log('Attempting to reconnect WhatsApp client...');
          this.client.initialize().catch(err => {
            console.error('Reconnection attempt failed:', err);
          });
        }, delay);
      } else {
        console.error('Maximum reconnection attempts reached. Please restart the application.');
      }
    });

    // *** THIS IS THE MISSING PART - MESSAGE EVENT LISTENER ***
    this.client.on('message', async (message) => {
      try {
        console.log('Received message:', {
          from: message.from,
          body: message.body,
          isGroup: message.from.includes('@g.us')
        });

        // Skip if message is from business account itself
        if (this.isBusinessMessage(message)) {
          console.log('Skipping business account message');
          return;
        }

        // Skip if not from a group
        if (!message.from.includes('@g.us')) {
          console.log('Skipping non-group message');
          return;
        }

        // Process the message
        const processedMessage = await this.messageProcessor.processMessage(message);
        
        if (processedMessage) {
          // Save to database
          const insertId = await this.dbService.saveMessage(
            processedMessage.groupId,
            processedMessage.groupName,
            processedMessage.senderName,
            processedMessage.messageText,
            processedMessage.timestamp,
            processedMessage.imageAttachmentPath,
            processedMessage.documentAttachmentPath,
            processedMessage.videoAttachmentPath,
            processedMessage.linkMetadata,
            processedMessage.batchAttachmentPath,
            processedMessage.batchMetadata,
            processedMessage.replyToMessageId,
            processedMessage.replyText,
            processedMessage.replyAttachmentType,
            processedMessage.replyAttachmentPath
          );
          
          console.log(`Message saved with ID: ${insertId}`);
          console.log(`Group: ${processedMessage.groupName}`);
          console.log(`Sender: ${processedMessage.senderName}`);
          console.log(`Message: ${processedMessage.messageText.substring(0, 50)}...`);
          
          // Log attachment information if present
          if (processedMessage.imageAttachmentPath) {
            console.log(`Image attachment saved: ${processedMessage.imageAttachmentPath}`);
          }
          if (processedMessage.documentAttachmentPath) {
            console.log(`Document attachment saved: ${processedMessage.documentAttachmentPath}`);
          }
          if (processedMessage.videoAttachmentPath) {
            console.log(`Video attachment saved: ${processedMessage.videoAttachmentPath}`);
          }
          if (processedMessage.linkMetadata) {
            console.log(`Link metadata saved as JSON:`, JSON.stringify(processedMessage.linkMetadata));
          }
          if (processedMessage.batchAttachmentPath) {
            console.log(`Batch attachment saved: ${processedMessage.batchAttachmentPath}`);
          }
          
          // Log reply information if present
          if (processedMessage.replyToMessageId) {
            console.log(`Reply to message: ${processedMessage.replyToMessageId}`);
            console.log(`Reply text: ${processedMessage.replyText?.substring(0, 50) || 'None'}`);
            if (processedMessage.replyAttachmentType) {
              console.log(`Reply attachment type: ${processedMessage.replyAttachmentType}`);
            }
          }
          
          // Broadcast message to connected clients if server is available
          if (this.server && typeof this.server.broadcastNewMessage === 'function') {
            this.server.broadcastNewMessage({
              id: insertId,
              groupId: processedMessage.groupId,
              groupName: processedMessage.groupName,
              senderName: processedMessage.senderName,
              messageText: processedMessage.messageText,
              timestamp: processedMessage.timestamp,
              imageAttachmentPath: processedMessage.imageAttachmentPath,
              documentAttachmentPath: processedMessage.documentAttachmentPath,
              videoAttachmentPath: processedMessage.videoAttachmentPath,
              linkMetadata: processedMessage.linkMetadata,
              batchAttachmentPath: processedMessage.batchAttachmentPath,
              batchMetadata: processedMessage.batchMetadata,
              replyToMessageId: processedMessage.replyToMessageId,
              replyText: processedMessage.replyText,
              replyAttachmentType: processedMessage.replyAttachmentType,
              replyAttachmentPath: processedMessage.replyAttachmentPath
            });
          }
        } else {
          console.log('Message processing failed or message was invalid');
        }
      } catch (error) {
        console.error('Error handling message:', error);
      }
    });

    // We're not handling message_create events to avoid duplicate messages
  }

  /**
   * Handle QR code for authentication
   * @param {string} qr - QR code data
   */
  handleQRCode(qr) {
    console.log('Scan the QR code with your WhatsApp app:');
    qrcode.generate(qr, { small: true });
  }

  /**
   * Check if message is from the business account itself or is a status message
   * @param {Object} message - WhatsApp message object
   * @returns {boolean} - True if message is from business account or is a status
   */
  isBusinessMessage(message) {
    if (!message.from || !this.businessPhoneNumber) return false;
    
    // Check if it's from the business account
    const isFromBusiness = message.author && message.author.includes(this.businessPhoneNumber);
    
    // Check if it's a status message
    const isStatus = message.isStatus === true || message.from.includes('status@broadcast');
    
    return isFromBusiness || isStatus;
  }

  /**
   * Get all groups where the business account is a member
   * @param {number} retryCount - Number of retries attempted (default: 0)
   * @param {number} retryDelay - Delay between retries in ms (default: 2000)
   * @returns {Promise<Array>} - Promise resolving to array of group objects
   */
  
  async getAllGroups(retryCount = 0, retryDelay = 2000) {
    try {
      console.log(`Attempting to get all groups (attempt ${retryCount + 1})`);
      
      // Check if client is ready before proceeding
      if (!this.client || !this.client.info) {
        console.log('Client not fully initialized, waiting before getting groups...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      const chats = await this.client.getChats();
      const groups = chats.filter(chat => chat.isGroup);
      
      console.log(`Found ${groups.length} groups:`);
      groups.forEach(group => {
        console.log(`- ${group.name} (${group.id._serialized})`);
      });
      
      return groups;
    } catch (error) {
      console.error(`Error getting groups (attempt ${retryCount + 1}):`, error);
      
      // Implement retry logic with exponential backoff
      if (retryCount < 3) { // Maximum 3 retries
        const nextRetryDelay = retryDelay * 1.5;
        console.log(`Retrying getAllGroups in ${nextRetryDelay/1000} seconds...`);
        
        return new Promise(resolve => {
          setTimeout(async () => {
            try {
              const groups = await this.getAllGroups(retryCount + 1, nextRetryDelay);
              resolve(groups);
            } catch (retryError) {
              console.error('All retries failed for getAllGroups');
              resolve([]); // Return empty array after all retries fail
            }
          }, nextRetryDelay);
        });
      }
      
      console.error('Maximum retries reached for getAllGroups');
      return []; // Return empty array after maximum retries
    }
  }

  /**
   * Initialize groups with retry mechanism
   * @param {number} attempt - Current attempt number (default: 1)
   * @returns {Promise<Array>} - Promise resolving to array of initialized groups
   */
  async initializeGroups(attempt = 1) {
    const maxAttempts = 5;
    const delayBetweenAttempts = 5000; // 5 seconds
    
    try {
      console.log(`Initializing groups (attempt ${attempt}/${maxAttempts})...`);
      const groups = await this.getAllGroups();
      console.log(`Successfully initialized ${groups.length} groups`);
      
      // If no groups found and we haven't reached max attempts, retry after a delay
      if (groups.length === 0 && attempt < maxAttempts) {
        console.log(`No groups found, will retry in ${delayBetweenAttempts/1000} seconds...`);
        return new Promise(resolve => {
          setTimeout(async () => {
            const retryGroups = await this.initializeGroups(attempt + 1);
            resolve(retryGroups);
          }, delayBetweenAttempts);
        });
      }
      
      return groups;
    } catch (error) {
      console.error(`Error initializing groups (attempt ${attempt}/${maxAttempts}):`, error);
      
      // Retry if we haven't reached max attempts
      if (attempt < maxAttempts) {
        console.log(`Will retry group initialization in ${delayBetweenAttempts/1000} seconds...`);
        return new Promise(resolve => {
          setTimeout(async () => {
            const retryGroups = await this.initializeGroups(attempt + 1);
            resolve(retryGroups);
          }, delayBetweenAttempts);
        });
      }
      
      console.error('Maximum attempts reached for group initialization');
      return [];
    }
  }
  
  /**
   * Test method to fetch recent messages from all groups
   */
  async testGroupMessages() {
    try {
      const groups = await this.getAllGroups();
      
      for (const group of groups) {
        console.log(`\nFetching messages from: ${group.name}`);
        const messages = await group.fetchMessages({ limit: 5 });
        
        console.log(`Found ${messages.length} recent messages:`);
        messages.forEach((msg, index) => {
          console.log(`${index + 1}. ${msg.author}: ${msg.body.substring(0, 50)}...`);
        });
      }
    } catch (error) {
      console.error('Error testing group messages:', error);
    }
  }
}

module.exports = WhatsAppClient;