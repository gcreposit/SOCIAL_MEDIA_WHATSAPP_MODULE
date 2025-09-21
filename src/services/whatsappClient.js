/**
 * Persistent WhatsApp Client - Maintains login until manually logged out
 * This client focuses on connection stability rather than session expiration
 * Enhanced with RemoteAuth for better session persistence
 */

const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const mongoose = require('mongoose');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
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
    this.maxReconnectAttempts = 0; // Disabled auto-restart to prevent restart after Ctrl+C
    this.sessionPath = process.env.WHATSAPP_SESSION_DATA_PATH || path.join(process.cwd(), 'whatsapp-session');
    this.isClientReady = false;
    this.isAuthenticated = false;
    this.connectionMonitor = null;
    this.lockRefreshInterval = null;
    this.groupRefreshInterval = null;
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
    this.heartbeatInterval = 90000;
    this.maxIdleTime = 15 * 60 * 1000;
    this.aggressiveReconnect = false;

    // QR Code management for web interface
    this.currentQRCode = null;
    this.qrCodeBase64 = null;
    this.lastQRCodeTime = null;

    // Memory management and periodic restart settings
    this.periodicRestartTimer = null;
    this.periodicRestartInterval = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
    
    // Cache maintenance timer
    this.cacheMaintenanceTimer = null;
    this.cacheMaintenanceInterval = 5 * 24 * 60 * 60 * 1000; // 5 days
    this.lastCacheCleanup = Date.now();
    
    // Cache monitoring
    this.cacheMonitoringTimer = null;
    this.cacheMonitoringInterval = 2 * 60 * 60 * 1000; // 2 hours
    this.cacheWarningThreshold = 100; // MB
    this.cacheCriticalThreshold = 200; // MB
    
    // Disk space monitoring
    this.diskSpaceMonitoringTimer = null;
    this.diskSpaceMonitoringInterval = 4 * 60 * 60 * 1000; // 4 hours
    this.diskSpaceWarningThreshold = 1024; // MB (1GB)
    this.diskSpaceCriticalThreshold = 512; // MB (512MB)
    this.memoryThreshold = 90; // Restart when heap usage exceeds 90%
    this.lastRestartTime = new Date();
    this.restartCount = 0;
    
    // Session synchronization flags to prevent corruption during restarts
    this.isSessionSaving = false;
    this.sessionSaveQueue = [];
    this.restartPending = false;
    this.sessionOperationTimeout = 30000; // 30 seconds timeout for session operations
  }

  /**
   * Initialize with persistent connection strategy and session locking
   */
  async initializeClient(forceNewSession = false) {
    // Check if we're shutting down
    if (global.isShuttingDown) {
      console.log('⚠️ Shutdown in progress, aborting initialization');
      return false;
    }

    const lockFilePath = path.join(this.sessionPath, 'session.lock');

    try {
      console.log('🚀 Initializing Persistent WhatsApp Client...');

      await this.ensureProperPermissions();

      // Handle lock file logic
      if (fs.existsSync(lockFilePath)) {
        try {
          const lockStats = fs.statSync(lockFilePath);
          const lockAge = Date.now() - lockStats.mtimeMs;

          if (lockAge < 5 * 60 * 1000) {
            console.log('⚠️ Session lock file found! Another instance might be running');
            console.log(`⏱️ Lock file age: ${Math.round(lockAge / 1000)}s`);

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

      // Create lock file
      try {
        if (!fs.existsSync(this.sessionPath)) {
          fs.mkdirSync(this.sessionPath, { recursive: true, mode: 0o755 });
        }

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

      if (forceNewSession) {
        console.log('🧹 Force clearing session due to logout detection...');
        await this.clearSession();
        this.isAuthenticated = false;
      }

      const hasExistingAuth = this.checkExistingAuth();
      if (hasExistingAuth && !forceNewSession) {
        console.log('✅ Existing authentication found, attempting to restore...');
      }

      await this.destroyExistingClient();
      await this.createNewClient();
      await this.startClient();

      return true;
    } catch (error) {
      if (!global.isShuttingDown) {
        console.error('❌ Client initialization failed:', error);
        await this.handleInitializationFailure(error);
      }
      return false;
    } finally {
      // Set up automatic lock file refresh
      if (this.lockRefreshInterval) {
        clearInterval(this.lockRefreshInterval);
      }

      this.lockRefreshInterval = setInterval(() => {
        try {
          if (fs.existsSync(lockFilePath)) {
            fs.utimesSync(lockFilePath, new Date(), new Date());
          } else {
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
      }, 60000);
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
        console.log('📁 Using RemoteAuth with MongoDB, session persistence handled remotely');
        return true;
      }

      if (!fs.existsSync(this.sessionPath)) return false;

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

        await Promise.race([
          this.client.destroy(),
          new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Client destroy timeout')), 30000)
          )
        ]);

        console.log('✅ Existing client destroyed');
      } catch (error) {
        console.log('⚠️ Error destroying existing client:', error.message);
        if (error.message.includes('timeout') || error.message.includes('Session closed')) {
          console.log('🧹 Forcing client cleanup after destroy failure');
          this.client = null;
          this.isClientReady = false;
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

    // Add mongoose error handler for network timeouts
    mongoose.connection.on('error', async (err) => {
      if (err.name === 'MongoNetworkTimeoutError' ||
          err.name === 'MongoNetworkError' ||
          err.message.includes('timed out')) {
        console.error('⚠️ MongoDB connection error detected:', err.name);
        console.log('🔄 Attempting to reconnect to MongoDB...');

        try {
          await this.reconnectMongoDB();
          console.log('✅ MongoDB reconnected successfully after error');
        } catch (reconnectError) {
          console.error('❌ MongoDB reconnection failed:', reconnectError.message);
        }
      }
    });

    // Use RemoteAuth with MongoDB if configured
    if (this.useRemoteAuth) {
      try {
        console.log('🔄 Attempting to connect to MongoDB for RemoteAuth...');
        await this.ensureSafeMongoConnection();
        console.log('✅ MongoDB connected successfully');

        const store = new MongoStore({
          mongoose: mongoose,
          collectionName: 'whatsapp-RemoteAuth-persistent-whatsapp-client'
        });

        authStrategy = new RemoteAuth({
          store: store,
          backupSyncIntervalMs: 300000,
          clientId: 'persistent-whatsapp-client',
          dataPath: this.sessionPath,
          rmMaxRetries: 10
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
      webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html"
      },
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage', // Critical for Z_BUF_ERROR prevention
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
        timeout: 180000,
        ignoreDefaultArgs: ['--disable-extensions'],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
      },
      qrMaxRetries: 3,
      authTimeoutMs: 120000,
      restartOnAuthFail: true,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 15000
    });

    this.registerPersistentEventHandlers();
  }

  /**
   * Safely ensure MongoDB connection without forcing disconnections
   */
  async ensureSafeMongoConnection() {
    const currentState = mongoose.connection.readyState;
    console.log(`📊 Current MongoDB state: ${currentState} (0=disconnected, 1=connected, 2=connecting, 3=disconnecting)`);

    switch (currentState) {
      case 0: // Disconnected
        console.log('🔄 MongoDB disconnected, establishing new connection...');
        await this.connectToMongoDB();
        break;

      case 1: // Connected
        console.log('✅ MongoDB already connected, testing connection...');
        try {
          await Promise.race([
            mongoose.connection.db.admin().ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Ping timeout')), 5000))
          ]);
          console.log('✅ MongoDB connection test passed');
        } catch (pingError) {
          console.warn('⚠️ MongoDB ping failed, reconnecting...', pingError.message);
          await this.reconnectMongoDB();
        }
        break;

      case 2: // Connecting
        console.log('⏳ MongoDB connection in progress, waiting...');
        try {
          await this.waitForMongoConnection();
        } catch (waitError) {
          console.warn('⚠️ MongoDB connection wait failed, forcing reconnect...', waitError.message);
          await this.reconnectMongoDB();
        }
        break;

      case 3: // Disconnecting
        console.log('⏳ MongoDB disconnecting, waiting then reconnecting...');
        await this.waitForMongoDisconnection();
        await this.connectToMongoDB();
        break;

      default:
        console.warn('⚠️ Unknown MongoDB state, attempting fresh connection...');
        await this.reconnectMongoDB();
    }
  }

  /**
   * Connect to MongoDB with proper error handling and timeout
   */
  async connectToMongoDB() {
    console.log('🔗 Attempting MongoDB connection...');

    const mongooseOptions = {
      serverSelectionTimeoutMS: 10000, // Reduced for faster failure detection
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      bufferCommands: false,
      maxPoolSize: 10,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      waitQueueTimeoutMS: 5000,
      heartbeatFrequencyMS: 10000
      
    };

    try {
      const connectionPromise = mongoose.connect(this.mongoUri, mongooseOptions);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('MongoDB connection timeout after 15 seconds')), 15000);
      });

      await Promise.race([connectionPromise, timeoutPromise]);

      // Verify connection by pinging
      await mongoose.connection.db.admin().ping();
      console.log('✅ MongoDB connection successful and verified');

    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);

      // Clean up failed connection
      if (mongoose.connection.readyState !== 0) {
        try {
          await mongoose.connection.close();
        } catch (closeError) {
          console.warn('⚠️ Error closing failed connection:', closeError.message);
        }
      }

      throw error;
    }
  }

  /**
   * Safely reconnect to MongoDB
   */
  async reconnectMongoDB() {
    try {
      if (mongoose.connection.readyState === 1) {
        console.log('🔄 Gracefully closing stable MongoDB connection...');
        await mongoose.connection.close();
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.connectToMongoDB();
    } catch (error) {
      console.error('❌ MongoDB reconnection failed:', error.message);
      throw error;
    }
  }

  /**
   * Wait for MongoDB connection to complete
   */
  async waitForMongoConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        mongoose.connection.removeAllListeners('connected');
        mongoose.connection.removeAllListeners('error');
        reject(new Error('MongoDB connection timeout'));
      }, 30000);

      mongoose.connection.once('connected', () => {
        clearTimeout(timeout);
        console.log('✅ MongoDB connection completed');
        resolve();
      });

      mongoose.connection.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Wait for MongoDB disconnection to complete
   */
  async waitForMongoDisconnection() {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log('⚠️ MongoDB disconnection timeout, proceeding anyway');
        resolve();
      }, 10000);

      mongoose.connection.once('disconnected', () => {
        clearTimeout(timeout);
        console.log('✅ MongoDB disconnection completed');
        resolve();
      });

      if (mongoose.connection.readyState === 0) {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  /**
   * Start the client with retry logic and ensure proper initialization
   */
  async startClient() {
    console.log('▶️ Starting WhatsApp client...');

    try {
      // Check for shutdown during delay
      if (this.useRemoteAuth) {
        console.log('⏳ Adding delay before initialization to ensure MongoDB connection is ready...');

        for (let i = 0; i < 5; i++) {
          if (global.isShuttingDown) {
            throw new Error('Shutdown in progress');
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('✅ Delay completed, proceeding with initialization');
      }

      const initPromise = this.client.initialize();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Client initialization timed out after 60 seconds')), 60000);
      });

      // Add shutdown check promise
      const shutdownPromise = new Promise((_, reject) => {
        const checkShutdown = () => {
          if (global.isShuttingDown) {
            reject(new Error('Shutdown in progress'));
          } else {
            setTimeout(checkShutdown, 1000);
          }
        };
        checkShutdown();
      });

      await Promise.race([initPromise, timeoutPromise, shutdownPromise]);
      console.log('✅ Client initialized successfully');

      // Verify RemoteAuth collections if using MongoDB
      if (this.useRemoteAuth && mongoose.connection.readyState === 1) {
        console.log('🔍 Verifying RemoteAuth collections...');
        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);

        console.log('📊 Available collections:', collectionNames.join(', '));

        const hasFilesCollection = collectionNames.includes('whatsapp-RemoteAuth-persistent-whatsapp-client.files');
        const hasChunksCollection = collectionNames.includes('whatsapp-RemoteAuth-persistent-whatsapp-client.chunks');

        if (!hasFilesCollection || !hasChunksCollection) {
          console.log('⚠️ RemoteAuth collections not found. They will be created when the session is first saved.');
          console.log('🔄 Forcing a session save to create collections...');

          if (this.client.authStrategy && typeof this.client.authStrategy.save === 'function') {
            try {
              await this.client.authStrategy.save();
              console.log('✅ Forced session save completed');
            } catch (saveError) {
              console.warn('⚠️ Failed to force session save:', saveError.message);
            }
          }
        } else {
          console.log('✅ RemoteAuth collections verified.');
        }
      }
    } catch (error) {
      if (error.message === 'Shutdown in progress') {
        console.log('⚠️ Client initialization interrupted by shutdown');
        return;
      }

      console.error('❌ Client initialization failed:', error);

      try {
        if (this.client) {
          console.log('🧹 Attempting to clean up failed client...');
          await this.destroyExistingClient();
        }
      } catch (cleanupError) {
        console.error('⚠️ Cleanup after failed initialization also failed:', cleanupError);
      }
      throw error;
    }
  }

  /**
   * Register event handlers for persistent connection
   */
  registerPersistentEventHandlers() {
    // QR Code - only show if not authenticated
    this.client.on('qr', async (qr) => {
      if (!this.isAuthenticated) {
        console.log('📱 QR code for authentication:');
        console.log(qr);

        this.currentQRCode = qr;
        this.lastQRCodeTime = new Date();

        try {
          this.qrCodeBase64 = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
            color: {
              dark: '#000000',
              light: '#FFFFFF'
            }
          });
          console.log('✅ QR code generated for web interface');
        } catch (qrError) {
          console.error('❌ Error generating QR code for web:', qrError);
          this.qrCodeBase64 = null;
        }

        qrcode.generate(qr, { small: true });

        console.log('⏳ For backend-only implementation: Copy this QR code and scan it with your WhatsApp app');
        console.log('⏳ You can also use a QR code generator with the string above');
        console.log('🌐 Or visit http://localhost:3000/qr to scan the QR code in your browser');
        
        // Broadcast QR code update to all connected clients
        this.broadcastStatusUpdate();
      }
    });

    // Authentication success
    this.client.on('authenticated', () => {
      console.log('🔐 WhatsApp authenticated successfully!');
      this.isAuthenticated = true;
      this.reconnectAttempts = 0;
      this.clearQRCode();
      
      // Broadcast status update to all connected clients
      this.broadcastStatusUpdate();
    });

    // Ready event
    this.client.on('ready', async () => {
      console.log('✅ WhatsApp client is ready and connected!');
      this.isClientReady = true;
      this.isAuthenticated = true;
      this.lastHeartbeat = new Date();
      this.clearQRCode();
      
      // Broadcast status update to all connected clients
      this.broadcastStatusUpdate();

      // Get business info
      try {
        const info = this.client.info;
        this.businessPhoneNumber = info.wid.user;
        console.log(`📞 Connected as: ${this.businessPhoneNumber}`);
        console.log(`👤 Display name: ${info.pushname}`);
      } catch (error) {
        console.log('⚠️ Could not get business info immediately:', error.message);
      }

      this.reconnectAttempts = 0;

      // Ensure RemoteAuth session is saved if using MongoDB with synchronization
      if (this.useRemoteAuth && mongoose.connection.readyState === 1) {
        try {
          console.log('💾 Ensuring RemoteAuth session is properly saved...');
          this.isSessionSaving = true; // Set flag to prevent restart during save

          if (this.client.authStrategy && typeof this.client.authStrategy.save === 'function') {
            await this.client.authStrategy.save();
            console.log('✅ RemoteAuth session save triggered');

            const db = mongoose.connection.db;
            const collections = await db.listCollections().toArray();
            const collectionNames = collections.map(c => c.name);

            console.log('📊 Collections after save:', collectionNames.join(', '));
          }
        } catch (saveError) {
          console.error('⚠️ Error ensuring session persistence:', saveError.message);
        } finally {
          this.isSessionSaving = false; // Clear flag after save completes
          
          // If restart was pending during session save, trigger it now
          if (this.restartPending) {
            console.log('🔄 Executing pending restart after session save completion');
            this.restartPending = false;
            setImmediate(() => this.gracefulRestart('PENDING_AFTER_SESSION_SAVE'));
          }
        }
      }

      this.startConnectionMonitoring();
      
      // Start periodic restart timer for memory management
      console.log(`⏰ Starting periodic restart timer (${this.periodicRestartInterval / (1000 * 60 * 60)} hours)`);
      this.startPeriodicRestartTimer();
      
      // Start cache maintenance timer for long-term stability
      console.log(`🧹 Starting cache maintenance timer (${this.cacheMaintenanceInterval / (24 * 60 * 60 * 1000)} days)`);
      this.startCacheMaintenanceTimer();
      
      // Start cache monitoring for proactive alerts
      this.startCacheMonitoring();
      
      // Start disk space monitoring for system health
      this.startDiskSpaceMonitoring();
      
      // Validate session integrity before proceeding
      const validationResult = await this.validateSessionIntegrity();
      if (!validationResult.valid && validationResult.cleaned) {
        console.log('🔄 Session was cleaned due to corruption, proceeding with fresh start...');
      } else if (!validationResult.valid) {
        console.warn('⚠️ Session validation found issues but no cleanup was needed');
      }

      // Initialize groups with retry strategy
      console.log('⏳ Waiting for WhatsApp Web to fully synchronize...');

      this.groupInitAttempts = 0;
      this.maxGroupInitAttempts = 3;

      const ensureClientFullyInitialized = () => {
        return new Promise(resolve => {
          if (this.client.pupPage && this.client.pupBrowser) {
            console.log('✅ Client appears to be fully initialized');
            resolve();
            return;
          }

          console.log('⏳ Waiting for client to be fully initialized...');

          const timeout = setTimeout(() => {
            console.log('⚠️ Client initialization wait timed out after 30 seconds, proceeding anyway');
            resolve();
          }, 30000);

          const stateHandler = (state) => {
            if (state === 'CONNECTED') {
              console.log('✅ Client is now fully connected');
              clearTimeout(timeout);
              this.client.removeListener('change_state', stateHandler);
              resolve();
            }
          };

          this.client.on('change_state', stateHandler);
        });
      };

      const attemptGroupInit = async (delayMs, attempt) => {
        if (attempt > this.maxGroupInitAttempts) {
          console.log('⚠️ Reached maximum group initialization attempts. Will continue without all groups.');
          return;
        }

        console.log(`⏳ Scheduling group initialization attempt ${attempt} in ${delayMs/1000} seconds...`);

        setTimeout(async () => {
          try {
            await ensureClientFullyInitialized();

            console.log(`🔄 Attempt ${attempt}/${this.maxGroupInitAttempts} to initialize groups...`);
            const groups = await this.initializeGroups(1, 5);

            if (groups.length === 0 && attempt < this.maxGroupInitAttempts) {
              console.log(`⏳ No groups found on attempt ${attempt}, scheduling next attempt...`);
              const nextDelay = Math.min(delayMs * 1.5, 120000);
              attemptGroupInit(nextDelay, attempt + 1);
            } else if (groups.length > 0) {
              console.log(`✅ Successfully loaded ${groups.length} groups on attempt ${attempt}`);
            } else {
              console.log('⚠️ No groups found after all attempts. Check WhatsApp connection and group membership.');
            }
          } catch (error) {
            console.error(`❌ Group loading attempt ${attempt} failed:`, error.message);

            if (attempt < this.maxGroupInitAttempts) {
              const jitter = Math.floor(Math.random() * 10000);
              const nextDelay = Math.min(delayMs * 1.5 + jitter, 120000);
              console.log(`🔄 Will retry group initialization in ${Math.round(nextDelay/1000)} seconds...`);
              attemptGroupInit(nextDelay, attempt + 1);
            } else {
              console.log('⚠️ Failed to initialize groups after maximum attempts. Will continue without all groups.');
            }
          }
        }, delayMs);
      };

      // Progressive retry strategy
      attemptGroupInit(15000, 1);

      setTimeout(() => {
        if (this.isClientReady) {
          console.log('🔄 Scheduling second group initialization attempt...');
          attemptGroupInit(1000, 2);
        }
      }, 30000);

      setTimeout(() => {
        if (this.isClientReady) {
          console.log('🔄 Scheduling third group initialization attempt...');
          attemptGroupInit(1000, 3);
        }
      }, 60000);
    });

    // Authentication failure
    this.client.on('auth_failure', (msg) => {
      console.error('🚨 Authentication failed:', msg);
      this.isAuthenticated = false;
      this.isClientReady = false;
      console.log('⏳ Will retry authentication...');
      setTimeout(() => this.handleAuthFailure(), 5000);
    });

    // Disconnection
    this.client.on('disconnected', (reason) => {
      console.log(`🔌 Disconnected: ${reason}`);
      this.isClientReady = false;

      const isLogout = reason === 'UNPAIRED' || reason === 'UNPAIRED_DEVICE' ||
          reason === 'LOGOUT' || reason.includes('LOGOUT');

      if (isLogout) {
        console.log('👋 Logout detected - user manually logged out');
        this.isAuthenticated = false;
        this.clearSession();
      } else {
        console.log('🔄 Connection lost - will attempt to reconnect...');
      }
      
      // Broadcast disconnection status to all connected clients
      this.broadcastStatusUpdate();

      this.handleDisconnection(reason);
    });

    // Loading screen
    this.client.on('loading_screen', (percent, message) => {
      if (percent % 25 === 0 || percent > 90) {
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
      this.lastHeartbeat = new Date();
      await this.handleIncomingMessage(message);
    });

    // Remote session saved
    this.client.on('remote_session_saved', () => {
      console.log('💾 Remote session saved - another device was paired');
    });
  }

  /**
   * Start connection monitoring for persistent connection with improved stability
   */
  startConnectionMonitoring() {
    this.stopConnectionMonitoring();

    console.log('🔍 Starting connection monitoring...');
    this.heartbeatInterval = Math.max(this.heartbeatInterval, 2 * 60 * 1000); // Changed from 1 minute to 2 minutes for low-resource systems
    console.log(`⏱️ Connection check interval set to ${this.heartbeatInterval / 1000}s`);

    // MongoDB connection monitoring
    this.mongoDbMonitorInterval = 30 * 60 * 1000;
    console.log(`📊 MongoDB connection monitoring interval: ${this.mongoDbMonitorInterval / 60000} minutes`);

    this.mongoDbMonitor = setInterval(async () => {
      try {
        if (this.useRemoteAuth && mongoose.connection) {
          const state = mongoose.connection.readyState;
          console.log(`📊 MongoDB connection state: ${state} (0=disconnected, 1=connected, 2=connecting, 3=disconnecting)`);

          if (state !== 1) {
            console.log('⚠️ MongoDB connection lost, attempting to reconnect...');
            const mongooseOptions = {
              serverSelectionTimeoutMS: 10000,
              socketTimeoutMS: 45000,
              connectTimeoutMS: 10000,
              bufferCommands: false,
              bufferMaxEntries: 0,
              maxPoolSize: 10,
              minPoolSize: 5,
              maxIdleTimeMS: 30000,
              waitQueueTimeoutMS: 5000,
              heartbeatFrequencyMS: 10000
            };

            if (mongoose.connection.readyState !== 0) {
              console.log('🔄 Closing existing MongoDB connection before reconnecting...');
              await mongoose.connection.close();
            }

            await mongoose.connect(this.mongoUri, mongooseOptions);
            console.log('✅ MongoDB reconnected successfully');
          } else {
            console.log('🔄 Pinging MongoDB to keep connection alive...');
            await mongoose.connection.db.admin().ping();
            console.log('✅ MongoDB ping successful');
          }
        }
      } catch (error) {
        console.error('❌ MongoDB connection check failed:', error.message);
      }
    }, this.mongoDbMonitorInterval);

    this.connectionMonitor = setInterval(async () => {
      const jitter = Math.floor(Math.random() * 5000);
      await new Promise(resolve => setTimeout(resolve, jitter));

      try {
        await this.performConnectionCheck();
      } catch (error) {
        console.log('⚠️ Error in connection monitoring cycle:', error.message);
      }
    }, this.heartbeatInterval);

    // Set up backup cleanup interval
    setInterval(async () => {
      await this.cleanupOldBackups();
    }, 10 * 60 * 1000);

    // Periodic group initialization
    if (this.groupRefreshInterval) {
      clearInterval(this.groupRefreshInterval);
    }

    this.groupRefreshInterval = setInterval(async () => {
      try {
        if (this.isClientReady) {
          const groups = await this.client.getChats();
          const groupCount = groups.filter(chat => chat.isGroup).length;

          if (groupCount === 0) {
            console.log('🔄 No groups found, attempting to initialize groups again...');
            await this.initializeGroups(1, 3);
          } else {
            console.log(`✅ Periodic check: ${groupCount} groups available`);
          }
        }
      } catch (error) {
        console.error('❌ Periodic group refresh failed:', error.message);
      }
    }, 5 * 60 * 1000);

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

    if (this.mongoDbMonitor) {
      clearInterval(this.mongoDbMonitor);
      this.mongoDbMonitor = null;
      console.log('🛑 MongoDB connection monitoring stopped');
    }
  }

  /**
   * Perform connection health check
   */
  async performConnectionCheck() {
    try {
      if (!this.client || !this.isClientReady) {
        console.log('💔 Connection check: Client not ready');
        return;
      }

      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat.getTime();
      const adjustedMaxIdleTime = this.maxIdleTime * 1.5;
      if (timeSinceLastHeartbeat > adjustedMaxIdleTime) {
        console.log(`💤 Connection appears idle for ${Math.round(timeSinceLastHeartbeat / 1000)}s`);
        await this.performActiveHealthCheck();
        return;
      }

      // Memory usage monitoring
      this.connectionCheckCount = (this.connectionCheckCount || 0) + 1;
      if (this.connectionCheckCount % 10 === 0) {
        try {
          const memoryUsage = process.memoryUsage();
          const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
          const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
          const heapPercentage = Math.round((heapUsedMB / heapTotalMB) * 100);
          console.log(`📊 Memory usage: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapPercentage}%)`);

          // Check for critical memory usage requiring restart
          if (heapPercentage >= this.memoryThreshold) {
            console.log(`🚨 Critical memory usage detected: ${heapPercentage}% (threshold: ${this.memoryThreshold}%)`);
            
            // Check if session save is in progress - defer restart to prevent corruption
            if (this.isSessionSaving) {
              console.log('⏳ Session save in progress - deferring restart to prevent corruption');
              this.restartPending = true;
              
              // Set timeout to force restart if session save takes too long
              setTimeout(() => {
                if (this.restartPending && this.isSessionSaving) {
                  console.log('⚠️ Session save timeout - forcing restart to prevent memory overflow');
                  this.isSessionSaving = false;
                  this.restartPending = false;
                  this.gracefulRestart('MEMORY_THRESHOLD_FORCED');
                }
              }, this.sessionOperationTimeout);
              return;
            }
            
            console.log('🔄 Triggering graceful restart to prevent memory overflow...');
            
            // Trigger graceful restart in next tick to avoid blocking current check
            setImmediate(() => {
              this.gracefulRestart('MEMORY_THRESHOLD');
            });
            return;
          }
          
          // High memory warning and garbage collection
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

      const state = await Promise.race([
        this.client.getState(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Connection check timeout')), 15000)
        )
      ]);

      if (state === 'CONNECTED') {
        this.lastHeartbeat = new Date();

        if (this.staleConnectionCount && this.staleConnectionCount > 0) {
          console.log('✅ Connection restored, resetting stale connection counter');
          this.staleConnectionCount = 0;
        }

        if (this.isAuthenticated) {
          try {
            const groups = await this.client.getChats();
            const groupCount = groups.filter(chat => chat.isGroup).length;
            if (groupCount === 0) {
              console.log('⚠️ No groups found, attempting to initialize groups');
              this.initializeGroups();
            } else if (groupCount > 0 && groupCount < 400) {
              console.log(`📊 Only ${groupCount} groups found (expecting ~400), scheduling refresh`);
              if (!this.partialGroupRefreshScheduled) {
                this.partialGroupRefreshScheduled = true;
                setTimeout(() => {
                  console.log('🔄 Performing scheduled group refresh to find missing groups');
                  this.initializeGroups();
                  this.partialGroupRefreshScheduled = false;
                }, 5 * 60 * 1000); // Changed from 1 minute to 5 minutes to reduce VM stress
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
          console.log('⚠️ Disconnected state detected, performing active health check');
          await this.performActiveHealthCheck();
        }
      }
    } catch (error) {
      console.log('❌ Connection check failed:', error.message);
      if (error.stack) {
        console.log('📊 Error stack:', error.stack.split('\n').slice(0, 3).join('\n'));
      }
      await this.performActiveHealthCheck();
    }
  }

  /**
   * Perform active health check when passive check fails
   */
  async performActiveHealthCheck() {
    try {
      console.log('🏥 Performing active health check...');

      let healthCheckPassed = false;

      try {
        await Promise.race([
          this.client.getState(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('State check timeout')), 20000))
        ]);
        healthCheckPassed = true;
        console.log('✅ Active health check passed (state check)');
      } catch (stateError) {
        console.log('⚠️ State check failed:', stateError.message);

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
   * Handle stale connection
   */
  async handleConnectionStale() {
    this.isClientReady = false;

    const now = new Date();
    if (!this.lastStaleConnectionTime) {
      this.lastStaleConnectionTime = now;
      this.staleConnectionCount = 1;
    } else {
      const timeSinceLastStale = now - this.lastStaleConnectionTime;
      if (timeSinceLastStale < 5 * 60 * 1000) {
        this.staleConnectionCount++;
      } else {
        this.staleConnectionCount = 1;
      }
      this.lastStaleConnectionTime = now;
    }

    console.log(`🔄 Reconnecting due to stale connection (${this.staleConnectionCount} in recent period)...`);

    const baseDelay = 10000;
    const delay = Math.min(baseDelay * Math.pow(1.5, this.staleConnectionCount - 1), 60000);

    console.log(`⏱️ Waiting ${delay / 1000}s before reconnection attempt`);

    setTimeout(async () => {
      try {
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
   * Handle disconnection
   */
  handleDisconnection(reason = 'UNKNOWN') {
    this.stopConnectionMonitoring();

    console.log(`📊 Disconnection occurred with reason: ${reason}`);

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('🛑 Maximum reconnection attempts reached');
      console.log('💡 Suggestion: Please restart the application manually');
      setTimeout(() => {
        console.log('🔄 Resetting reconnection counter after timeout period');
        this.reconnectAttempts = 0;
        this.handleDisconnection('RECOVERY_AFTER_RESET');
      }, 30 * 60 * 1000);
      return;
    }

    this.reconnectAttempts++;
    const baseDelay = 20000;
    const delay = Math.min(baseDelay * Math.pow(1.2, this.reconnectAttempts - 1), 180000);

    console.log(`🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay / 1000}s`);

    const hasSessionFiles = this.checkExistingAuth();

    setTimeout(async () => {
      try {
        const forceNewSession =
            (reason === 'LOGOUT' || reason === 'UNPAIRED' || reason === 'UNPAIRED_DEVICE') ||
            (!hasSessionFiles) ||
            (this.reconnectAttempts > 5);

        if (forceNewSession) {
          console.log(`⚠️ Forcing new session due to: ${reason === 'LOGOUT' || reason === 'UNPAIRED' || reason === 'UNPAIRED_DEVICE' ?
              'explicit logout/unpair' :
              (!hasSessionFiles ? 'missing session files' : 'multiple reconnection failures')}`);
        } else {
          console.log('🔐 Attempting to reuse existing session for better persistence');
        }

        await this.ensureProperPermissions();
        await this.initializeClient(forceNewSession);
      } catch (error) {
        console.error('🚨 Reconnection failed:', error);
        if (error.stack) {
          console.log('📊 Error stack:', error.stack.split('\n').slice(0, 3).join('\n'));
        }

        if (error.message && (
            error.message.includes('ENOSPC') ||
            error.message.includes('ENOMEM') ||
            error.message.includes('browser crashed')
        )) {
          console.log('⚠️ Critical system error detected, adding extra delay before next attempt');
          setTimeout(() => {
            this.handleDisconnection('RECOVERY_AFTER_ERROR');
          }, 60000);
        }
      }
    }, delay);
  }

  /**
   * Handle authentication failure
   */
  async handleAuthFailure() {
    console.log('🔐 Handling authentication failure...');

    setTimeout(async () => {
      try {
        await this.initializeClient(false);
      } catch (error) {
        console.error('🚨 Auth retry failed:', error);
        if (this.reconnectAttempts > 3) {
          console.log('🧹 Multiple auth failures - clearing session');
          await this.initializeClient(true);
        }
      }
    }, 10000);
  }

  /**
   * Handle initialization failure
   */
  async handleInitializationFailure(error) {
    // Check if we're shutting down - if so, don't attempt restart
    if (global.isShuttingDown) {
      console.log('⚠️ Shutdown in progress, skipping retry logic');
      return;
    }

    this.reconnectAttempts++;

    console.log('📊 Error type:', error.constructor.name);
    console.log('📊 Error message:', error.message);
    if (error.stack) {
      console.log('📊 Error stack (first 3 lines):', error.stack.split('\n').slice(0, 3).join('\n'));
    }

    const errorMessage = error.message.toLowerCase();
    let additionalDelay = 0;
    let shouldClearSession = false;

    if (errorMessage.includes('navigation failed because browser has disconnected')) {
      console.log('🔄 Browser disconnection detected, adding extended recovery time...');
      additionalDelay = 15000;
      shouldClearSession = true;
    } else if (errorMessage.includes('protocol error') ||
        errorMessage.includes('session closed') ||
        errorMessage.includes('browser has disconnected') ||
        errorMessage.includes('target closed') ||
        errorMessage.includes('connection reset')) {
      console.log('🔄 Browser connection issue detected, adding recovery time...');
      additionalDelay = 8000;
    } else if (errorMessage.includes('enoent') ||
        errorMessage.includes('failed to launch') ||
        errorMessage.includes('executable path')) {
      console.error('🚨 Critical browser error:', error.message);
      console.log('💡 Suggestion: Please check Chrome/Chromium installation');
      additionalDelay = 10000;
    } else if (errorMessage.includes('z_buf_error') ||
        errorMessage.includes('unexpected end of file') ||
        errorMessage.includes('corrupt') ||
        errorMessage.includes('buffer') && errorMessage.includes('error')) {
      console.error('🚨 Z_BUF_ERROR or cache corruption detected:', error.message);
      console.log('🧹 Triggering cache cleanup to resolve corruption...');
      shouldClearSession = true;
      additionalDelay = 12000; // Extra time for cache cleanup
      
      // Immediately clean cache to prevent further corruption
      try {
        await this.cleanBrowserCache();
        console.log('✅ Emergency cache cleanup completed');
      } catch (cleanupError) {
        console.error('⚠️ Emergency cache cleanup failed:', cleanupError.message);
      }
    }

    // Auto-restart is now disabled - maxReconnectAttempts is set to 0
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const baseDelay = 15000 + additionalDelay;
      const delay = Math.min(baseDelay * Math.pow(1.5, this.reconnectAttempts - 1), 180000);
      console.log(`🔄 Retry initialization in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

      setTimeout(async () => {
        // Double-check shutdown status before retrying
        if (global.isShuttingDown) {
          console.log('⚠️ Shutdown detected during retry, aborting');
          return;
        }
        shouldClearSession = shouldClearSession ||
            this.reconnectAttempts > 3 ||
            errorMessage.includes('auth') ||
            errorMessage.includes('session');
        await this.initializeClient(shouldClearSession);
      }, delay);
    } else {
      console.error('🛑 Initialization failed - auto-restart is disabled');
      console.log('💡 Application will stop after Ctrl+C as requested');
      console.log('💡 To restart, run the application manually');
    }
  }

  /**
   * Clean up old backups
   */
  async cleanupOldBackups() {
    try {
      if (!this.useRemoteAuth) return;
      if (mongoose.connection.readyState !== 1) {
        console.log('⚠️ MongoDB not connected, skipping backup cleanup');
        return;
      }

      const db = mongoose.connection.db;

      const collections = await db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);

      const filesCollectionName = 'whatsapp-RemoteAuth-persistent-whatsapp-client.files';
      const chunksCollectionName = 'whatsapp-RemoteAuth-persistent-whatsapp-client.chunks';

      if (!collectionNames.includes(filesCollectionName) || !collectionNames.includes(chunksCollectionName)) {
        console.log('⚠️ RemoteAuth collections not found, skipping backup cleanup');
        return;
      }

      const filesCollection = db.collection(filesCollectionName);
      const chunksCollection = db.collection(chunksCollectionName);

      const backupFiles = await filesCollection
          .find({})
          .sort({ uploadDate: -1 })
          .toArray();

      console.log(`📊 Found ${backupFiles.length} backup files in RemoteAuth storage`);

      if (backupFiles.length > 2) {
        const filesToDelete = backupFiles.slice(2);

        for (const file of filesToDelete) {
          await filesCollection.deleteOne({ _id: file._id });
          await chunksCollection.deleteMany({ files_id: file._id });
        }

        console.log(`🧹 Stack cleanup: Removed ${filesToDelete.length} old backups, kept latest 2`);
      } else {
        console.log('✅ No backup cleanup needed, fewer than 3 backups exist');
      }
    } catch (error) {
      console.error('❌ Backup cleanup failed:', error.message);
    }
  }

  /**
   * Initialize groups
   */
  async initializeGroups(attempt = 1, maxAttempts = 10) {
    // Set session operation flag to prevent restart corruption
    this.isSessionSaving = true;
    
    try {
      console.log(`📋 Initializing groups for large-scale operation (attempt ${attempt})...`);

      if (!this.isClientReady) {
        throw new Error('Client not ready');
      }

      // Enhanced readiness checks
      if (!this.client.pupBrowser || !this.client.pupPage) {
        console.log('⚠️ Puppeteer browser or page not initialized');
        throw new Error('Puppeteer browser or page not initialized');
      }

      try {
        console.log('🔍 Verifying WhatsApp web page responsiveness...');
        await this.client.pupPage.evaluate(() => true).catch(() => {
          throw new Error('Puppeteer page is not responsive');
        });
        console.log('✅ WhatsApp web page is responsive');
      } catch (pageError) {
        console.error('❌ Page validation failed:', pageError.message);
        throw new Error('WhatsApp web page is not fully initialized');
      }

      let waitTime = 0;
      const maxWaitTime = 90000;

      while ((!this.client.info || !this.businessPhoneNumber) && waitTime < maxWaitTime) {
        if (waitTime % 10000 === 0) {
          console.log(`⏳ Waiting for client info... (${waitTime / 1000}s / ${maxWaitTime / 1000}s)`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        waitTime += 1000;
      }

      if (!this.client.info || !this.businessPhoneNumber) {
        console.warn('⚠️ Timed out waiting for client info, attempting to get groups anyway');
      }

      try {
        await this.client.getState();
      } catch (stateError) {
        console.warn('⚠️ Could not get client state:', stateError.message);
      }

      console.log('⏳ Adding a short delay before fetching chats...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      console.log('🔍 Client appears ready, fetching chats...');
      const chats = await Promise.race([
        this.client.getChats(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout getting chats')), 60000))
      ]);
      const groups = chats.filter(chat => chat.isGroup);

      console.log(`✅ Found ${groups.length} groups`);

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

      if (groups.length > 0 && groups.length < 400) {
        console.log(`⚠️ Only ${groups.length} groups found (expecting ~400), will continue loading...`);

        if (!this.partialGroupRefreshScheduled) {
          this.partialGroupRefreshScheduled = true;
          setTimeout(() => {
            console.log('🔄 Performing scheduled group refresh to find missing groups');
            this.initializeGroups();
            this.partialGroupRefreshScheduled = false;
          }, 5 * 60 * 1000); // Changed from 1 minute to 5 minutes to reduce VM stress
        }
      } else if (groups.length >= 400) {
        console.log('🎉 All expected groups loaded successfully!');
      }

      return groups;
    } catch (error) {
      console.error(`❌ Group initialization failed (attempt ${attempt}/${maxAttempts}):`, error.message);

      if (error.stack) {
        console.debug('Error stack:', error.stack.split('\n')[0]);
      }

      try {
        const state = await this.client.getState();
        console.log(`📱 Current client state: ${state}`);
      } catch (stateError) {
        console.warn('⚠️ Could not get client state:', stateError.message);
      }

      if (attempt < maxAttempts) {
        const baseDelay = 15000;
        const maxDelay = 60000;
        const expBackoff = baseDelay * Math.pow(2.0, attempt - 1);
        const jitter = Math.random() * 2000 - 1000;
        const delay = Math.min(expBackoff + jitter, maxDelay);

        console.log(`🔄 Retry in ${Math.round(delay/1000)}s... (attempt ${attempt+1}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.initializeGroups(attempt + 1, maxAttempts);
      }

      console.log('⚠️ Group initialization failed after all attempts');
      console.log('📝 The application will continue running and retry group initialization periodically');

      if (!this.groupRefreshInterval) {
        console.log('🔄 Setting up periodic group refresh every 10 minutes');
        this.groupRefreshInterval = setInterval(() => {
          console.log('🔄 Attempting periodic group initialization...');
          this.initializeGroups(1, 5);
        }, 10 * 60 * 1000); // Changed from 5 minutes to 10 minutes to reduce VM stress
      }

      return [];
    } finally {
      // Clear session operation flag
      this.isSessionSaving = false;
      
      // Execute pending restart if needed
      if (this.restartPending) {
        console.log('🔄 Executing pending restart after group initialization completion');
        this.restartPending = false;
        setImmediate(() => {
          this.gracefulRestart('MEMORY_THRESHOLD_DEFERRED');
        });
      }
    }
  }

  /**
   * Handle incoming messages
   */
  async handleIncomingMessage(message) {
    try {
      if (this.isBusinessMessage(message)) return;
      if (!message.from.includes('@g.us')) return;

      const messageContent = message.body || '[NO CONTENT]';
      const messageType = message.type || 'unknown';
      const timestamp = new Date(message.timestamp * 1000).toISOString();

      let groupName = 'unavailable';
      try {
        const chat = await message.getChat();
        groupName = chat.isGroup ? chat.name : false;
      } catch (err) {
        const util = require('util');
        console.error('Error getting chat info:', util.inspect({ error: err.message }, { colors: true, depth: null }));
      }

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

      const messageDetails = {
        content: messageContent,
        group: groupName === false ? '[NOT A GROUP]' : groupName,
        sender: senderInfo,
        time: timestamp,
        type: messageType
      };

      console.log('📩 MESSAGE DETAILS 📩');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      const util = require('util');
      console.log(util.inspect(messageDetails, { colors: true, depth: null }));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const processedMessage = await this.messageProcessor.processMessage(message);

      if (processedMessage) {
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

        console.log(`✅ Message saved:`, util.inspect({ id: insertId }, { colors: true, depth: null }));

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
   * Utility methods
   */
  isBusinessMessage(message) {
    if (!message.from || !this.businessPhoneNumber) return false;
    const isFromBusiness = message.author && message.author.includes(this.businessPhoneNumber);
    const isStatus = message.isStatus === true || message.from.includes('status@broadcast');
    return isFromBusiness || isStatus;
  }

  getStatus() {
    const status = {
      isReady: this.isClientReady,
      isAuthenticated: this.isAuthenticated,
      reconnectAttempts: this.reconnectAttempts,
      lastHeartbeat: this.lastHeartbeat,
      businessNumber: this.businessPhoneNumber,
      qrCode: null,
      qrCodeTime: null,
      message: ''
    };

    console.log(`🔍 Auth Status Check: authenticated=${this.isAuthenticated}, clientReady=${this.isClientReady}`);

    if (!status.isAuthenticated && this.qrCodeBase64) {
      const base64Data = this.qrCodeBase64.replace(/^data:image\/png;base64,/, '');
      status.qrCode = base64Data;
      status.qrCodeTime = this.lastQRCodeTime;
      status.message = 'Scan QR code to authenticate';
      console.log('🔍 Returning QR code for authentication');
    } else if (!status.isAuthenticated) {
      status.message = 'Waiting for QR code...';
      console.log('🔍 Waiting for QR code generation');
    } else {
      status.message = this.isClientReady ? 'WhatsApp is connected and ready' : 'WhatsApp authenticated, initializing...';
      console.log('🔍 WhatsApp is authenticated!');
    }

    return status;
  }

  /**
   * Broadcast status update to all connected Socket.io clients
   */
  broadcastStatusUpdate() {
    if (this.server && this.server.io) {
      const status = this.getStatus();
      console.log('📡 Broadcasting status update to all clients:', {
        isAuthenticated: status.isAuthenticated,
        isReady: status.isReady,
        message: status.message
      });
      this.server.io.emit('whatsapp-status-update', status);
    }
  }

  async refreshQRCode() {
    try {
      console.log('🔄 Refreshing QR code...');

      this.currentQRCode = null;
      this.qrCodeBase64 = null;
      this.lastQRCodeTime = null;

      if (!this.isAuthenticated) {
        await this.initializeClient(false);
        return true;
      } else {
        console.log('⚠️ Cannot refresh QR code - already authenticated');
        return false;
      }
    } catch (error) {
      console.error('❌ Error refreshing QR code:', error);
      return false;
    }
  }

  clearQRCode() {
    this.currentQRCode = null;
    this.qrCodeBase64 = null;
    this.lastQRCodeTime = null;
    console.log('🧹 QR code data cleared');
  }

  async ensureProperPermissions() {
    try {
      if (!fs.existsSync(this.sessionPath)) {
        fs.mkdirSync(this.sessionPath, {
          recursive: true,
          mode: 0o755
        });
      }

      const userId = process.getuid ? process.getuid() : null;
      const groupId = process.getgid ? process.getgid() : null;

      if (userId !== null && groupId !== null) {
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

      fs.chmodSync(this.sessionPath, 0o755);
      console.log('✅ Session directory created with proper permissions');

    } catch (error) {
      console.warn('⚠️ Could not set permissions:', error.message);
      console.log('💡 Make sure the script runs with proper user permissions');
    }
  }

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
   * Clean browser cache to prevent Z_BUF_ERROR corruption
   */
  async cleanBrowserCache() {
    try {
      const cacheDir = path.join(process.cwd(), '.wwebjs_cache');
      
      if (fs.existsSync(cacheDir)) {
        console.log('🧹 Cleaning browser cache to prevent corruption...');
        
        // Get cache size before cleanup
        const stats = await this.getCacheStats(cacheDir);
        console.log(`📊 Cache size before cleanup: ${stats.sizeMB}MB (${stats.fileCount} files)`);
        
        // Remove cache directory
        fs.rmSync(cacheDir, { recursive: true, force: true });
        console.log('✅ Browser cache cleaned successfully');
        
        // Log cleanup for monitoring
        this.logCacheCleanup(stats);
      } else {
        console.log('ℹ️ No browser cache found to clean');
      }
    } catch (error) {
      console.error('⚠️ Error cleaning browser cache:', error.message);
      // Don't throw - cache cleanup failure shouldn't stop restart
    }
  }

  /**
   * Get cache directory statistics
   */
  async getCacheStats(cacheDir) {
    try {
      let totalSize = 0;
      let fileCount = 0;
      
      const files = fs.readdirSync(cacheDir, { recursive: true });
      
      for (const file of files) {
        const filePath = path.join(cacheDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.isFile()) {
            totalSize += stat.size;
            fileCount++;
          }
        } catch (err) {
          // Skip files that can't be accessed
        }
      }
      
      return {
        sizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
        fileCount: fileCount
      };
    } catch (error) {
      return { sizeMB: 0, fileCount: 0 };
    }
  }

  /**
   * Log cache cleanup for monitoring
   */
  logCacheCleanup(stats, rotationResult = null) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: 'CACHE_CLEANUP',
      sizeMB: stats.sizeMB,
      fileCount: stats.fileCount,
      restartCount: this.restartCount,
      rotation: rotationResult ? {
        filesRotated: rotationResult.filesRotated || 0,
        sizeFreedMB: rotationResult.sizeFreedMB || 0,
        rotated: rotationResult.rotated || false
      } : null
    };
    
    console.log('📝 Cache cleanup logged:', JSON.stringify(logEntry));
  }

  async forceGroupInitialization() {
    console.log('🔄 Manually triggering group initialization...');

    if (!this.isClientReady) {
      console.warn('⚠️ Client not ready, cannot initialize groups');
      return [];
    }

    try {
      try {
        await this.client.getState();
        console.log('✅ Client state synchronized');
      } catch (stateError) {
        console.warn('⚠️ Could not get client state:', stateError.message);
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
      return await this.initializeGroups(1, 5);
    } catch (error) {
      console.error('❌ Manual group initialization failed:', error.message);
      return [];
    }
  }

  async handleManualLogout() {
    console.log('👋 Manual logout detected');
    this.isAuthenticated = false;
    this.isClientReady = false;
    await this.clearSession();

    setTimeout(() => {
      console.log('🔄 Ready for fresh authentication');
      this.initializeClient(true);
    }, 2000);
  }

  /**
   * Graceful restart that preserves RemoteAuth session
   */
  async gracefulRestart(reason = 'SCHEDULED') {
    console.log(`🔄 Initiating graceful restart - Reason: ${reason}`);
    console.log(`📊 Restart #${this.restartCount + 1} - Last restart: ${this.lastRestartTime.toLocaleString()}`);
    
    // Wait for any ongoing session operations to complete (Node.js single-threaded safety)
    if (this.isSessionSaving) {
      console.log('⏳ Waiting for ongoing session save to complete before restart...');
      const startWait = Date.now();
      
      // Wait for session save to complete or timeout
      while (this.isSessionSaving && (Date.now() - startWait) < this.sessionOperationTimeout) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Check every 100ms
      }
      
      if (this.isSessionSaving) {
        console.log('⚠️ Session save timeout during restart - proceeding with caution');
        this.isSessionSaving = false; // Force clear to prevent deadlock
      } else {
        console.log('✅ Session save completed - proceeding with restart');
      }
    }
    
    // Clear any pending restart flag since we're executing now
    this.restartPending = false;
    
    // Log memory stats before restart
    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
    const heapPercentage = Math.round((heapUsedMB / heapTotalMB) * 100);
    console.log(`📊 Pre-restart memory: ${heapUsedMB}MB / ${heapTotalMB}MB (${heapPercentage}%)`);
    
    try {
      // Stop monitoring and timers
      this.stopConnectionMonitoring();
      if (this.periodicRestartTimer) {
        clearTimeout(this.periodicRestartTimer);
        this.periodicRestartTimer = null;
      }
      
      // Gracefully destroy current client (preserves RemoteAuth session)
      if (this.client) {
        console.log('🛑 Destroying current client...');
        await this.client.destroy();
        this.client = null;
      }

      // Clean browser cache to prevent Z_BUF_ERROR corruption
      await this.cleanBrowserCache();

      // Reset state
      this.isClientReady = false;
      this.isAuthenticated = false;
      this.reconnectAttempts = 0;
      
      // Force garbage collection if available
      if (global.gc) {
        console.log('🧹 Running garbage collection...');
        global.gc();
      }
      
      // Update restart tracking
      this.restartCount++;
      this.lastRestartTime = new Date();
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Initialize new client (RemoteAuth will auto-login)
      console.log('🚀 Starting new client instance...');
      await this.initializeClient(false); // Don't force new session - use RemoteAuth
      
      // Start periodic restart timer
      this.startPeriodicRestartTimer();
      
      console.log('✅ Graceful restart completed successfully');
      
    } catch (error) {
      console.error('❌ Error during graceful restart:', error.message);
      // Fallback to regular initialization
      setTimeout(() => {
        console.log('🔄 Attempting fallback initialization...');
        this.initializeClient(false);
      }, 5000);
    }
  }

  /**
   * Start periodic restart timer
   */
  startPeriodicRestartTimer() {
    if (this.periodicRestartTimer) {
      clearTimeout(this.periodicRestartTimer);
    }
    
    const nextRestartTime = new Date(Date.now() + this.periodicRestartInterval);
    console.log(`⏰ Periodic restart scheduled in ${this.periodicRestartInterval / (60 * 60 * 1000)} hours`);
    console.log(`📅 Next restart time: ${nextRestartTime.toLocaleString()}`);
    console.log(`📊 Current restart count: ${this.restartCount}`);
    console.log(`🕐 Last restart: ${this.lastRestartTime.toLocaleString()}`);
    
    this.periodicRestartTimer = setTimeout(() => {
      console.log('⏰ Periodic restart timer triggered');
      
      // Check if session save is in progress - defer restart to prevent corruption
      if (this.isSessionSaving) {
        console.log('⏳ Session save in progress - deferring periodic restart');
        this.restartPending = true;
        // The restart will be triggered automatically when session save completes
        return;
      }
      
      this.gracefulRestart('PERIODIC');
    }, this.periodicRestartInterval);
  }

  /**
   * Stop periodic restart timer
   */
  stopPeriodicRestartTimer() {
    if (this.periodicRestartTimer) {
      clearTimeout(this.periodicRestartTimer);
      this.periodicRestartTimer = null;
      console.log('⏰ Periodic restart timer stopped');
    }
  }

  /**
   * Start cache maintenance timer for periodic cleanup
   */
  startCacheMaintenanceTimer() {
    if (this.cacheMaintenanceTimer) {
      clearTimeout(this.cacheMaintenanceTimer);
    }

    const nextMaintenanceTime = new Date(Date.now() + this.cacheMaintenanceInterval);
    console.log(`🧹 Cache maintenance scheduled in ${this.cacheMaintenanceInterval / (24 * 60 * 60 * 1000)} days`);
    console.log(`📅 Next cache cleanup: ${nextMaintenanceTime.toLocaleString()}`);
    
    this.cacheMaintenanceTimer = setTimeout(async () => {
      console.log('🧹 Cache maintenance timer triggered');
      try {
        await this.performCacheMaintenance();
        console.log('✅ Cache maintenance completed successfully');
        // Restart the timer for next maintenance
        this.startCacheMaintenanceTimer();
      } catch (error) {
        console.error('❌ Cache maintenance failed:', error);
        // Still restart the timer even if maintenance failed
        this.startCacheMaintenanceTimer();
      }
    }, this.cacheMaintenanceInterval);
  }

  /**
   * Stop cache maintenance timer
   */
  stopCacheMaintenanceTimer() {
    if (this.cacheMaintenanceTimer) {
      clearTimeout(this.cacheMaintenanceTimer);
      this.cacheMaintenanceTimer = null;
      console.log('🧹 Cache maintenance timer stopped');
    }
  }

  /**
   * Perform cache maintenance without restarting the client
   */
  async performCacheMaintenance() {
    try {
      const cacheDir = path.join(process.cwd(), '.wwebjs_cache');
      
      if (fs.existsSync(cacheDir)) {
        const stats = await this.getCacheStats(cacheDir);
        
        // Only clean if cache is larger than 50MB or has been 5+ days since last cleanup
        const daysSinceLastCleanup = (Date.now() - this.lastCacheCleanup) / (24 * 60 * 60 * 1000);
        
        if (stats.sizeMB > 50 || daysSinceLastCleanup >= 5) {
          console.log(`🧹 Performing cache maintenance - Size: ${stats.sizeMB}MB, Days since last cleanup: ${Math.round(daysSinceLastCleanup)}`);
          
          // Perform cache rotation first to preserve some data
          const rotationResult = await this.rotateCacheFiles();
          if (rotationResult.rotated) {
            console.log(`🔄 Cache rotation completed: ${rotationResult.filesRotated} files rotated, ${rotationResult.sizeFreedMB}MB freed`);
          }
          
          // Clean remaining cache
          fs.rmSync(cacheDir, { recursive: true, force: true });
          this.lastCacheCleanup = Date.now();
          
          this.logCacheCleanup(stats, rotationResult);
          console.log('✅ Cache maintenance completed');
        } else {
          console.log(`ℹ️ Cache maintenance skipped - Size: ${stats.sizeMB}MB (threshold: 50MB), Days: ${Math.round(daysSinceLastCleanup)} (threshold: 5)`);
        }
      } else {
        console.log('ℹ️ No cache directory found during maintenance');
      }
    } catch (error) {
      console.error('⚠️ Error during cache maintenance:', error.message);
      throw error;
    }
  }

  /**
   * Start cache monitoring timer
   */
  startCacheMonitoring() {
    if (this.cacheMonitoringTimer) {
      clearTimeout(this.cacheMonitoringTimer);
    }

    console.log(`📊 Starting cache monitoring (every ${this.cacheMonitoringInterval / (60 * 60 * 1000)} hours)`);
    
    this.cacheMonitoringTimer = setTimeout(async () => {
      try {
        await this.monitorCacheSize();
        // Restart the timer for next monitoring
        this.startCacheMonitoring();
      } catch (error) {
        console.error('❌ Cache monitoring failed:', error);
        // Still restart the timer even if monitoring failed
        this.startCacheMonitoring();
      }
    }, this.cacheMonitoringInterval);
  }

  /**
   * Stop cache monitoring timer
   */
  stopCacheMonitoring() {
    if (this.cacheMonitoringTimer) {
      clearTimeout(this.cacheMonitoringTimer);
      this.cacheMonitoringTimer = null;
      console.log('📊 Cache monitoring stopped');
    }
  }

  /**
   * Monitor cache size and alert if thresholds are exceeded
   */
  async monitorCacheSize() {
    try {
      const cacheDir = path.join(process.cwd(), '.wwebjs_cache');
      
      if (fs.existsSync(cacheDir)) {
        const stats = await this.getCacheStats(cacheDir);
        
        console.log(`📊 Cache monitoring - Size: ${stats.sizeMB}MB, Files: ${stats.fileCount}`);
        
        if (stats.sizeMB >= this.cacheCriticalThreshold) {
          console.error(`🚨 CRITICAL: Cache size ${stats.sizeMB}MB exceeds critical threshold ${this.cacheCriticalThreshold}MB`);
          console.log('🧹 Triggering emergency cache cleanup...');
          
          // Trigger emergency cleanup
          await this.cleanBrowserCache();
          console.log('✅ Emergency cache cleanup completed');
          
        } else if (stats.sizeMB >= this.cacheWarningThreshold) {
          console.warn(`⚠️ WARNING: Cache size ${stats.sizeMB}MB exceeds warning threshold ${this.cacheWarningThreshold}MB`);
          console.log('💡 Consider manual cache cleanup or wait for scheduled maintenance');
        }
        
        // Log monitoring data for analysis
        this.logCacheMonitoring(stats);
        
      } else {
        console.log('📊 Cache monitoring - No cache directory found');
      }
    } catch (error) {
      console.error('⚠️ Error during cache monitoring:', error.message);
    }
  }

  /**
   * Log cache monitoring data
   */
  logCacheMonitoring(stats) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: 'CACHE_MONITORING',
      sizeMB: stats.sizeMB,
      fileCount: stats.fileCount,
      warningThreshold: this.cacheWarningThreshold,
      criticalThreshold: this.cacheCriticalThreshold,
      status: stats.sizeMB >= this.cacheCriticalThreshold ? 'CRITICAL' : 
              stats.sizeMB >= this.cacheWarningThreshold ? 'WARNING' : 'OK'
    };
    
    console.log('📝 Cache monitoring logged:', JSON.stringify(logEntry));
  }

  /**
   * Start disk space monitoring timer
   */
  startDiskSpaceMonitoring() {
    if (this.diskSpaceMonitoringTimer) {
      clearTimeout(this.diskSpaceMonitoringTimer);
    }

    console.log(`💾 Starting disk space monitoring (every ${this.diskSpaceMonitoringInterval / (60 * 60 * 1000)} hours)`);
    
    this.diskSpaceMonitoringTimer = setTimeout(async () => {
      try {
        await this.monitorDiskSpace();
        // Restart the timer for next monitoring
        this.startDiskSpaceMonitoring();
      } catch (error) {
        console.error('❌ Disk space monitoring failed:', error);
        // Still restart the timer even if monitoring failed
        this.startDiskSpaceMonitoring();
      }
    }, this.diskSpaceMonitoringInterval);
  }

  /**
   * Stop disk space monitoring timer
   */
  stopDiskSpaceMonitoring() {
    if (this.diskSpaceMonitoringTimer) {
      clearTimeout(this.diskSpaceMonitoringTimer);
      this.diskSpaceMonitoringTimer = null;
      console.log('💾 Disk space monitoring stopped');
    }
  }

  /**
   * Monitor disk space and trigger cleanup if thresholds are exceeded
   */
  async monitorDiskSpace() {
    try {
      const diskStats = await this.getDiskSpaceStats();
      
      console.log(`💾 Disk space monitoring - Available: ${diskStats.availableMB}MB (${diskStats.availablePercent}%)`);
      
      if (diskStats.availableMB <= this.diskSpaceCriticalThreshold) {
        console.error(`🚨 CRITICAL: Available disk space ${diskStats.availableMB}MB is below critical threshold ${this.diskSpaceCriticalThreshold}MB`);
        console.log('🧹 Triggering emergency cache and session cleanup...');
        
        // Emergency cleanup sequence
        await this.cleanBrowserCache();
        await this.cleanupOldBackups();
        console.log('✅ Emergency disk space cleanup completed');
        
      } else if (diskStats.availableMB <= this.diskSpaceWarningThreshold) {
        console.warn(`⚠️ WARNING: Available disk space ${diskStats.availableMB}MB is below warning threshold ${this.diskSpaceWarningThreshold}MB`);
        console.log('💡 Consider manual cleanup or system maintenance');
      }
      
      // Log monitoring data for analysis
      this.logDiskSpaceMonitoring(diskStats);
      
    } catch (error) {
      console.error('⚠️ Error during disk space monitoring:', error.message);
    }
  }

  /**
   * Get disk space statistics
   */
  async getDiskSpaceStats() {
    try {
      const stats = fs.statSync(process.cwd());
      const statvfs = fs.statSync(process.cwd());
      
      // Use os.freemem() and os.totalmem() as approximation for disk space
      // Note: This is a simplified approach. For production, consider using a proper disk space library
      const totalMB = Math.round(os.totalmem() / (1024 * 1024));
      const freeMB = Math.round(os.freemem() / (1024 * 1024));
      const availableMB = freeMB; // Simplified - in reality, available space may be different
      const availablePercent = Math.round((availableMB / totalMB) * 100);
      
      return {
        totalMB,
        availableMB,
        availablePercent
      };
    } catch (error) {
      console.error('Error getting disk space stats:', error);
      // Return safe defaults if we can't get real stats
      return {
        totalMB: 8192, // 8GB default
        availableMB: 2048, // 2GB default
        availablePercent: 25
      };
    }
  }

  /**
   * Log disk space monitoring data
   */
  logDiskSpaceMonitoring(stats) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: 'DISK_SPACE_MONITORING',
      availableMB: stats.availableMB,
      availablePercent: stats.availablePercent,
      warningThreshold: this.diskSpaceWarningThreshold,
      criticalThreshold: this.diskSpaceCriticalThreshold,
      status: stats.availableMB <= this.diskSpaceCriticalThreshold ? 'CRITICAL' : 
              stats.availableMB <= this.diskSpaceWarningThreshold ? 'WARNING' : 'OK'
    };
    
    console.log('📝 Disk space monitoring logged:', JSON.stringify(logEntry));
  }

  /**
   * Validate session integrity before startup
   */
  async validateSessionIntegrity() {
    try {
      console.log('🔍 Validating session integrity...');
      
      const sessionPath = this.sessionPath;
      const cacheDir = path.join(process.cwd(), '.wwebjs_cache');
      
      let issues = [];
      
      // Check if session directory exists and is accessible
      if (fs.existsSync(sessionPath)) {
        try {
          const sessionStats = fs.statSync(sessionPath);
          if (!sessionStats.isDirectory()) {
            issues.push('Session path exists but is not a directory');
          }
        } catch (error) {
          issues.push(`Cannot access session directory: ${error.message}`);
        }
      }
      
      // Check cache directory for corruption indicators
      if (fs.existsSync(cacheDir)) {
        try {
          const cacheStats = await this.getCacheStats(cacheDir);
          
          // Check for unusually large cache (potential corruption)
          if (cacheStats.sizeMB > 500) {
            issues.push(`Cache size ${cacheStats.sizeMB}MB is unusually large (>500MB)`);
          }
          
          // Check for suspicious file patterns
          const files = fs.readdirSync(cacheDir, { recursive: true });
          const corruptPatterns = files.filter(file => 
            file.toString().includes('corrupt') || 
            file.toString().includes('tmp') ||
            file.toString().includes('.lock')
          );
          
          if (corruptPatterns.length > 0) {
            issues.push(`Found ${corruptPatterns.length} potentially corrupt cache files`);
          }
          
        } catch (error) {
          issues.push(`Cannot validate cache directory: ${error.message}`);
        }
      }
      
      // Log validation results
      if (issues.length > 0) {
        console.warn('⚠️ Session validation found issues:');
        issues.forEach(issue => console.warn(`  - ${issue}`));
        
        // Log validation issues
        this.logSessionValidation(issues);
        
        // Decide if we should clean up
        const criticalIssues = issues.filter(issue => 
          issue.includes('corrupt') || 
          issue.includes('unusually large') ||
          issue.includes('Cannot access')
        );
        
        if (criticalIssues.length > 0) {
          console.log('🧹 Critical session issues detected, performing cleanup...');
          await this.cleanBrowserCache();
          return { valid: false, issues, cleaned: true };
        }
        
        return { valid: false, issues, cleaned: false };
      } else {
        console.log('✅ Session validation passed - no issues detected');
        return { valid: true, issues: [], cleaned: false };
      }
      
    } catch (error) {
      console.error('❌ Error during session validation:', error.message);
      return { valid: false, issues: [`Validation error: ${error.message}`], cleaned: false };
    }
  }

  /**
   * Log session validation results
   */
  logSessionValidation(issues) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: 'SESSION_VALIDATION',
      issuesCount: issues.length,
      issues: issues,
      severity: issues.some(issue => 
        issue.includes('corrupt') || 
        issue.includes('Cannot access')
      ) ? 'CRITICAL' : 'WARNING'
    };
    
    console.log('📝 Session validation logged:', JSON.stringify(logEntry));
  }

  /**
   * Implement cache rotation to prevent single files from growing too large
   */
  async rotateCacheFiles() {
    try {
      console.log('🔄 Starting cache rotation...');
      
      const cacheDir = path.join(process.cwd(), '.wwebjs_cache');
      if (!fs.existsSync(cacheDir)) {
        console.log('📁 Cache directory does not exist, skipping rotation');
        return { rotated: false, reason: 'No cache directory' };
      }
      
      const maxFileSize = 50 * 1024 * 1024; // 50MB per file
      const rotationThreshold = 100 * 1024 * 1024; // 100MB total before rotation
      
      // Get cache statistics
      const cacheStats = await this.getCacheStats(cacheDir);
      
      if (cacheStats.sizeMB < (rotationThreshold / (1024 * 1024))) {
        console.log(`📊 Cache size ${cacheStats.sizeMB}MB is below rotation threshold`);
        return { rotated: false, reason: 'Below threshold' };
      }
      
      // Find large files that need rotation
      const largeFiles = [];
      const scanDirectory = (dir) => {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const item of items) {
          const fullPath = path.join(dir, item.name);
          
          if (item.isDirectory()) {
            scanDirectory(fullPath);
          } else if (item.isFile()) {
            try {
              const stats = fs.statSync(fullPath);
              if (stats.size > maxFileSize) {
                largeFiles.push({
                  path: fullPath,
                  size: stats.size,
                  sizeMB: Math.round(stats.size / (1024 * 1024) * 100) / 100
                });
              }
            } catch (error) {
              console.warn(`⚠️ Cannot check file ${fullPath}:`, error.message);
            }
          }
        }
      };
      
      scanDirectory(cacheDir);
      
      if (largeFiles.length === 0) {
        console.log('📁 No large files found for rotation');
        return { rotated: false, reason: 'No large files' };
      }
      
      console.log(`🔍 Found ${largeFiles.length} large files for rotation:`);
      largeFiles.forEach(file => {
        console.log(`  - ${path.basename(file.path)}: ${file.sizeMB}MB`);
      });
      
      // Create rotation backup directory
      const rotationDir = path.join(cacheDir, 'rotated_' + Date.now());
      fs.mkdirSync(rotationDir, { recursive: true });
      
      let rotatedCount = 0;
      let totalSizeFreed = 0;
      
      // Move large files to rotation directory
      for (const file of largeFiles) {
        try {
          const fileName = path.basename(file.path);
          const rotatedPath = path.join(rotationDir, fileName);
          
          fs.renameSync(file.path, rotatedPath);
          rotatedCount++;
          totalSizeFreed += file.size;
          
          console.log(`📦 Rotated ${fileName} (${file.sizeMB}MB)`);
        } catch (error) {
          console.error(`❌ Failed to rotate ${file.path}:`, error.message);
        }
      }
      
      // Clean up old rotation directories (keep only last 3)
      const rotationDirs = fs.readdirSync(cacheDir)
        .filter(name => name.startsWith('rotated_'))
        .map(name => ({
          name,
          path: path.join(cacheDir, name),
          timestamp: parseInt(name.replace('rotated_', ''))
        }))
        .sort((a, b) => b.timestamp - a.timestamp);
      
      // Remove old rotation directories (keep only 3 most recent)
      for (let i = 3; i < rotationDirs.length; i++) {
        try {
          fs.rmSync(rotationDirs[i].path, { recursive: true, force: true });
          console.log(`🗑️ Cleaned up old rotation: ${rotationDirs[i].name}`);
        } catch (error) {
          console.warn(`⚠️ Failed to clean rotation ${rotationDirs[i].name}:`, error.message);
        }
      }
      
      const result = {
        rotated: true,
        filesRotated: rotatedCount,
        sizeFreedMB: Math.round(totalSizeFreed / (1024 * 1024) * 100) / 100,
        rotationDir: rotationDir
      };
      
      console.log(`✅ Cache rotation completed: ${rotatedCount} files, ${result.sizeFreedMB}MB freed`);
      this.logCacheRotation(result);
      
      return result;
      
    } catch (error) {
      console.error('❌ Error during cache rotation:', error.message);
      return { rotated: false, error: error.message };
    }
  }

  /**
   * Log cache rotation results
   */
  logCacheRotation(result) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      event: 'CACHE_ROTATION',
      filesRotated: result.filesRotated || 0,
      sizeFreedMB: result.sizeFreedMB || 0,
      success: result.rotated,
      error: result.error || null
    };
    
    console.log('📝 Cache rotation logged:', JSON.stringify(logEntry));
  }

  async shutdown() {
    console.log('🛑 Shutting down Persistent WhatsApp Client...');
    
    // Wait for any ongoing session operations to complete before shutdown
    if (this.isSessionSaving) {
      console.log('⏳ Waiting for ongoing session save to complete before shutdown...');
      const startWait = Date.now();
      
      while (this.isSessionSaving && (Date.now() - startWait) < this.sessionOperationTimeout) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (this.isSessionSaving) {
        console.log('⚠️ Session save timeout during shutdown - proceeding with shutdown');
        this.isSessionSaving = false;
      } else {
        console.log('✅ Session save completed - proceeding with shutdown');
      }
    }
    
    // Clear any pending restart flags
    this.restartPending = false;
    
    this.stopConnectionMonitoring();
    this.stopPeriodicRestartTimer();
    this.stopCacheMaintenanceTimer();
    this.stopCacheMonitoring();
    this.stopDiskSpaceMonitoring();

    if (this.lockRefreshInterval) {
      clearInterval(this.lockRefreshInterval);
      this.lockRefreshInterval = null;
    }

    if (this.client) {
      try {
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