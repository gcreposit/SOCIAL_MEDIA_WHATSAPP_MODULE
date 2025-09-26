/**
 * Express Server
 * Handles web interface and API endpoints
 */

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const apiRoutes = require('./routes/api');

class Server {
  /**
   * Constructor
   * @param {Object} dbService - Database service
   */
  constructor(dbService, documentViewerService = null) {
    this.dbService = dbService;
    this.documentViewerService = documentViewerService;
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
    // Enable CORS for cross-origin requests
    this.app.use(cors({
      origin: ['http://localhost:8080', 'http://localhost:9000', 'http://localhost:3000','http://94.136.189.241:2121'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'ngrok-skip-browser-warning', 'User-Agent']
    }));

    // Additional CORS headers for broader compatibility
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, ngrok-skip-browser-warning, User-Agent');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });
    
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
    this.app.use('/api', apiRoutes(this.dbService, this.documentViewerService));
    
    // Document viewing routes
    if (this.documentViewerService) {
      this.setupDocumentRoutes();
    }
    
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
    
    // QR code authentication route
    this.app.get('/qr', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'qr.html'));
    });
  }
  
  /**
   * Set up document viewing routes
   */
  setupDocumentRoutes() {
    const fs = require('fs');
    
    // PDF preview route
    this.app.get('/api/documents/preview/pdf/:path', async (req, res) => {
      try {
        const relativePath = decodeURIComponent(req.params.path);
        const docInfo = await this.documentViewerService.getDocumentInfo(relativePath);
        
        if (!docInfo || !fs.existsSync(docInfo.absolutePath)) {
          return res.status(404).json({ error: 'Document not found' });
        }
        
        if (docInfo.extension !== 'pdf') {
          return res.status(400).json({ error: 'Not a PDF file' });
        }
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${docInfo.filename}"`);
        
        const fileStream = fs.createReadStream(docInfo.absolutePath);
        fileStream.pipe(res);
      } catch (error) {
        console.error('Error serving PDF:', error);
        res.status(500).json({ error: 'Error serving PDF' });
      }
    });
    
    // Text file preview route
    this.app.get('/api/documents/preview/text/:path', async (req, res) => {
      try {
        const relativePath = decodeURIComponent(req.params.path);
        const content = await this.documentViewerService.getTextContent(relativePath);
        
        if (!content) {
          return res.status(404).json({ error: 'Document not found or cannot read content' });
        }
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.send(content);
      } catch (error) {
        console.error('Error serving text file:', error);
        res.status(500).json({ error: 'Error serving text file' });
      }
    });
    
    // Office document preview route (redirect to download)
    this.app.get('/api/documents/preview/office/:path', async (req, res) => {
      try {
        const relativePath = decodeURIComponent(req.params.path);
        const downloadUrl = this.documentViewerService.getDownloadUrl(relativePath);
        
        // For office documents, redirect to download since they need external viewers
        res.json({
          message: 'Office documents require external viewer',
          downloadUrl: downloadUrl,
          suggestion: 'Please download the file to view it in Microsoft Office or compatible application'
        });
      } catch (error) {
        console.error('Error handling office document:', error);
        res.status(500).json({ error: 'Error handling office document' });
      }
    });
    
    // Document download route
    this.app.get('/api/documents/download/:path', async (req, res) => {
      try {
        const relativePath = decodeURIComponent(req.params.path);
        const docInfo = await this.documentViewerService.getDocumentInfo(relativePath);
        
        if (!docInfo || !fs.existsSync(docInfo.absolutePath)) {
          return res.status(404).json({ error: 'Document not found' });
        }
        
        res.setHeader('Content-Type', docInfo.mimeType);
        res.setHeader('Content-Disposition', `attachment; filename="${docInfo.filename}"`);
        res.setHeader('Content-Length', docInfo.size);
        
        const fileStream = fs.createReadStream(docInfo.absolutePath);
        fileStream.pipe(res);
      } catch (error) {
        console.error('Error downloading document:', error);
        res.status(500).json({ error: 'Error downloading document' });
      }
    });
    
    // Document info route
    this.app.get('/api/documents/info/:path', async (req, res) => {
      try {
        const relativePath = decodeURIComponent(req.params.path);
        const docInfo = await this.documentViewerService.getDocumentInfo(relativePath);
        
        if (!docInfo) {
          return res.status(404).json({ error: 'Document not found' });
        }
        
        res.json({
          ...docInfo,
          previewUrl: this.documentViewerService.getPreviewUrl(relativePath),
          downloadUrl: this.documentViewerService.getDownloadUrl(relativePath),
          canPreview: this.documentViewerService.canPreview(relativePath),
          needsExternalViewer: this.documentViewerService.needsExternalViewer(relativePath)
        });
      } catch (error) {
        console.error('Error getting document info:', error);
        res.status(500).json({ error: 'Error getting document info' });
      }
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