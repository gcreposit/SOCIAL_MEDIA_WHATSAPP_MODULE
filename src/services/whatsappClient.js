/**
 * Persistent WhatsApp Client - Maintains login until manually logged out
 * This client focuses on connection stability rather than session expiration
 * Enhanced with RemoteAuth for better session persistence
 */

const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
const os = require('os');

class PersistentWhatsAppClient {
  constructor(messageProcessor, dbService, server = null) {
    this.client = null;
    this.messageProcessor = messageProcessor;
    this.dbService = dbService;
    this.businessPhoneNumber = null;
    this.server = server;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20; // Increased from 15 to 20 for large-scale operation with 400+ groups
    this.sessionPath = process.env.WHATSAPP_SESSION_DATA_PATH || path.join(process.cwd(), 'whatsapp-session');
    this.isClientReady = false;
    this.isAuthenticated = false;
    this.connectionMonitor = null;
    this.lockRefreshInterval = null; // For session locking
    this.groupRefreshInterval = null; // For periodic group initialization
    this.lastHeartbeat = new Date();
    this.forceReconnect = false;
    this.staleConnectionCount = 0;
    this.lastStaleConnectionTime = null;
    this.connectionCheckCount = 0;
    this.partialGroupRefreshScheduled = false;
    this.groupInitializationAttempts = 0;
    
    // Enhanced session management for large-scale operation
    this.useRemoteAuth = process.env.USE_REMOTE_AUTH === 'true';
    this.mongoUri = process.env.MONGODB_URI;
    
    // Persistent connection settings optimized for 400+ groups
    this.persistentMode = true;
    this.heartbeatInterval = 90000; // Increased from 60 to 90 seconds for large-scale operation
    this.maxIdleTime = 15 * 60 * 1000; // Increased from 10 to 15 minutes for large-scale operation
    this.aggressiveReconnect = false; // Changed to false to reduce aggressive reconnection
  }

  /**
   * Initialize with persistent connection strategy and session locking
   */
  async initializeClient(forceNewSession = false) {
    // Create a lock file to prevent multiple instances from using the same session
    const lockFilePath = path.join(this.sessionPath, 'session.lock');
    
    try {
      console.log('🚀 Initializing Persistent WhatsApp Client...');
      
      // Ensure proper file permissions for session storage
      await this.ensureProperPermissions();
      
      // Check if lock file exists and is recent (less than 5 minutes old)
      if (fs.existsSync(lockFilePath)) {
        try {
          const lockStats = fs.statSync(lockFilePath);
          const lockAge = Date.now() - lockStats.mtimeMs;
          
          // If lock is recent (less than 5 minutes old), another instance might be running
          if (lockAge < 5 * 60 * 1000) {
            console.log('⚠️ Session lock file found! Another instance might be running');
            console.log(`⏱️ Lock file age: ${Math.round(lockAge / 1000)}s`);
            
            // If lock is very recent (less than 30 seconds), wait and retry
            if (lockAge < 30 * 1000) {
              console.log('⏳ Lock file is very recent, waiting 30s before attempting to take over...');
              await new Promise(resolve => setTimeout(resolve, 30000));
            }
          } else {
            console.log('🔓 Found stale lock file, will override it');
          }
        } catch (lockError) {
          console.log('⚠️ Error reading lock file:', lockError.message);
        }
      }
      
      // Create or update lock file
      try {
        // Ensure directory exists
        if (!fs.existsSync(this.sessionPath)) {
          fs.mkdirSync(this.sessionPath, { recursive: true, mode: 0o755 });
        }
        
        // Write process info to lock file
        const lockData = JSON.stringify({
          pid: process.pid,
          timestamp: Date.now(),
          hostname: os.hostname()
        });
        fs.writeFileSync(lockFilePath, lockData);
        console.log('🔒 Created session lock file');
      } catch (lockError) {
        console.log('⚠️ Could not create lock file:', lockError.message);
      }
      
      // Only clear session if explicitly forced (manual logout detected)
      if (forceNewSession) {
        console.log('🧹 Force clearing session due to logout detection...');
        await this.clearSession();
        this.isAuthenticated = false;
      }

      // Check if we have existing authentication
      const hasExistingAuth = this.checkExistingAuth();
      if (hasExistingAuth && !forceNewSession) {
        console.log('✅ Existing authentication found, attempting to restore...');
      }

      await this.destroyExistingClient();
      await this.createNewClient();
      await this.startClient();
      
      return true;
    } catch (error) {
      console.error('❌ Client initialization failed:', error);
      await this.handleInitializationFailure(error);
      return false;
    } finally {
      // Set up automatic lock file refresh
      if (this.lockRefreshInterval) {
        clearInterval(this.lockRefreshInterval);
      }
      
      this.lockRefreshInterval = setInterval(() => {
        try {
          if (fs.existsSync(lockFilePath)) {
            // Update timestamp to keep lock fresh
            fs.utimesSync(lockFilePath, new Date(), new Date());
          } else {
            // Recreate if missing
            const lockData = JSON.stringify({
              pid: process.pid,
              timestamp: Date.now(),
              hostname: require('os').hostname()
            });
            fs.writeFileSync(lockFilePath, lockData);
          }
        } catch (error) {
          // Silent fail on lock refresh
        }
      }, 60000); // Refresh lock every minute
    }
  }

