/**
 * Attachment Service
 * Handles processing and storage of message attachments
 */

const fs = require('fs');
const path = require('path');

class AttachmentService {
  constructor() {
    this.baseAttachmentPath = process.env.ATTACHMENT_PATH || '/Users/apple1/Downloads/WHATSAPP_DOCS/';
    this.imagesFolderName = 'IMAGES';
    this.documentsFolderName = 'DOCUMENTS';
    this.videosFolderName = 'VIDEOS';
    this.linksFolderName = 'LINKS';
    this.audioFolderName = 'AUDIO';
    
    // Ensure attachment directories exist
    this.initializeAttachmentDirectories();
  }

  /**
   * Initialize attachment directories
   */
  initializeAttachmentDirectories() {
    try {
      // Create base directory if it doesn't exist
      if (!fs.existsSync(this.baseAttachmentPath)) {
        fs.mkdirSync(this.baseAttachmentPath, { recursive: true });
        console.log(`Created base attachment directory: ${this.baseAttachmentPath}`);
      }

      // Create images directory
      const imagesPath = path.join(this.baseAttachmentPath, this.imagesFolderName);
      if (!fs.existsSync(imagesPath)) {
        fs.mkdirSync(imagesPath, { recursive: true });
        console.log(`Created images directory: ${imagesPath}`);
      }

      // Create documents directory
      const documentsPath = path.join(this.baseAttachmentPath, this.documentsFolderName);
      if (!fs.existsSync(documentsPath)) {
        fs.mkdirSync(documentsPath, { recursive: true });
        console.log(`Created documents directory: ${documentsPath}`);
      }
      
      // Create videos directory
      const videosPath = path.join(this.baseAttachmentPath, this.videosFolderName);
      if (!fs.existsSync(videosPath)) {
        fs.mkdirSync(videosPath, { recursive: true });
        console.log(`Created videos directory: ${videosPath}`);
      }
      
      // Create links directory
      const linksPath = path.join(this.baseAttachmentPath, this.linksFolderName);
      if (!fs.existsSync(linksPath)) {
        fs.mkdirSync(linksPath, { recursive: true });
        console.log(`Created links directory: ${linksPath}`);
      }
      
      // Create audio directory
      const audioPath = path.join(this.baseAttachmentPath, this.audioFolderName);
      if (!fs.existsSync(audioPath)) {
        fs.mkdirSync(audioPath, { recursive: true });
        console.log(`Created audio directory: ${audioPath}`);
      }
      
      // Create batches directory
      const batchesPath = path.join(this.baseAttachmentPath, 'batches');
      if (!fs.existsSync(batchesPath)) {
        fs.mkdirSync(batchesPath, { recursive: true });
        console.log(`Created batches directory: ${batchesPath}`);
      }

      console.log('Attachment directories initialized successfully');
    } catch (error) {
      console.error('Error initializing attachment directories:', error);
      throw error;
    }
  }

  /**
   * Save attachment to appropriate directory
   * @param {Buffer} attachmentData - Attachment data buffer
   * @param {string} fileName - Original file name
   * @param {string} mimeType - MIME type of the attachment
   * @returns {Object} - Object containing relative path and type of attachment
   */
  async saveAttachment(attachmentData, fileName, mimeType, metadata = {}) {
    try {
      // Determine attachment type based on MIME type
      const isImage = mimeType.startsWith('image/');
      const isDocument = mimeType.startsWith('application/');
      const isVideo = mimeType.startsWith('video/');
      const isAudio = mimeType.startsWith('audio/');
      
      if (!isImage && !isDocument && !isVideo && !isAudio) {
        console.log(`Unsupported attachment type: ${mimeType}`);
        return null;
      }

      // Generate unique filename to prevent collisions
      const timestamp = new Date().getTime();
      const uniqueFileName = `${timestamp}_${fileName}`;
      
      // Determine target directory and relative path
      let targetDir, relativePath, attachmentType;
      
      if (isImage) {
        targetDir = path.join(this.baseAttachmentPath, this.imagesFolderName);
        relativePath = `${this.imagesFolderName}/${uniqueFileName}`;
        attachmentType = 'image';
      } else if (isVideo) {
        targetDir = path.join(this.baseAttachmentPath, this.videosFolderName);
        relativePath = `${this.videosFolderName}/${uniqueFileName}`;
        attachmentType = 'video';
      } else if (isAudio) {
        targetDir = path.join(this.baseAttachmentPath, this.audioFolderName);
        relativePath = `${this.audioFolderName}/${uniqueFileName}`;
        attachmentType = 'audio';
      } else {
        targetDir = path.join(this.baseAttachmentPath, this.documentsFolderName);
        relativePath = `${this.documentsFolderName}/${uniqueFileName}`;
        attachmentType = 'document';
      }

      // Save the file
      const targetPath = path.join(targetDir, uniqueFileName);
      await fs.promises.writeFile(targetPath, attachmentData);
      
      console.log(`Saved ${attachmentType} attachment to ${targetPath}`);
      
      return {
        type: attachmentType,
        relativePath,
        metadata
      };
    } catch (error) {
      console.error('Error saving attachment:', error);
      return null;
    }
  }

