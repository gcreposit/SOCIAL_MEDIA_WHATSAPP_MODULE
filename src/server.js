/**
 * Express Server
 * Handles web interface and API endpoints
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const apiRoutes = require('./routes/api');

class Server {
  /**
   * Constructor
   * @param {Object} dbService - Database service
   */
  constructor(dbService) {
    this.dbService = dbService;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server);
    this.port = process.env.PORT || 3000;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupSocketHandlers();
  }
  
  /**
   * Set up Express middleware
   */
  setupMiddleware() {
    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, 'public')));
    
    // Serve attachment files
    this.app.use('/attachments', express.static(process.env.ATTACHMENT_PATH || '/Users/apple1/Downloads/WHATSAPP_DOCS/'));
    
    // Parse JSON request bodies
    this.app.use(express.json());
  }
  
  /**
   * Set up routes
   */
  setupRoutes() {
    // API routes
    this.app.use('/api', apiRoutes(this.dbService));
    
    // Main route (Table View)
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
    
    // Dashboard view route
    this.app.get('/dashboard.html', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
    });
    
    // Table view route
    this.app.get('/table', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'table.html'));
    });
  }
  
  /**
   * Set up Socket.io event handlers
   */
  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('New client connected');
      
      socket.on('disconnect', () => {
        console.log('Client disconnected');
      });
    });
  }
  
  /**
   * Broadcast new message to all connected clients
   * @param {Object} message - Message object
   */
  broadcastNewMessage(message) {
    this.io.emit('new-message', message);
    console.log('Broadcasting new message to clients:', message.id);
  }
  
  /**
   * Start the server
   */
  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`Server running on port ${this.port}`);
        console.log(`Web interface available at http://localhost:${this.port}`);
        resolve();
      });
    });
  }
  
  /**
   * Stop the server
   */
  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Server;