  /**
   * Create LocalAuth strategy with enhanced configuration
   */
  createLocalAuthStrategy() {
    return new LocalAuth({
      dataPath: this.sessionPath,
      clientId: 'persistent-whatsapp-client'
    });
  }

  /**
   * Check if existing authentication is available
   */
  checkExistingAuth() {
    try {
      if (this.useRemoteAuth) {
        // For RemoteAuth, we'll assume MongoDB connection means auth is available
        // The actual check will happen during client initialization
        console.log('📁 Using RemoteAuth with MongoDB, session persistence handled remotely');
        return true;
      }
      
      if (!fs.existsSync(this.sessionPath)) return false;
      
      // Look for session files that indicate authentication
      const sessionFiles = fs.readdirSync(this.sessionPath);
      const hasSessionFiles = sessionFiles.some(file => 
        file.includes('session') || file.includes('auth') || file.includes('.json')
      );
      
      console.log(`📁 Session files found: ${hasSessionFiles ? 'Yes' : 'No'}`);
      return hasSessionFiles;
    } catch (error) {
      console.log('📁 No existing session directory found');
      return false;
    }
  }

  /**
   * Destroy existing client safely with improved error handling
   */
  async destroyExistingClient() {
    if (this.client) {
      try {
        console.log('🔄 Destroying existing client...');
        this.stopConnectionMonitoring();
        
        // Add timeout to prevent hanging on destroy
        await Promise.race([
          this.client.destroy(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Client destroy timeout')), 30000) // 30 second timeout
          )
        ]);
        
        console.log('✅ Existing client destroyed');
      } catch (error) {
        console.log('⚠️ Error destroying existing client:', error.message);
        // If destroy times out or fails, force cleanup
        if (error.message.includes('timeout') || error.message.includes('Session closed')) {
          console.log('🧹 Forcing client cleanup after destroy failure');
          // Force cleanup of resources
          this.client = null;
          this.isClientReady = false;
          // Don't throw, just continue with initialization
        }
      }
      this.client = null;
      this.isClientReady = false;
    }
  }

  /**
   * Create new client with persistent settings and enhanced authentication
   */
  async createNewClient() {
    console.log('🔧 Creating new WhatsApp client...');
    
    let authStrategy;
    
    // Use RemoteAuth with MongoDB if configured
    if (this.useRemoteAuth) {
      try {
        console.log('🔄 Attempting to connect to MongoDB for RemoteAuth...');
        await mongoose.connect(this.mongoUri);
        const store = new MongoStore({ mongoose: mongoose });
        authStrategy = new RemoteAuth({
          store: store,
          backupSyncIntervalMs: 300000, // 5 minutes
          clientId: 'persistent-whatsapp-client'
        });
        console.log('✅ Using RemoteAuth with MongoDB for better session persistence');
      } catch (mongoError) {
        console.warn('⚠️ MongoDB connection failed, falling back to LocalAuth:', mongoError.message);
        authStrategy = this.createLocalAuthStrategy();
      }
    } else {
      authStrategy = this.createLocalAuthStrategy();
    }
    
    this.client = new Client({
      authStrategy: authStrategy,
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--no-experiments',
          '--no-default-browser-check',
          '--disable-extensions',
          '--disable-translate',
          '--disable-sync',
          '--disable-background-networking',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--disable-features=TranslateUI',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--force-color-profile=srgb',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
          '--use-mock-keychain'
        ],
        timeout: 180000, // Reduced from 5 minutes to 3 minutes timeout
        ignoreDefaultArgs: ['--disable-extensions'],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
      },
      qrMaxRetries: 3, // Limit QR retries to 3 instead of infinite
      authTimeoutMs: 120000, // Set auth timeout to 2 minutes instead of infinite
      restartOnAuthFail: true, // Let the library handle auth failures
      takeoverOnConflict: true,
      takeoverTimeoutMs: 15000 // Reduced from 30s to 15s
    });

    this.registerPersistentEventHandlers();
  }
  // -----------------------BACKUP KI STRATEGY YHNI PE LGA DIJIYE------------------------------------------

  /**
   * Start the client with retry logic
   */
  async startClient() {
    console.log('▶️ Starting WhatsApp client...');
    await this.client.initialize();
  }

  /**
   * Register event handlers for persistent connection
   */
  registerPersistentEventHandlers() {
    // QR Code - only show if not authenticated
    this.client.on('qr', (qr) => {
      if (!this.isAuthenticated) {
        console.log('📱 QR code for authentication:');
        console.log(qr); // Log the raw QR code string for backend-only implementation
        
        // Generate terminal QR code for server environments
        qrcode.generate(qr, { small: true });
        
        // Log instructions for backend-only implementation
        console.log('⏳ For backend-only implementation: Copy this QR code and scan it with your WhatsApp app');
        console.log('⏳ You can also use a QR code generator with the string above');
      }
    });

    // Authentication success
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp authenticated successfully!');
      this.isAuthenticated = true;
      this.reconnectAttempts = 0; // Reset on successful auth
    });

    // Ready event
    // Ready event - with improved group initialization timing
