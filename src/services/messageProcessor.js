/**
 * Message Processor Service
 * Processes and validates messages before storage
 */

const AttachmentService = require('./attachmentService');

class MessageProcessor {
  constructor() {
    // Initialize attachment service
    this.attachmentService = new AttachmentService();
  }

  /**
   * Process raw WhatsApp message
   * @param {Object} rawMessage - Raw WhatsApp message object
   * @returns {Object|null} - Processed message or null if invalid
   */
  async processMessage(rawMessage) {
    try {
      // Log detailed message information with color
      const util = require('util');
      console.log('🔄 PROCESSING MESSAGE 🔄');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      const messageInfo = {
        content: rawMessage.body || '[NO CONTENT]',
        type: rawMessage.type || 'unknown',
        messageId: rawMessage.id ? rawMessage.id._serialized : 'unknown',
        timestamp: rawMessage.timestamp ? new Date(rawMessage.timestamp * 1000).toISOString() : 'unknown'
      };
      console.log(util.inspect(messageInfo, { colors: true, depth: null }));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Extract message data
      const messageData = await this.extractMessageData(rawMessage);
      
      // Check if this is a reply to another message
      if (rawMessage.hasQuotedMsg) {
        try {
          console.log('Processing quoted message...');
          const quotedMsg = await rawMessage.getQuotedMessage();
          console.log('Got quoted message, has media:', quotedMsg.hasMedia);
          console.log('Quoted message type:', quotedMsg.type);
          
          const quotedData = await this.extractReplyData(quotedMsg);
          console.log('Extracted reply data:', util.inspect(quotedData, { colors: true, depth: null }));
          
          if (quotedData) {
            messageData.replyToMessageId = quotedData.messageId;
            // Use replyText from quotedData if available (for video attachments)
            messageData.replyText = quotedData.replyText || quotedData.messageText;
            // Fix: Ensure attachment type and path are correctly assigned
            messageData.replyAttachmentType = quotedData.attachmentType;
            messageData.replyAttachmentPath = quotedData.attachmentPath;
            // Add unified attachment_type field
            messageData.attachmentType = messageData.attachmentType || null;
            
            // Verify attachment type and path are correctly set
            if (messageData.replyAttachmentPath && !messageData.replyAttachmentType) {
              // Infer type from path if missing
              if (messageData.replyAttachmentPath.includes('VIDEOS/')) {
                messageData.replyAttachmentType = 'video';
              } else if (messageData.replyAttachmentPath.includes('AUDIO/')) {
                messageData.replyAttachmentType = 'audio';
              } else if (messageData.replyAttachmentPath.includes('IMAGES/')) {
                messageData.replyAttachmentType = 'image';
              } else if (messageData.replyAttachmentPath.includes('DOCUMENTS/')) {
                messageData.replyAttachmentType = 'document';
              }
              console.log('Inferred replyAttachmentType from path:', messageData.replyAttachmentType);
            }
            
            console.log('Setting reply data in messageData:');
            console.log('- replyToMessageId:', messageData.replyToMessageId);
            console.log('- replyText:', messageData.replyText);
            console.log('- replyAttachmentType:', messageData.replyAttachmentType);
            console.log('- replyAttachmentPath:', messageData.replyAttachmentPath);
            
            // For video replies, ensure replyText contains the path if empty
            if (quotedData.attachmentType === 'video' && (!messageData.replyText || messageData.replyText.trim() === '')) {
              messageData.replyText = quotedData.attachmentPath;
              console.log('Setting replyText to video path in processMessage:', messageData.replyText);
            }
            
            // Special handling for video and audio attachments
            if (quotedMsg.hasMedia) {
              if (quotedMsg.type === 'video' && !messageData.replyAttachmentType) {
                messageData.replyAttachmentType = 'video';
                
                // If we don't have a path yet, generate one
                if (!messageData.replyAttachmentPath) {
                  const timestamp = quotedMsg.timestamp ? quotedMsg.timestamp * 1000 : new Date().getTime();
                  const filename = `${timestamp}_attachment_${timestamp}.mp4`;
                  messageData.replyAttachmentPath = `VIDEOS/${filename}`;
                  console.log('Generated video attachment path for reply:', messageData.replyAttachmentPath);
                }
              } else if (quotedMsg.type === 'audio' && !messageData.replyAttachmentType) {
                messageData.replyAttachmentType = 'audio';
                
                // If we don't have a path yet, generate one
                if (!messageData.replyAttachmentPath) {
                  const timestamp = quotedMsg.timestamp ? quotedMsg.timestamp * 1000 : new Date().getTime();
                  const filename = `${timestamp}_attachment_${timestamp}.mp3`;
                  messageData.replyAttachmentPath = `AUDIO/${filename}`;
                  console.log('Generated audio attachment path for reply:', messageData.replyAttachmentPath);
                }
              }
            }
          }
        } catch (replyError) {
          console.error('Error processing reply:', replyError);
        }
      }
      
      // Check for links in the message text and process them
      const linkData = await this.extractAndProcessLinks(messageData.messageText);
      if (linkData) {
        messageData.linkMetadata = linkData.linkMetadata;
        console.log('Link metadata in processMessage:', JSON.stringify(messageData.linkMetadata));
        console.log('Link metadata type:', typeof messageData.linkMetadata);
        // Separate link from message text if requested
        if (linkData.extractedLink) {
          messageData.messageText = messageData.messageText.replace(linkData.extractedLink, '').trim();
        }
      }
      
      // Process attachments if present
      if (rawMessage.hasMedia) {
        try {
          // Check if this is part of a batch
          const isBatchAttachment = this.isBatchAttachment(rawMessage);
          
          if (isBatchAttachment) {
            // Process as part of a batch
            const batchData = await this.processBatchAttachment(rawMessage);
            if (batchData) {
              messageData.batchAttachmentPath = batchData.batchAttachmentPath;
              messageData.batchMetadata = batchData.batchMetadata;
            }
          } else {
            // Process as a single attachment
            const attachmentData = await this.processAttachment(rawMessage);
            if (attachmentData) {
              messageData.imageAttachmentPath = attachmentData.imageAttachmentPath;
              messageData.documentAttachmentPath = attachmentData.documentAttachmentPath;
              messageData.videoAttachmentPath = attachmentData.videoAttachmentPath;
              messageData.audioAttachmentPath = attachmentData.audioAttachmentPath;
            }
          }
        } catch (attachmentError) {
          console.error('Error processing attachment:', attachmentError);
          // Continue processing the message even if attachment fails
        }
      }
      
      // Validate message
      if (!this.validateMessage(messageData)) {
        return null;
      }
      
      // Format message data for storage
      return this.formatMessageData(messageData);
    } catch (error) {
      console.error('Error processing message:', error);
      return null;
    }
  }
  
