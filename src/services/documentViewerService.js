/**
 * Document Viewer Service
 * Handles viewing and processing of documents (PDF, DOC, Excel, etc.)
 */

const fs = require('fs');
const path = require('path');

class DocumentViewerService {
  constructor(attachmentService) {
    this.attachmentService = attachmentService;
    this.supportedFormats = {
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'txt': 'text/plain',
      'csv': 'text/csv'
    };
  }

  /**
   * Get document info and metadata
   * @param {string} relativePath - Relative path to the document
   * @returns {Object} - Document information
   */
  async getDocumentInfo(relativePath) {
    try {
      if (!relativePath) {
        throw new Error('No document path provided');
      }

      const absolutePath = this.attachmentService.getAbsolutePath(relativePath);
      
      if (!fs.existsSync(absolutePath)) {
        throw new Error('Document file not found');
      }

      const stats = fs.statSync(absolutePath);
      const extension = path.extname(relativePath).toLowerCase().substring(1);
      const filename = path.basename(relativePath);
      
      return {
        filename,
        extension,
        size: stats.size,
        sizeFormatted: this.formatFileSize(stats.size),
        mimeType: this.supportedFormats[extension] || 'application/octet-stream',
        lastModified: stats.mtime,
        isSupported: !!this.supportedFormats[extension],
        relativePath,
        absolutePath,
        viewerType: this.getViewerType(extension)
      };
    } catch (error) {
      console.error('Error getting document info:', error);
      return null;
    }
  }

  /**
   * Get viewer type for document
   * @param {string} extension - File extension
   * @returns {string} - Viewer type
   */
  getViewerType(extension) {
    const viewerMap = {
      'pdf': 'pdf-viewer',
      'doc': 'office-viewer',
      'docx': 'office-viewer',
      'xls': 'office-viewer',
      'xlsx': 'office-viewer',
      'ppt': 'office-viewer',
      'pptx': 'office-viewer',
      'txt': 'text-viewer',
      'csv': 'csv-viewer'
    };
    
    return viewerMap[extension] || 'download-only';
  }

  /**
   * Get document content for text files
   * @param {string} relativePath - Relative path to the document
   * @returns {string} - Document content
   */
  async getTextContent(relativePath) {
    try {
      const absolutePath = this.attachmentService.getAbsolutePath(relativePath);
      const extension = path.extname(relativePath).toLowerCase().substring(1);
      
      if (!['txt', 'csv'].includes(extension)) {
        throw new Error('Text content only available for text and CSV files');
      }

      if (!fs.existsSync(absolutePath)) {
        throw new Error('Document file not found');
      }

      const content = fs.readFileSync(absolutePath, 'utf8');
      return content;
    } catch (error) {
      console.error('Error reading text content:', error);
      return null;
    }
  }

  /**
   * Generate document preview URL for web interface
   * @param {string} relativePath - Relative path to the document
   * @returns {string} - Preview URL
   */
  getPreviewUrl(relativePath) {
    if (!relativePath) return null;
    
    const extension = path.extname(relativePath).toLowerCase().substring(1);
    const encodedPath = encodeURIComponent(relativePath);
    
    switch (extension) {
      case 'pdf':
        return `/api/documents/preview/pdf/${encodedPath}`;
      case 'doc':
      case 'docx':
      case 'xls':
      case 'xlsx':
      case 'ppt':
      case 'pptx':
        return `/api/documents/preview/office/${encodedPath}`;
      case 'txt':
      case 'csv':
        return `/api/documents/preview/text/${encodedPath}`;
      default:
        return `/api/documents/download/${encodedPath}`;
    }
  }

  /**
   * Generate download URL
   * @param {string} relativePath - Relative path to the document
   * @returns {string} - Download URL
   */
  getDownloadUrl(relativePath) {
    if (!relativePath) return null;
    
    const encodedPath = encodeURIComponent(relativePath);
    return `/api/documents/download/${encodedPath}`;
  }

  /**
   * Format file size in human readable format
   * @param {number} bytes - File size in bytes
   * @returns {string} - Formatted size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get all documents from messages
   * @param {Array} messages - Array of messages
   * @returns {Array} - Array of document info objects
   */
  async getDocumentsFromMessages(messages) {
    const documents = [];
    
    for (const message of messages) {
      const documentPaths = [
        message.document_attachment_path,
        message.image_attachment_path,
        message.video_attachment_path,
        message.audio_attachment_path
      ].filter(path => path);
      
      for (const docPath of documentPaths) {
        const docInfo = await this.getDocumentInfo(docPath);
        if (docInfo) {
          documents.push({
            ...docInfo,
            messageId: message.id,
            groupName: message.group_name,
            senderName: message.sender_name,
            timestamp: message.timestamp,
            messageText: message.message_text
          });
        }
      }
    }
    
    return documents;
  }

  /**
   * Search documents by filename or content
   * @param {string} query - Search query
   * @param {Array} messages - Array of messages to search in
   * @returns {Array} - Array of matching documents
   */
  async searchDocuments(query, messages) {
    const allDocuments = await this.getDocumentsFromMessages(messages);
    
    if (!query) return allDocuments;
    
    const searchTerm = query.toLowerCase();
    
    return allDocuments.filter(doc => {
      return doc.filename.toLowerCase().includes(searchTerm) ||
             doc.senderName.toLowerCase().includes(searchTerm) ||
             doc.groupName.toLowerCase().includes(searchTerm) ||
             (doc.messageText && doc.messageText.toLowerCase().includes(searchTerm));
    });
  }

  /**
   * Get document statistics
   * @param {Array} messages - Array of messages
   * @returns {Object} - Document statistics
   */
  async getDocumentStats(messages) {
    const documents = await this.getDocumentsFromMessages(messages);
    
    const stats = {
      total: documents.length,
      byType: {},
      totalSize: 0,
      byGroup: {}
    };
    
    documents.forEach(doc => {
      // Count by type
      if (!stats.byType[doc.extension]) {
        stats.byType[doc.extension] = 0;
      }
      stats.byType[doc.extension]++;
      
      // Total size
      stats.totalSize += doc.size;
      
      // Count by group
      if (!stats.byGroup[doc.groupName]) {
        stats.byGroup[doc.groupName] = 0;
      }
      stats.byGroup[doc.groupName]++;
    });
    
    stats.totalSizeFormatted = this.formatFileSize(stats.totalSize);
    
    return stats;
  }

  /**
   * Check if document can be previewed in browser
   * @param {string} relativePath - Relative path to the document
   * @returns {boolean} - True if can be previewed
   */
  canPreview(relativePath) {
    if (!relativePath) return false;
    
    const extension = path.extname(relativePath).toLowerCase().substring(1);
    return ['pdf', 'txt', 'csv'].includes(extension);
  }

  /**
   * Check if document needs external viewer
   * @param {string} relativePath - Relative path to the document
   * @returns {boolean} - True if needs external viewer
   */
  needsExternalViewer(relativePath) {
    if (!relativePath) return false;
    
    const extension = path.extname(relativePath).toLowerCase().substring(1);
    return ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension);
  }
}

module.exports = DocumentViewerService;