  /**
   * Get absolute path for a relative attachment path
   * @param {string} relativePath - Relative path of the attachment
   * @returns {string} - Absolute path
   */
  getAbsolutePath(relativePath) {
    if (!relativePath) return null;
    return path.join(this.baseAttachmentPath, relativePath);
  }
  
  /**
   * Save link attachment
   * @param {string} url - URL of the link
   * @param {Object} metadata - Link metadata (title, description, etc.)
   * @returns {Object} - Object containing link data directly as JSON
   */
  async saveLinkAttachment(url, metadata = {}) {
    try {
      if (!url) {
        console.log('No URL provided for link attachment');
        return null;
      }
      
      // Clean the URL - remove backticks and trim
      url = url.replace(/`/g, '').trim();
      
      // Prepare link data
      const linkData = {
        url,
        timestamp: new Date().toISOString(),
        title: 'Link from WhatsApp', // Add default title
        description: url, // Use URL as description
        ...metadata
      };
      
      console.log(`Processed link: ${url}`);
      console.log('Link data created:', linkData);
      
      // Return the link data directly
      return {
        type: 'link',
        url,
        metadata: linkData
      };
    } catch (error) {
      console.error('Error saving link attachment:', error);
      return null;
    }
  }
  
  /**
   * Save multiple attachments as a batch
   * @param {Array} attachments - Array of attachment data objects
   * @param {string} senderName - Name of the sender
   * @returns {Object} - Object containing JSON array of paths and metadata
   */
  async saveBatchAttachments(attachments, senderName) {
    try {
      if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
        console.log('No valid attachments provided for batch processing');
        return null;
      }
      
      const timestamp = new Date().getTime();
      const batchResults = [];
      
      // Process each attachment
      for (const attachment of attachments) {
        const { data, fileName, mimeType, metadata } = attachment;
        
        let result;
        if (attachment.type === 'link') {
          result = await this.saveLinkAttachment(attachment.url, attachment.metadata);
        } else {
          result = await this.saveAttachment(data, fileName, mimeType, metadata);
        }
        
        if (result) {
          batchResults.push(result);
        }
      }
      
      if (batchResults.length === 0) {
        return null;
      }
      
      // Create a batch metadata file
      const batchMetadata = {
        timestamp: new Date().toISOString(),
        senderName,
        attachmentCount: batchResults.length,
        attachments: batchResults
      };
      
      // Save batch metadata
      const batchFileName = `batch_${timestamp}_${senderName.replace(/[^a-zA-Z0-9]/g, '_')}.json`;
      const batchDir = path.join(this.baseAttachmentPath, 'batches');
      
      // Create batches directory if it doesn't exist
      if (!fs.existsSync(batchDir)) {
        fs.mkdirSync(batchDir, { recursive: true });
      }
      
      const batchPath = path.join(batchDir, batchFileName);
      await fs.promises.writeFile(batchPath, JSON.stringify(batchMetadata, null, 2));
      
      console.log(`Saved batch of ${batchResults.length} attachments to ${batchPath}`);
      
      return {
        type: 'batch',
        paths: batchResults.map(r => r.relativePath),
        metadata: batchMetadata
      };
    } catch (error) {
      console.error('Error saving batch attachments:', error);
      return null;
    }
  }

  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} - File extension
   */
  getFileExtensionFromMimeType(mimeType) {
    const mimeToExt = {
      // Image formats
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      
      // Document formats
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc',
      'application/vnd.ms-excel': 'xls',
      'text/csv': 'csv',
      'application/csv': 'csv',
      'text/plain': 'txt',
      
      // Video formats
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',
      'video/webm': 'webm',
      'video/ogg': 'ogv',
      'video/mpeg': 'mpg',
      'video/3gpp': '3gp',
      'video/x-matroska': 'mkv',
      'video/x-flv': 'flv',
      'video/x-ms-wmv': 'wmv',
      
      // Audio formats
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
      'audio/webm': 'weba',
      'audio/aac': 'aac',
      'audio/flac': 'flac',
      'audio/x-m4a': 'm4a',
      'audio/mp4': 'm4a'
    };
    
    // Extract extension from mime type if not in our mapping
    if (!mimeToExt[mimeType] && mimeType) {
      const parts = mimeType.split('/');
      if (parts.length === 2 && parts[1]) {
        return parts[1].split(';')[0]; // Handle cases like 'video/mp4;codecs=avc1'
      }
    }
    
    return mimeToExt[mimeType] || 'bin';
  }
}

module.exports = AttachmentService;