this.client.on('ready', async () => {
  console.log('✅ WhatsApp client is ready and connected!');
  this.isClientReady = true;
  this.isAuthenticated = true;
  this.lastHeartbeat = new Date();
  
  // Get business info
  try {
    const info = this.client.info;
    this.businessPhoneNumber = info.wid.user;
    console.log(`📞 Connected as: ${this.businessPhoneNumber}`);
    console.log(`👤 Display name: ${info.pushname}`);
  } catch (error) {
    console.log('⚠️ Could not get business info immediately:', error.message);
  }
  
  // Reset reconnection attempts
  this.reconnectAttempts = 0;
  
  // Start persistent connection monitoring
  this.startConnectionMonitoring();
  
  // Initialize groups with progressive retry strategy for backend-only mode
  console.log('⏳ Waiting for WhatsApp Web to fully synchronize...');
  
  // First attempt after short delay
  setTimeout(async () => {
    try {
      const groups = await this.initializeGroups(1, 5);
      if (groups.length === 0) {
        console.log('⏳ No groups found on first attempt, scheduling additional attempts...');
        
        // Second attempt after longer delay if first attempt found no groups
        setTimeout(async () => {
          try {
            await this.initializeGroups(1, 5);
          } catch (secondError) {
            console.error('❌ Second group loading attempt failed:', secondError.message);
          }
        }, 30000); // Try again after 30 seconds
      }
    } catch (error) {
      console.error('❌ Initial group loading failed:', error.message);
      console.log('🔄 Groups will be retried automatically...');
      
      // Retry after error with longer delay
      setTimeout(async () => {
        try {
          await this.initializeGroups(1, 5);
        } catch (retryError) {
          console.error('❌ Retry group loading failed:', retryError.message);
        }
      }, 45000); // Try again after 45 seconds if first attempt errored
    }
  }, 15000); // First attempt after 15 seconds
});

    // Authentication failure - handle gracefully
    this.client.on('auth_failure', (msg) => {
      console.error('🚨 Authentication failed:', msg);
      this.isAuthenticated = false;
      this.isClientReady = false;
      
      // Don't clear session immediately - might be temporary
      console.log('⏳ Will retry authentication...');
      setTimeout(() => this.handleAuthFailure(), 5000);
    });

    // Disconnection - the key event for persistent connection
    this.client.on('disconnected', (reason) => {
      console.log(`🔌 Disconnected: ${reason}`);
      this.isClientReady = false;
      
      // Check if this is a logout (session invalidation)
      const isLogout = reason === 'UNPAIRED' || reason === 'UNPAIRED_DEVICE' || 
                      reason === 'LOGOUT' || reason.includes('LOGOUT');
      
      if (isLogout) {
        console.log('👋 Logout detected - user manually logged out');
        this.isAuthenticated = false;
        this.clearSession(); // Only clear on actual logout
      } else {
        console.log('🔄 Connection lost - will attempt to reconnect...');
      }
      
      this.handleDisconnection(reason);
    });

    // Loading screen
    this.client.on('loading_screen', (percent, message) => {
      if (percent % 25 === 0 || percent > 90) { // Show every 25% and final stages
        console.log(`⏳ Loading: ${percent}% - ${message}`);
      }
    });

    // State changes
    this.client.on('change_state', (state) => {
      console.log(`🔄 State changed: ${state}`);
      if (state === 'CONNECTED') {
        this.isClientReady = true;
        this.lastHeartbeat = new Date();
      } else if (state === 'DISCONNECTED' || state === 'UNPAIRED') {
        this.isClientReady = false;
      }
    });

    // Message handling
    this.client.on('message', async (message) => {
      this.lastHeartbeat = new Date(); // Update heartbeat on message
      await this.handleIncomingMessage(message);
    });

    // Remote session saved (another device paired)
    this.client.on('remote_session_saved', () => {
      console.log('💾 Remote session saved - another device was paired');
    });
  }

  /**
   * Clean up old backups using LIFO (Stack) approach
   * Keeps only the latest 2 backups, removes older ones
   */
  async cleanupOldBackups() {
    try {
      if (!this.useRemoteAuth) return; // Only for RemoteAuth
      
      const db = mongoose.connection.db;
      const filesCollection = db.collection('whatsapp-RemoteAuth-persistent-whatsapp-client.files');
      const chunksCollection = db.collection('whatsapp-RemoteAuth-persistent-whatsapp-client.chunks');
      
      // Get all backup files sorted by upload date (newest first - Stack LIFO)
      const backupFiles = await filesCollection
        .find({})
        .sort({ uploadDate: -1 }) // Newest first
        .toArray();
      
      // Keep only latest 2 backups (top 2 of stack)
      if (backupFiles.length > 2) {
        const filesToDelete = backupFiles.slice(2); // Remove everything after top 2
        
        for (const file of filesToDelete) {
          // Delete file metadata
          await filesCollection.deleteOne({ _id: file._id });
          // Delete corresponding chunks
          await chunksCollection.deleteMany({ files_id: file._id });
        }
        
        console.log(`🧹 Stack cleanup: Removed ${filesToDelete.length} old backups, kept latest 2`);
      }
    } catch (error) {
      console.error('❌ Backup cleanup failed:', error.message);
    }
  }

  /**
   * Start connection monitoring for persistent connection with improved stability
   */
  startConnectionMonitoring() {
    this.stopConnectionMonitoring(); // Clear any existing monitor
    
    console.log('🔍 Starting connection monitoring...');
    
    // Increase heartbeat interval for more stability (less frequent checks)
    this.heartbeatInterval = Math.max(this.heartbeatInterval, 60000); // Minimum 60 seconds
    
    console.log(`⏱️ Connection check interval set to ${this.heartbeatInterval/1000}s`);
    
    this.connectionMonitor = setInterval(async () => {
      // Add random jitter to prevent synchronized failures
      const jitter = Math.floor(Math.random() * 5000); // 0-5 seconds jitter
      await new Promise(resolve => setTimeout(resolve, jitter));
      
      try {
        await this.performConnectionCheck();
      } catch (error) {
        console.log('⚠️ Error in connection monitoring cycle:', error.message);
        // Don't crash the monitoring loop on errors
      }
    }, this.heartbeatInterval);
    
    // Set up backup cleanup interval - run every 10 minutes
    setInterval(async () => {
      await this.cleanupOldBackups();
    }, 10 * 60 * 1000); // Clean every 10 minutes
    
    // Add periodic group initialization for backend-only mode
    // This ensures groups are eventually loaded even if initial attempts fail
    if (this.groupRefreshInterval) {
      clearInterval(this.groupRefreshInterval);
    }
    
    // Check for groups every 5 minutes if none were found initially
    this.groupRefreshInterval = setInterval(async () => {
      try {
        // Only attempt to refresh groups if client is ready
        if (this.isClientReady) {
          const groups = await this.client.getChats();
          const groupCount = groups.filter(chat => chat.isGroup).length;
          
          if (groupCount === 0) {
            console.log('🔄 No groups found, attempting to initialize groups again...');
            await this.initializeGroups(1, 3); // Use fewer attempts for periodic checks
          } else {
            console.log(`✅ Periodic check: ${groupCount} groups available`);
          }
        }
      } catch (error) {
        console.error('❌ Periodic group refresh failed:', error.message);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    console.log('🔄 Periodic group refresh scheduled (every 5 minutes)');
  }

  /**
   * Stop connection monitoring and cleanup intervals
   */
  stopConnectionMonitoring() {
    if (this.connectionMonitor) {
      clearInterval(this.connectionMonitor);
      this.connectionMonitor = null;
      console.log('🛑 Connection monitoring stopped');
    }
    
    if (this.groupRefreshInterval) {
      clearInterval(this.groupRefreshInterval);
      this.groupRefreshInterval = null;
      console.log('🛑 Group refresh stopped');
    }
    
    // Don't clear lock refresh interval here - it should persist until process exit
    // to prevent other instances from taking over while we're reconnecting
  }

  /**
   * Perform connection health check with improved timeout handling
   * Optimized for large-scale operation with 400+ groups
   */
  async performConnectionCheck() {
    try {
      if (!this.client || !this.isClientReady) {
        console.log('💔 Connection check: Client not ready');
        return;
      }

      // Check if connection is stale - with increased tolerance for large-scale operations
      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat.getTime();
      const adjustedMaxIdleTime = this.maxIdleTime * 1.5; // 50% more tolerance for large-scale operations
      if (timeSinceLastHeartbeat > adjustedMaxIdleTime) {
        console.log(`💤 Connection appears idle for ${Math.round(timeSinceLastHeartbeat/1000)}s (adjusted threshold: ${Math.round(adjustedMaxIdleTime/1000)}s)`);
        await this.performActiveHealthCheck();
        return;
      }

      // Monitor memory usage for large-scale operations
      this.connectionCheckCount = (this.connectionCheckCount || 0) + 1;
      if (this.connectionCheckCount % 10 === 0) { // Log every 10 checks to avoid excessive logging
        try {
          const memoryUsage = process.memoryUsage();
          const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
          const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
          const heapPercentage = Math.round((heapUsedMB / heapTotalMB) * 100);
          console.log(`📊 Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapPercentage}%)`);
          
          // If memory usage is too high, suggest garbage collection
          if (heapPercentage > 85) {
            console.log('⚠️ High memory usage detected, suggesting garbage collection');
            if (global.gc) {
              console.log('🧹 Running garbage collection');
              global.gc();
            } else {
              console.log('💡 To enable manual garbage collection, run with --expose-gc flag');
            }
          }
        } catch (memError) {
          // Ignore memory check errors
        }
      }

      // Passive check - just verify state with timeout
      const state = await Promise.race([
        this.client.getState(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Connection check timeout')), 15000) // 15 second timeout
        )
      ]);
      
      if (state === 'CONNECTED') {
        // Update heartbeat on successful check
        this.lastHeartbeat = new Date();
        
        // Reset stale connection counter on successful connection
        if (this.staleConnectionCount && this.staleConnectionCount > 0) {
          console.log('✅ Connection restored, resetting stale connection counter');
          this.staleConnectionCount = 0;
        }
        
        // For large-scale operation, check if we have all expected groups
        if (this.isAuthenticated) {
          try {
            const groups = await this.client.getChats();
            const groupCount = groups.filter(chat => chat.isGroup).length;
            if (groupCount === 0) {
              console.log('⚠️ No groups found, attempting to initialize groups');
              this.initializeGroups();
            } else if (groupCount > 0 && groupCount < 400) {
              // For large-scale operation, if we have some groups but not all (expecting ~400)
              console.log(`📊 Only ${groupCount} groups found (expecting ~400), scheduling refresh`);
              // Don't initialize immediately, but schedule a refresh if not already scheduled
              if (!this.partialGroupRefreshScheduled) {
                this.partialGroupRefreshScheduled = true;
                setTimeout(() => {
                  console.log('🔄 Performing scheduled group refresh to find missing groups');
                  this.initializeGroups();
                  this.partialGroupRefreshScheduled = false;
                }, 60000); // Wait 1 minute before refreshing to avoid rate limits
              }
            }
          } catch (groupError) {
            console.log('⚠️ Error checking groups:', groupError.message);
          }
        }
      } else {
        console.log(`⚠️ Connection check: State is ${state}`);
        if (state === 'UNPAIRED' || state === 'UNPAIRED_DEVICE') {
          console.log('🚨 Device unpaired detected!');
          this.isAuthenticated = false;
          await this.handleDisconnection(state);
        } else if (state === 'DISCONNECTED') {
          // Don't immediately handle as disconnection
          // First try active health check to confirm
          console.log('⚠️ Disconnected state detected, performing active health check');
          await this.performActiveHealthCheck();
        }
      }
    } catch (error) {
      console.log('❌ Connection check failed:', error.message);
      // Log more details about the error for better debugging
      if (error.stack) {
        console.log('📊 Error stack:', error.stack.split('\n').slice(0, 3).join('\n'));
      }
      await this.performActiveHealthCheck();
    }
  }

  /**
   * Perform active health check when passive check fails with improved resilience
   */
  async performActiveHealthCheck() {
    try {
      console.log('🏥 Performing active health check...');
      
      // Try multiple health check methods
      let healthCheckPassed = false;
      
      // Method 1: Try to get state with increased timeout
      try {
        await Promise.race([
          this.client.getState(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('State check timeout')), 20000)) // Increased to 20s
        ]);
        healthCheckPassed = true;
        console.log('✅ Active health check passed (state check)');
      } catch (stateError) {
        console.log('⚠️ State check failed:', stateError.message);
        
        // Method 2: Try to get connection state through info
        try {
          await Promise.race([
            this.client.info.getBatteryStatus(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Battery check timeout')), 15000))
          ]);
          healthCheckPassed = true;
          console.log('✅ Active health check passed (battery check)');
        } catch (batteryError) {
          console.log('⚠️ Battery check failed:', batteryError.message);
        }
      }
      
      if (healthCheckPassed) {
        this.lastHeartbeat = new Date();
        // If we had pending reconnection attempts, reduce the counter
        if (this.reconnectAttempts > 0) {
          this.reconnectAttempts--;
          console.log(`🔄 Reducing reconnect attempts to ${this.reconnectAttempts} after successful health check`);
        }
      } else {
        console.log('🚨 All active health checks failed - connection is stale');
        console.log('🔄 Attempting reconnection...');
        await this.handleConnectionStale();
      }
    } catch (error) {
      console.log('🚨 Active health check failed with unexpected error:', error.message);
      console.log('🔄 Attempting reconnection...');
      await this.handleConnectionStale();
    }
  }

  /**
   * Handle stale connection with improved stability
   */
  async handleConnectionStale() {
    this.isClientReady = false;
    
    // Check if we've had too many stale connections in a short period
    const now = new Date();
    if (!this.lastStaleConnectionTime) {
      this.lastStaleConnectionTime = now;
      this.staleConnectionCount = 1;
    } else {
      // If last stale connection was within 5 minutes, increment counter
      // otherwise reset counter
      const timeSinceLastStale = now - this.lastStaleConnectionTime;
      if (timeSinceLastStale < 5 * 60 * 1000) { // 5 minutes
        this.staleConnectionCount++;
      } else {
        this.staleConnectionCount = 1;
      }
      this.lastStaleConnectionTime = now;
    }
    
    // Don't clear session - just reconnect, but with increasing delay
    console.log(`🔄 Reconnecting due to stale connection (${this.staleConnectionCount} in recent period)...`);
    
    // Adaptive delay based on recent stale connection frequency
    const baseDelay = 10000; // 10 seconds base delay (increased from 5s)
    const delay = Math.min(baseDelay * Math.pow(1.5, this.staleConnectionCount - 1), 60000); // Max 1 minute
    
    console.log(`⏱️ Waiting ${delay/1000}s before reconnection attempt`);
    
    setTimeout(async () => {
      try {
        // Only force new session if we've had many stale connections
        const forceNewSession = this.staleConnectionCount > 5;
        if (forceNewSession) {
          console.log('⚠️ Too many stale connections, forcing new session');
        }
        await this.initializeClient(forceNewSession);
      } catch (error) {
        console.error('🚨 Reconnection failed:', error);
      }
    }, delay);
  }

  /**
   * Handle disconnection with improved reconnection strategy and session persistence
   * Enhanced for large-scale operation with 400+ groups
   */
  handleDisconnection(reason = 'UNKNOWN') {
    this.stopConnectionMonitoring();
    
    // Log the disconnection reason for better debugging
    console.log(`📊 Disconnection occurred with reason: ${reason}`);
    
    // For large-scale operation, we need to be more patient with reconnections
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('🛑 Maximum reconnection attempts reached');
      console.log('💡 Suggestion: Please restart the application manually');
      // Reset reconnect attempts after a long delay to allow eventual recovery
      setTimeout(() => {
        console.log('🔄 Resetting reconnection counter after timeout period');
        this.reconnectAttempts = 0;
        // Try one more reconnection after the reset
        this.handleDisconnection('RECOVERY_AFTER_RESET');
      }, 30 * 60 * 1000); // 30 minutes
      return;
    }

    this.reconnectAttempts++;
    // Increase base delay and use gentler exponential backoff for large-scale operation
    const baseDelay = 20000; // Increased to 20 seconds for more stability
    const delay = Math.min(baseDelay * Math.pow(1.2, this.reconnectAttempts - 1), 180000); // Max 3 minutes
    
    console.log(`🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay/1000}s`);
    
    // Check if session files still exist before reconnecting
    const hasSessionFiles = this.checkExistingAuth();
    
    setTimeout(async () => {
      try {
        // Be more conservative with forcing new sessions for large-scale operation
        // Only force new session for explicit logout/unpair or after multiple failures
        const forceNewSession = 
          // Only force for explicit logout reasons
          (reason === 'LOGOUT' || reason === 'UNPAIRED' || reason === 'UNPAIRED_DEVICE') || 
          // Or if session files are missing
          (!hasSessionFiles) || 
          // Or after many failed attempts (increased threshold for large-scale operation)
          (this.reconnectAttempts > 5); // Only clear session after 5 failed attempts
        
        if (forceNewSession) {
          console.log(`⚠️ Forcing new session due to: ${reason === 'LOGOUT' || reason === 'UNPAIRED' || reason === 'UNPAIRED_DEVICE' ? 
            'explicit logout/unpair' : 
            (!hasSessionFiles ? 'missing session files' : 'multiple reconnection failures')}`);
        } else {
          console.log('🔐 Attempting to reuse existing session for better persistence');
        }
        
        // For large-scale operation, ensure proper permissions before reconnecting
        await this.ensureProperPermissions();
        await this.initializeClient(forceNewSession);
      } catch (error) {
        console.error('🚨 Reconnection failed:', error);
        // Log more detailed error information for debugging
        if (error.stack) {
          console.log('📊 Error stack:', error.stack.split('\n').slice(0, 3).join('\n'));
        }
        
        // For large-scale operation, we need to be more resilient
        // If this was a critical error, wait longer before next attempt
        if (error.message && (
          error.message.includes('ENOSPC') || // No space left on device
          error.message.includes('ENOMEM') || // Out of memory
          error.message.includes('browser crashed')
        )) {
          console.log('⚠️ Critical system error detected, adding extra delay before next attempt');
          setTimeout(() => {
            // Try again with a different approach
            this.handleDisconnection('RECOVERY_AFTER_ERROR');
          }, 60000); // Wait a full minute after critical errors
        }
        // Don't recursively retry - let the next disconnection event trigger a retry
        // This prevents cascading reconnection attempts
      }
    }, delay);
  }

  /**
   * Handle authentication failure
   */
  async handleAuthFailure() {
    console.log('🔐 Handling authentication failure...');
    
    // Wait a bit then retry
    setTimeout(async () => {
      try {
        await this.initializeClient(false);
      } catch (error) {
        console.error('🚨 Auth retry failed:', error);
        // If multiple auth failures, might need new session
        if (this.reconnectAttempts > 3) {
          console.log('🧹 Multiple auth failures - clearing session');
          await this.initializeClient(true);
        }
      }
    }, 10000);
  }

  /**
   * Handle initialization failure with improved error classification and recovery
   */
  async handleInitializationFailure(error) {
    this.reconnectAttempts++;
    
    // Log detailed error information for better debugging
    console.log('📊 Error type:', error.constructor.name);
    console.log('📊 Error message:', error.message);
    if (error.stack) {
      console.log('📊 Error stack (first 3 lines):', error.stack.split('\n').slice(0, 3).join('\n'));
    }
    
    // Categorize errors for better handling
    const errorMessage = error.message.toLowerCase();
    let additionalDelay = 0;
    
    // Browser/Protocol errors
    if (errorMessage.includes('protocol error') || 
        errorMessage.includes('session closed') || 
        errorMessage.includes('browser has disconnected') ||
        errorMessage.includes('target closed') ||
        errorMessage.includes('connection reset')) {
      console.log('🔄 Browser connection issue detected, adding recovery time...');
      additionalDelay = 5000; // Add 5 seconds for browser issues
    }
    // Browser installation/launch errors
    else if (errorMessage.includes('enoent') || 
             errorMessage.includes('failed to launch') ||
             errorMessage.includes('executable path')) {
      console.error('🚨 Critical browser error:', error.message);
      console.log('💡 Suggestion: Please check Chrome/Chromium installation');
      additionalDelay = 10000; // Add 10 seconds for installation issues
    }
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      // Increase base delay and use exponential backoff with a higher factor
      const baseDelay = 15000 + additionalDelay;
      const delay = Math.min(baseDelay * Math.pow(1.5, this.reconnectAttempts - 1), 180000);
      console.log(`🔄 Retry initialization in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(async () => {
        // Clear session earlier to avoid wasting time with invalid sessions
        const shouldClearSession = this.reconnectAttempts > 3 || 
                                  errorMessage.includes('auth') || 
                                  errorMessage.includes('session');
        await this.initializeClient(shouldClearSession);
      }, delay);
    } else {
      console.error('🛑 Initialization failed after maximum attempts');
      console.log('💡 Manual intervention required - please restart the application');
    }
  }

  /**
   * Ensure proper file permissions for session storage
   */
  async ensureProperPermissions() {
    try {
      // Create session directory if it doesn't exist
      if (!fs.existsSync(this.sessionPath)) {
        fs.mkdirSync(this.sessionPath, { 
          recursive: true, 
          mode: 0o755 // rwxr-xr-x
        });
      }
      
      // Set ownership and permissions
      const userId = process.getuid ? process.getuid() : null;
      const groupId = process.getgid ? process.getgid() : null;
      
      if (userId !== null && groupId !== null) {
        // Change ownership to current user
        const chownRecursive = (dirPath) => {
          try {
            fs.chownSync(dirPath, userId, groupId);
            const items = fs.readdirSync(dirPath);
            items.forEach(item => {
              const itemPath = path.join(dirPath, item);
              const stats = fs.statSync(itemPath);
              if (stats.isDirectory()) {
                chownRecursive(itemPath);
              } else {
                fs.chownSync(itemPath, userId, groupId);
              }
            });
          } catch (err) {
            console.warn(`⚠️ Could not set ownership for ${dirPath}: ${err.message}`);
          }
        };
        
        chownRecursive(this.sessionPath);
        console.log('✅ Session directory permissions set correctly');
      }
      
      // Set directory permissions
      fs.chmodSync(this.sessionPath, 0o755);
      console.log('✅ Session directory created with proper permissions');
      
    } catch (error) {
      console.warn('⚠️ Could not set permissions:', error.message);
      console.log('💡 Make sure the script runs with proper user permissions');
    }
  }

  /**
   * Clear session (only when explicitly needed)
   */
  async clearSession() {
    try {
      if (fs.existsSync(this.sessionPath)) {
        console.log('🧹 Clearing session data...');
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
        console.log('✅ Session cleared');
      }
    } catch (error) {
      console.error('❌ Error clearing session:', error);
    }
  }

  /**
   * Handle incoming messages
   */
  async handleIncomingMessage(message) {
    try {
      // Skip business messages
      if (this.isBusinessMessage(message)) return;
      
      // Skip non-group messages
      if (!message.from.includes('@g.us')) return;
      
      // Get message details for enhanced logging
      const messageContent = message.body || '[NO CONTENT]';
      const messageType = message.type || 'unknown';
      const timestamp = new Date(message.timestamp * 1000).toISOString();
      
      // Get group information
      let groupName = 'unavailable';
      try {
        const chat = await message.getChat();
        groupName = chat.isGroup ? chat.name : false;
      } catch (err) {
        const util = require('util');
        console.error('Error getting chat info:', util.inspect({ error: err.message }, { colors: true, depth: null }));
      }
      
      // Get sender information
      let senderInfo = 'unknown';
      try {
        if (message.author) {
          const contact = await this.client.getContactById(message.author);
          senderInfo = contact.pushname || contact.name || message.author;
        } else {
          const contact = await this.client.getContactById(message.from);
          senderInfo = contact.pushname || contact.name || message.from;
        }
      } catch (err) {
        senderInfo = message.author || message.from || 'unknown';
        const util = require('util');
        console.error('Error getting contact info:', util.inspect({ error: err.message }, { colors: true, depth: null }));
      }
      
      // Enhanced logging with JSON format and color
      const messageDetails = {
        content: messageContent,
        group: groupName === false ? '[NOT A GROUP]' : groupName,
        sender: senderInfo,
        time: timestamp,
        type: messageType
      };
      
      console.log('📩 MESSAGE DETAILS 📩');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      // Use util.inspect with colors enabled for pretty-printed colored output
      const util = require('util');
      console.log(util.inspect(messageDetails, { colors: true, depth: null }));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      
      // Process message
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
          processedMessage.audioAttachmentPath,
          processedMessage.linkMetadata,
          processedMessage.batchAttachmentPath,
          processedMessage.batchMetadata,
          processedMessage.replyToMessageId,
          processedMessage.replyText,
          processedMessage.replyAttachmentType,
          processedMessage.replyAttachmentPath,
          processedMessage.attachmentType
        );
        
        // Log saved message with color
        const util = require('util');
        console.log(`✅ Message saved:`, util.inspect({ id: insertId }, { colors: true, depth: null }));
        
        // Broadcast if server available
        if (this.server && typeof this.server.broadcastNewMessage === 'function') {
          this.server.broadcastNewMessage({
            id: insertId,
            ...processedMessage
          });
        }
      }
    } catch (error) {
      const util = require('util');
      console.error('❌ Error handling message:', util.inspect({ error: error.message }, { colors: true, depth: null }));
    }
  }

  /**
   * Initialize groups with improved robustness for backend-only mode
   * Enhanced for large-scale operation with 400+ groups
   */
  async initializeGroups(attempt = 1, maxAttempts = 10) {
    try {
      console.log(`📋 Initializing groups for large-scale operation (attempt ${attempt})...`);
      
      if (!this.isClientReady) {
        throw new Error('Client not ready');
      }
      
      // Wait for full readiness with more detailed logging
      let waitTime = 0;
      const maxWaitTime = 90000; // Increased from 60s to 90s for large-scale operations
      
      while ((!this.client.info || !this.businessPhoneNumber) && waitTime < maxWaitTime) {
        if (waitTime % 10000 === 0) { // Log every 10 seconds
          console.log(`⏳ Waiting for client info... (${waitTime/1000}s / ${maxWaitTime/1000}s)`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitTime += 1000;
      }
      
      if (!this.client.info || !this.businessPhoneNumber) {
        console.warn('⚠️ Timed out waiting for client info, attempting to get groups anyway');
      }
      
      // Force a sync before getting chats
      try {
        await this.client.getState();
      } catch (stateError) {
        console.warn('⚠️ Could not get client state:', stateError.message);
      }
      
      // Use Promise.race with timeout for large-scale operations
      const chats = await Promise.race([
        this.client.getChats(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout getting chats')), 60000))
      ]);
      const groups = chats.filter(chat => chat.isGroup);
      
      console.log(`✅ Found ${groups.length} groups`);
      
      // For large-scale operations, only log a summary instead of all groups
      if (groups.length > 20) {
        console.log(`   First 10 groups:`);
        groups.slice(0, 10).forEach((group, index) => {
          console.log(`   ${index + 1}. ${group.name}`);
        });
        console.log(`   ... and ${groups.length - 10} more groups`);
      } else {
        groups.forEach((group, index) => {
          console.log(`   ${index + 1}. ${group.name}`);
        });
      }
      
      // For large-scale operations, check if we have all expected groups
      if (groups.length > 0 && groups.length < 400) {
        console.log(`⚠️ Only ${groups.length} groups found (expecting ~400), will continue loading...`);
        
        // Schedule a refresh if we don't have all groups yet
        if (!this.partialGroupRefreshScheduled) {
          this.partialGroupRefreshScheduled = true;
          setTimeout(() => {
            console.log('🔄 Performing scheduled group refresh to find missing groups');
            this.initializeGroups();
            this.partialGroupRefreshScheduled = false;
          }, 60000); // Wait 1 minute before refreshing to avoid rate limits
        }
      } else if (groups.length >= 400) {
        console.log('🎉 All expected groups loaded successfully!');
      }
      
      return groups;
    } catch (error) {
      console.error(`❌ Group initialization failed (attempt ${attempt}/${maxAttempts}):`, error.message);
      
      // Log more detailed error information for debugging
      if (error.stack) {
        console.debug('Error stack:', error.stack.split('\n')[0]);
      }
      
      // Check client state
      try {
        const state = await this.client.getState();
        console.log(`📱 Current client state: ${state}`);
      } catch (stateError) {
        console.warn('⚠️ Could not get client state:', stateError.message);
      }
      
      if (attempt < maxAttempts) {
        // Exponential backoff with jitter for more reliable retry
        const baseDelay = 5000;
        const maxDelay = 60000; // Increased from 45s to 60s for large-scale operations
        const expBackoff = baseDelay * Math.pow(1.5, attempt - 1);
        const jitter = Math.random() * 2000 - 1000; // ±1s jitter
        const delay = Math.min(expBackoff + jitter, maxDelay);
        
        console.log(`🔄 Retry in ${Math.round(delay/1000)}s... (attempt ${attempt+1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.initializeGroups(attempt + 1, maxAttempts);
      }
      
      console.log('⚠️ Group initialization failed after all attempts');
      console.log('📝 The application will continue running and retry group initialization periodically');
      
      // For large-scale operations, ensure we have a periodic retry mechanism
      if (!this.groupRefreshInterval) {
        console.log('🔄 Setting up periodic group refresh every 5 minutes');
        this.groupRefreshInterval = setInterval(() => {
          console.log('🔄 Attempting periodic group initialization...');
          this.initializeGroups(1, 5); // Use fewer attempts for periodic checks
        }, 5 * 60 * 1000); // Every 5 minutes
      }
      
      return [];
    }
  }

  // Utility methods
  isBusinessMessage(message) {
    if (!message.from || !this.businessPhoneNumber) return false;
    const isFromBusiness = message.author && message.author.includes(this.businessPhoneNumber);
    const isStatus = message.isStatus === true || message.from.includes('status@broadcast');
    return isFromBusiness || isStatus;
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isReady: this.isClientReady,
      isAuthenticated: this.isAuthenticated,
      reconnectAttempts: this.reconnectAttempts,
      lastHeartbeat: this.lastHeartbeat,
      businessNumber: this.businessPhoneNumber
    };
  }
  
  /**
   * Force group initialization - useful for backend-only mode
   * @returns {Promise<Array>} - List of groups
   */
  async forceGroupInitialization() {
    console.log('🔄 Manually triggering group initialization...');
    
    if (!this.isClientReady) {
      console.warn('⚠️ Client not ready, cannot initialize groups');
      return [];
    }
    
    try {
      // Force a sync before getting chats
      try {
        await this.client.getState();
        console.log('✅ Client state synchronized');
      } catch (stateError) {
        console.warn('⚠️ Could not get client state:', stateError.message);
      }
      
      // Wait a moment for sync to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Get groups
      return await this.initializeGroups(1, 5);
    } catch (error) {
      console.error('❌ Manual group initialization failed:', error.message);
      return [];
    }
  }

  /**
   * Manual logout detection and handling
   */
  async handleManualLogout() {
    console.log('👋 Manual logout detected');
    this.isAuthenticated = false;
    this.isClientReady = false;
    await this.clearSession();
    
    // Wait a moment then reinitialize for fresh login
    setTimeout(() => {
      console.log('🔄 Ready for fresh authentication');
      this.initializeClient(true);
    }, 2000);
  }

  /**
   * Graceful shutdown for backend-only implementation
   */
  async shutdown() {
    console.log('🛑 Shutting down Persistent WhatsApp Client...');
    this.stopConnectionMonitoring();
    
    if (this.client) {
      try {
        // Force destroy the client with a timeout to prevent hanging
        const destroyPromise = this.client.destroy();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Client destroy timeout')), 10000)
        );
        
        await Promise.race([destroyPromise, timeoutPromise])
          .catch(error => {
            console.warn('⚠️ Client destroy timed out or failed:', error.message);
            console.log('Continuing shutdown process...');
          });
          
        console.log('✅ Client shutdown complete');
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        console.log('Continuing shutdown process despite error...');
      }
    }
  }
}

module.exports = PersistentWhatsAppClient;