  /**
   * Extract and process links from message text
   * @param {string} messageText - Message text to extract links from
   * @returns {Object|null} - Link data or null if no links found
   */
  async extractAndProcessLinks(messageText) {
    try {
      if (!messageText) return null;
      
      // Regular expression to find URLs in text
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const matches = messageText.match(urlRegex);
      
      if (!matches || matches.length === 0) return null;
      
      console.log('Found links in message:', matches);
      
      // Process all links found
      const links = [];
      
      for (let url of matches) {
        try {
          // Remove any backticks from the URL
          url = url.replace(/`/g, '');
          url = url.trim();
          
          console.log('Processing cleaned URL:', url);
          
          // Process link metadata - await the Promise
          const linkData = await this.attachmentService.saveLinkAttachment(url, {
            extractedFrom: 'message',
            extractedAt: new Date().toISOString()
          });
          
          console.log('Link data from attachmentService (resolved):', linkData);
          
          if (linkData && linkData.url) {
            // Just store the URL directly
            console.log('Adding URL to links array:', linkData.url);
            links.push(linkData.url);
          }
        } catch (error) {
          console.error(`Error processing link ${url}:`, error);
        }
      }
      
      if (links.length === 0) return null;
      
      console.log('Final links array:', links);
      
      return {
        extractedLink: matches[0], // Keep the first link for backward compatibility
        linkMetadata: links // Return the links array directly, not as a JSON string
      };
    } catch (error) {
      const util = require('util');
      console.error('Error processing link:', util.inspect({ error: error.message }, { colors: true, depth: null }));
      return null;
    }
  }
  
  /**
   * Check if message is part of a batch attachment
   * @param {Object} rawMessage - Raw WhatsApp message
   * @returns {boolean} - True if message is part of a batch
   */
  isBatchAttachment(rawMessage) {
    // This is a placeholder for batch detection logic
    // In a real implementation, you might check for specific markers in the message
    // or use timing and sender information to group messages
    
    // For now, we'll assume it's not a batch
    return false;
  }
  
  /**
   * Process a batch of attachments
   * @param {Object} rawMessage - Raw WhatsApp message
   * @returns {Object} - Batch attachment data
   */
  async processBatchAttachment(rawMessage) {
    // This would implement batch processing logic
    // For now, we'll return null as this is a placeholder
    return null;
  }

  /**
   * Extract relevant data from WhatsApp message
   * @param {Object} rawMessage - Raw WhatsApp message object
   * @returns {Object} - Extracted message data
   */
  async extractMessageData(rawMessage) {
    try {
      // Get chat (group) information
      const chat = await rawMessage.getChat();
      
      // Get contact (sender) information
      const contact = await rawMessage.getContact();
      
      // Enhanced logging for group and sender information with color
      // Add a single util declaration at the top of the function
      const util = require('util');
      console.log('📊 MESSAGE DATA EXTRACTION 📊');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      const extractionInfo = {
        group: {
          name: chat.isGroup ? chat.name : '[NOT A GROUP]',
          id: chat.id._serialized,
          isGroup: chat.isGroup,
          participantCount: chat.isGroup ? chat.participants.length : 'N/A'
        },
        sender: {
          name: contact.pushname || contact.name || 'Unknown',
          id: contact.id._serialized
        }
      };
      console.log(util.inspect(extractionInfo, { colors: true, depth: null }));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      return {
        messageId: rawMessage.id._serialized,
        groupId: chat.id._serialized,
        groupName: chat.name,
        senderId: contact.id._serialized,
        senderName: contact.pushname || contact.name || 'Unknown',
        messageText: rawMessage.body,
        timestamp: rawMessage.timestamp ? new Date(rawMessage.timestamp * 1000) : new Date(),
        isGroup: chat.isGroup
      };
    } catch (error) {
      console.error('Error extracting message data:', util.inspect({ error: error.message }, { colors: true, depth: null }));
      throw error;
    }
  }
  
  /**
   * Extract data from a quoted/replied message
   * @param {Object} quotedMsg - The quoted message object
   * @returns {Object} - Extracted reply data
   */
  async extractReplyData(quotedMsg) {
    try {
      if (!quotedMsg) return null;
      
      // Add a single util declaration at the top of the function
      const util = require('util');
      
      // Enhanced logging for reply data extraction with color
      console.log('💬 REPLY DATA EXTRACTION 💬');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      const replyInfo = {
        quotedMessageId: quotedMsg.id ? quotedMsg.id._serialized : 'unknown',
        content: quotedMsg.body || '[NO CONTENT]',
        type: quotedMsg.type || 'unknown',
        hasMedia: quotedMsg.hasMedia ? 'Yes' : 'No'
      };
      console.log(util.inspect(replyInfo, { colors: true, depth: null }));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Determine attachment type and path
      let attachmentType = null;
      let attachmentPath = null;
      
      if (quotedMsg.hasMedia) {
        console.log('📎 Quoted message has media, processing attachment...');
        const mediaData = await quotedMsg.downloadMedia();
        console.log('📄 Media data downloaded:', util.inspect({ mimetype: mediaData?.mimetype || 'unknown' }, { colors: true, depth: null }));
        
        if (mediaData && mediaData.mimetype) {
          if (mediaData.mimetype.startsWith('image/')) {
            attachmentType = 'image';
            // Try to get the image path from the message data
            // For WhatsApp images, we need to query the database to get the actual path
            // For now, we'll use the format that matches how images are stored in the system
            const timestamp = quotedMsg.timestamp ? quotedMsg.timestamp * 1000 : new Date().getTime();
            const filename = `${timestamp}_attachment_${timestamp}.jpg`;
            attachmentPath = `IMAGES/${filename}`;
            console.log('Reply to image attachment path set to:', util.inspect({ path: attachmentPath }, { colors: true, depth: null }));
          } else if (mediaData.mimetype.startsWith('video/')) {
            attachmentType = 'video';
            // Use the same format as the original video storage
            const timestamp = quotedMsg.timestamp ? quotedMsg.timestamp * 1000 : new Date().getTime();
            const filename = `${timestamp}_attachment_${timestamp}.mp4`;
            attachmentPath = `VIDEOS/${filename}`;
            console.log('Reply to video attachment:', util.inspect({ path: attachmentPath, type: attachmentType }, { colors: true, depth: null }));
          } else if (mediaData.mimetype.startsWith('audio/')) {
            attachmentType = 'audio';
            // Use the same format as the original audio storage
            const timestamp = quotedMsg.timestamp ? quotedMsg.timestamp * 1000 : new Date().getTime();
            const filename = `${timestamp}_attachment_${timestamp}.mp3`;
            attachmentPath = `AUDIO/${filename}`;
            console.log('Reply to audio attachment path set to:', util.inspect({ path: attachmentPath }, { colors: true, depth: null }));
          } else if (mediaData.mimetype.startsWith('application/')) {
            attachmentType = 'document';
            // Use the same format as the original document storage
            const timestamp = quotedMsg.timestamp ? quotedMsg.timestamp * 1000 : new Date().getTime();
            const filename = `${timestamp}_attachment_${timestamp}.pdf`;
            attachmentPath = `DOCUMENTS/${filename}`;
            console.log('Reply to document attachment path set to:', util.inspect({ path: attachmentPath }, { colors: true, depth: null }));
          }
          console.log('After processing media:', util.inspect({ attachmentType, attachmentPath }, { colors: true, depth: null }));
        } else {
          console.log(util.inspect({ error: 'No valid media data or mimetype found in quoted message' }, { colors: true, depth: null }));
        }
      } else {
        // Check if the message contains a link
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const matches = quotedMsg.body.match(urlRegex);
        
        if (matches && matches.length > 0) {
          attachmentType = 'link';
          // Store the URL as the attachment path for links
          attachmentPath = matches[0];
          console.log('Reply to link attachment path set to:', util.inspect({ path: attachmentPath }, { colors: true, depth: null }));
        }
      }
      
      // For video replies, also set the replyText to the attachmentPath
      // This ensures the video path is available in the reply_text field
      let replyText = quotedMsg.body;
      
      // If it's a video attachment and there's no text, use the path as the reply text
      if (attachmentType === 'video' && (!replyText || replyText.trim() === '')) {
        replyText = attachmentPath;
      }
      
      // Ensure attachmentType and attachmentPath are set correctly for videos
      if (quotedMsg.hasMedia && !attachmentType) {
        // If we couldn't determine the type from mimetype, try to infer from other properties
        if (quotedMsg.type === 'video') {
          attachmentType = 'video';
          const timestamp = quotedMsg.timestamp ? quotedMsg.timestamp * 1000 : new Date().getTime();
          const filename = `${timestamp}_attachment_${timestamp}.mp4`;
          attachmentPath = `VIDEOS/${filename}`;
          console.log('Inferred video attachment from message type:', util.inspect({ path: attachmentPath }, { colors: true, depth: null }));
        }
      }
      
      // Final check to ensure video paths are correctly set
      if (attachmentType === 'video' && !attachmentPath) {
        const timestamp = quotedMsg.timestamp ? quotedMsg.timestamp * 1000 : new Date().getTime();
        const filename = `${timestamp}_attachment_${timestamp}.mp4`;
        attachmentPath = `VIDEOS/${filename}`;
        console.log('Fixed missing video attachment path:', util.inspect({ path: attachmentPath }, { colors: true, depth: null }));
      }
      
      const result = {
        messageId: quotedMsg.id._serialized,
        messageText: quotedMsg.body,
        attachmentType,
        attachmentPath,
        replyText: replyText
      };
      
      console.log('Final reply data being returned:', util.inspect(result, { colors: true, depth: null }));
      return result;
    } catch (error) {
      console.error('Error extracting message data:', util.inspect({ error: error.message }, { colors: true, depth: null }));
      throw error;
    }
  }

  /**
   * Validate message meets storage criteria
   * @param {Object} message - Extracted message data
   * @returns {boolean} - True if message is valid
   */
  validateMessage(message) {
    // Add a single util declaration at the top of the function
    const util = require('util');
    
    // Process both group and individual messages
    // No longer rejecting non-group messages as per user request
    if (!message.isGroup) {
      console.log(util.inspect({ info: 'Processing individual (non-group) message' }, { colors: true, depth: null }));
      // Continue processing individual messages
    }
    
    // Check if message has required fields
    // For group messages, we need groupId; for individual messages, we need senderName
    if ((message.isGroup && !message.groupId) || !message.senderName) {
      console.log(util.inspect({ rejected: 'Missing required fields' }, { colors: true, depth: null }));
      return false;
    }
    
    // Check if message has either text content, any type of attachment, or is a reply
    // Allow empty messages in group chats as they might be system notifications or status updates
    if (message.messageText.trim() === '' && 
        !message.imageAttachmentPath && 
        !message.documentAttachmentPath && 
        !message.videoAttachmentPath && 
        !message.audioAttachmentPath && 
        !message.linkMetadata && 
        !message.batchAttachmentPath &&
        !message.replyToMessageId) {
      console.log(util.inspect({ rejected: 'Empty message with no attachments or reply context' }, { colors: true, depth: null }));
      // We'll still accept the message if it's from a group, as it might be a system message
      // or status update that we want to track
      return true;
    }
    
    return true;
  }

  /**
   * Process message attachment
   * @param {Object} rawMessage - Raw WhatsApp message object
   * @returns {Object} - Object with attachment paths
   */
  async processAttachment(rawMessage) {
    try {
      // Add a single util declaration at the top of the function
      const util = require('util');
      
      // Enhanced logging for attachment processing with color
      console.log('📎 ATTACHMENT PROCESSING 📎');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      const attachmentInfo = {
        messageId: rawMessage.id ? rawMessage.id._serialized : 'unknown',
        messageType: rawMessage.type || 'unknown',
        hasMedia: rawMessage.hasMedia ? 'Yes' : 'No'
      };
      console.log(util.inspect(attachmentInfo, { colors: true, depth: null }));
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Download media data
      const mediaData = await rawMessage.downloadMedia();
      
      if (!mediaData || !mediaData.data) {
        console.log(util.inspect({ error: '❌ No media data found in message' }, { colors: true, depth: null }));
        return null;
      }
      console.log('✅ Media downloaded successfully:', util.inspect({ mimetype: mediaData.mimetype }, { colors: true, depth: null }));
      
      // Extract media info
      const { data, mimetype, filename } = mediaData;
      
      // Convert base64 data to buffer
      const buffer = Buffer.from(data, 'base64');
      
      // Generate filename if not provided
      const attachmentFilename = filename || `attachment_${Date.now()}.${this.getFileExtensionFromMimeType(mimetype)}`;
      
      // Extract metadata from media if available
      const metadata = {
        originalFilename: filename,
        mimeType: mimetype,
        timestamp: new Date().toISOString()
      };
      
      // Save attachment
      const savedAttachment = await this.attachmentService.saveAttachment(buffer, attachmentFilename, mimetype, metadata);
      
      if (!savedAttachment) {
        return null;
      }
      
      // Return appropriate path based on attachment type
      const result = {
        imageAttachmentPath: null,
        documentAttachmentPath: null,
        videoAttachmentPath: null,
        audioAttachmentPath: null
      };
      
      switch (savedAttachment.type) {
        case 'image':
          result.imageAttachmentPath = savedAttachment.relativePath;
          break;
        case 'document':
          result.documentAttachmentPath = savedAttachment.relativePath;
          break;
        case 'video':
          result.videoAttachmentPath = savedAttachment.relativePath;
          break;
        case 'audio':
          result.audioAttachmentPath = savedAttachment.relativePath;
          break;
      }
      
      return result;
    } catch (error) {
      console.error('Error processing attachment:', util.inspect({ error: error.message }, { colors: true, depth: null }));
      return null;
    }
  }
  
  /**
   * Get file extension from MIME type
   * @param {string} mimeType - MIME type
   * @returns {string} - File extension
   */
  getFileExtensionFromMimeType(mimeType) {
    // Add a single util declaration at the top of the function
    const util = require('util');
    console.log('Getting file extension for MIME type:', util.inspect({ mimeType }, { colors: true, depth: null }));
    
    const mimeToExt = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/msword': 'doc',
      'application/vnd.ms-excel': 'xls',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
      'video/x-msvideo': 'avi',
      'video/webm': 'webm',
      'video/ogg': 'ogv',
      'video/mpeg': 'mpg',
      'video/3gpp': 'mp4',  // Common for mobile videos
      'video/x-matroska': 'mkv' // MKV format
    };
    
    // Check if it's any kind of video
    if (mimeType && mimeType.startsWith('video/')) {
      const specificExt = mimeToExt[mimeType];
      if (specificExt) {
        console.log('Found specific video extension:', util.inspect({ extension: specificExt }, { colors: true, depth: null }));
        return specificExt;
      }
      console.log(util.inspect({ message: 'Generic video MIME type detected, using mp4 extension' }, { colors: true, depth: null }));
      return 'mp4'; // Default to mp4 for any video type not specifically listed
    }
    
    // Extract extension from mime type if not in our mapping
    if (!mimeToExt[mimeType] && mimeType) {
      const parts = mimeType.split('/');
      if (parts.length === 2 && parts[1]) {
        return parts[1].split(';')[0]; // Handle cases like 'video/mp4;codecs=avc1'
      }
    }
    
    const extension = mimeToExt[mimeType] || 'bin';
    console.log('Using extension:', util.inspect({ extension }, { colors: true, depth: null }));
    return extension;
  }

  /**
   * Format message data for database storage
   * @param {Object} message - Validated message data
   * @returns {Object} - Formatted message data
   */
  formatMessageData(message) {
    // Add a single util declaration at the top of the function
    const util = require('util');
    
    console.log('Formatting message data for storage, checking reply data:');
    console.log(util.inspect({
      replyAttachmentType: message.replyAttachmentType,
      replyAttachmentPath: message.replyAttachmentPath,
      replyText: message.replyText
    }, { colors: true, depth: null }));
    
    // For video replies, ensure replyText contains the video path if not already set
    if (message.replyAttachmentType === 'video' && (!message.replyText || message.replyText.trim() === '') && message.replyAttachmentPath) {
      message.replyText = message.replyAttachmentPath;
      console.log('Setting replyText to video path:', util.inspect({ replyText: message.replyText }, { colors: true, depth: null }));
    }
    
    // Ensure replyAttachmentType and replyAttachmentPath are properly set for videos and audio
    if (message.replyAttachmentPath) {
      if (message.replyAttachmentPath.includes('VIDEOS/') && !message.replyAttachmentType) {
        message.replyAttachmentType = 'video';
        console.log('Fixed missing replyAttachmentType for video:', util.inspect({ type: message.replyAttachmentType }, { colors: true, depth: null }));
      } else if (message.replyAttachmentPath.includes('AUDIO/') && !message.replyAttachmentType) {
        message.replyAttachmentType = 'audio';
        console.log('Fixed missing replyAttachmentType for audio:', util.inspect({ type: message.replyAttachmentType }, { colors: true, depth: null }));
      }
    }
    
    // Fix: Make sure replyAttachmentPath is not empty when replyAttachmentType is set
    if (message.replyAttachmentType && !message.replyAttachmentPath) {
      console.log('Warning: replyAttachmentType is set but replyAttachmentPath is empty');
      // Try to infer path from type
      if (message.replyAttachmentType === 'video') {
        const timestamp = new Date().getTime();
        message.replyAttachmentPath = `VIDEOS/${timestamp}_attachment_${timestamp}.mp4`;
        console.log('Generated missing video path for reply:', util.inspect({ path: message.replyAttachmentPath }, { colors: true, depth: null }));
      } else if (message.replyAttachmentType === 'audio') {
        const timestamp = new Date().getTime();
        message.replyAttachmentPath = `AUDIO/${timestamp}_attachment_${timestamp}.mp3`;
        console.log('Generated missing audio path for reply:', util.inspect({ path: message.replyAttachmentPath }, { colors: true, depth: null }));
      }
    }
    
    // Determine unified attachment type
    let attachmentType = null;
    if (message.imageAttachmentPath) {
      attachmentType = 'image';
    } else if (message.videoAttachmentPath) {
      attachmentType = 'video';
    } else if (message.audioAttachmentPath) {
      attachmentType = 'audio';
    } else if (message.documentAttachmentPath) {
      attachmentType = 'document';
    } else if (message.linkMetadata) {
      attachmentType = 'link';
    } else if (message.batchAttachmentPath) {
      attachmentType = 'batch';
    }
    const formattedMessage = {
  groupId: message.groupId,
  groupName: message.groupName,
  senderName: message.senderName,
  messageText: message.messageText,
  timestamp: message.timestamp,
  imageAttachmentPath: message.imageAttachmentPath || null,
  documentAttachmentPath: message.documentAttachmentPath || null,
  videoAttachmentPath: message.videoAttachmentPath || null,
  audioAttachmentPath: message.audioAttachmentPath || null,
  linkMetadata: message.linkMetadata || null,
  batchAttachmentPath: message.batchAttachmentPath || null,
  batchMetadata: message.batchMetadata || null,
  replyToMessageId: message.replyToMessageId || null,
  replyText: message.replyText || null,
  replyAttachmentType: message.replyAttachmentType || null,
  replyAttachmentPath: message.replyAttachmentPath || null,
  attachmentType: message.attachmentType || attachmentType
};

console.log(JSON.stringify(formattedMessage, null, 2));

    
    return {
      groupId: message.groupId,
      groupName: message.groupName,
      senderName: message.senderName,
      messageText: message.messageText,
      timestamp: message.timestamp,
      imageAttachmentPath: message.imageAttachmentPath || null,
      documentAttachmentPath: message.documentAttachmentPath || null,
      videoAttachmentPath: message.videoAttachmentPath || null,
      audioAttachmentPath: message.audioAttachmentPath || null,
      linkMetadata: message.linkMetadata || null,
      batchAttachmentPath: message.batchAttachmentPath || null,
      batchMetadata: message.batchMetadata || null,
      replyToMessageId: message.replyToMessageId || null,
      replyText: message.replyText || null,
      replyAttachmentType: message.replyAttachmentType || null,
      replyAttachmentPath: message.replyAttachmentPath || null,
      attachmentType: message.attachmentType || attachmentType
    };
  }
}

module.exports = MessageProcessor;