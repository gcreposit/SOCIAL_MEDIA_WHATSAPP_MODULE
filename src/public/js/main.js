/**
 * Main JavaScript for WhatsApp Message Capture System
 */

// Connect to Socket.io server
const socket = io();

// DOM elements
const groupsList = document.getElementById('groups-list');
const messagesContainer = document.getElementById('messages-container');
const currentGroupTitle = document.getElementById('current-group');
const messageCountDisplay = document.getElementById('message-count');
const groupSearch = document.getElementById('group-search');

// Templates
const messageTemplate = document.getElementById('message-template');
const groupTemplate = document.getElementById('group-template');

// State
let currentGroupId = null;
let groups = [];

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  // Load groups
  loadGroups();

  // Set up event listeners
  setupEventListeners();

  // Set up Socket.io event handlers
  setupSocketHandlers();
});

/**
 * Load all groups from the API
 */
async function loadGroups() {
  try {
    const response = await fetch('/api/groups');
    if (!response.ok) throw new Error('Failed to fetch groups');

    groups = await response.json();
    renderGroups(groups);
  } catch (error) {
    console.error('Error loading groups:', error);
    groupsList.innerHTML = '<li class="error">Failed to load groups</li>';
  }
}

/**
 * Render groups in the sidebar
 * @param {Array} groupsData - Array of group objects
 */
function renderGroups(groupsData) {
  // Clear loading message
  groupsList.innerHTML = '';

  if (groupsData.length === 0) {
    groupsList.innerHTML = '<li class="no-groups">No groups found</li>';
    return;
  }

  // Sort groups by last message time (newest first)
  groupsData.sort((a, b) => {
    return new Date(b.last_message_time) - new Date(a.last_message_time);
  });

  // Create group elements
  groupsData.forEach(group => {
    const groupElement = createGroupElement(group);
    groupsList.appendChild(groupElement);
  });
}

/**
 * Create a group list item element
 * @param {Object} group - Group data
 * @returns {HTMLElement} - Group list item
 */
function createGroupElement(group) {
  const groupItem = document.importNode(groupTemplate.content, true).querySelector('.group-item');

  // Set group data
  groupItem.querySelector('.group-name').textContent = group.group_name || 'Unknown Group';
  groupItem.querySelector('.message-count').textContent = `${group.message_count} messages`;

  // Format last message time
  const lastMessageTime = new Date(group.last_message_time);
  groupItem.querySelector('.last-message-time').textContent = formatDate(lastMessageTime);

  // Set group ID as data attribute
  groupItem.dataset.groupId = group.group_id;

  // Add click event to load messages
  groupItem.addEventListener('click', () => {
    // Remove active class from all groups
    document.querySelectorAll('.group-item').forEach(item => {
      item.classList.remove('active');
    });

    // Add active class to clicked group
    groupItem.classList.add('active');

    // Load messages for this group
    loadMessages(group.group_id);

    // Update current group
    currentGroupId = group.group_id;
    currentGroupTitle.textContent = group.group_name || 'Unknown Group';
  });

  return groupItem;
}

/**
 * Load messages for a specific group
 * @param {string} groupId - Group ID
 */
async function loadMessages(groupId) {
  try {
    // Show loading state
    messagesContainer.innerHTML = '<div class="loading">Loading messages...</div>';

    const response = await fetch(`/api/messages/${groupId}`);
    if (!response.ok) throw new Error('Failed to fetch messages');

    const messages = await response.json();
    renderMessages(messages);

    // Update message count
    messageCountDisplay.textContent = `${messages.length} messages`;
  } catch (error) {
    console.error('Error loading messages:', error);
    messagesContainer.innerHTML = '<div class="error">Failed to load messages</div>';
  }
}

/**
 * Render messages in the messages container
 * @param {Array} messages - Array of message objects
 */
function renderMessages(messages) {
  // Clear messages container
  messagesContainer.innerHTML = '';

  if (messages.length === 0) {
    messagesContainer.innerHTML = '<div class="no-messages">No messages in this group</div>';
    return;
  }

  // Sort messages by timestamp (newest first)
  messages.sort((a, b) => {
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  // Create message elements
  messages.forEach(message => {
    const messageElement = createMessageElement(message);
    messagesContainer.appendChild(messageElement);
  });

  // Scroll to top (newest messages)
  messagesContainer.scrollTop = 0;
}

/**
 * Create a message element
 * @param {Object} message - Message data
 * @returns {HTMLElement} - Message element
 */
// function createMessageElement(message) {
//   const messageElement = document.importNode(messageTemplate.content, true).querySelector('.message');
//
//   // Set message data
//   messageElement.querySelector('.sender-name').textContent = message.sender_name;
//   messageElement.querySelector('.timestamp').textContent = formatDate(new Date(message.timestamp));
//
//   const messageBody = messageElement.querySelector('.message-body');
//   messageBody.textContent = message.message_text;
//
//   // Add reply attachment if present
//   if (message.reply_attachment_path && message.reply_attachment_type) {
//     const replyAttachment = createReplyAttachmentElement(
//       message.reply_attachment_path,
//       message.reply_attachment_type,
//       message.reply_text
//     );
//     if (replyAttachment) {
//       messageBody.appendChild(replyAttachment);
//     }
//   }
//
//   // Add attachments if present
//   const attachmentPaths = [
//     { path: message.image_attachment_path, type: 'Image' },
//     { path: message.document_attachment_path, type: 'Document' },
//     { path: message.video_attachment_path, type: 'Video' },
//     { path: message.audio_attachment_path, type: 'Audio' }
//   ].filter(att => att.path);
//
//   if (attachmentPaths.length > 0) {
//     const attachmentsDiv = document.createElement('div');
//     attachmentsDiv.className = 'message-attachments';
//
//     attachmentPaths.forEach(att => {
//       const attachmentElement = createAttachmentElement(att.path, att.type, message.message_text);
//       if (attachmentElement) {
//         attachmentsDiv.appendChild(attachmentElement);
//       }
//     });
//
//     messageBody.appendChild(attachmentsDiv);
//
//     imageLink.appendChild(image);
//     imageContainer.appendChild(imageLink);
//     attachmentsDiv.appendChild(imageContainer);
//   }
//
//   // Add document attachment
//   if (message.document_attachment_path) {
//     const docContainer = document.createElement('div');
//     docContainer.className = 'document-attachment';
//
//     const docLink = document.createElement('a');
//     docLink.href = `/attachments/${message.document_attachment_path}`;
//     docLink.target = '_blank';
//     docLink.className = 'document-link';
//     docLink.textContent = 'View Document';
//
//     docContainer.appendChild(docLink);
//     attachmentsDiv.appendChild(docContainer);
//   }
//
//   messageElement.appendChild(attachmentsDiv);
//   return messageElement;
//
// }

/**
 * Create a message element
 * @param {Object} message - Message data
 * @returns {HTMLElement} - Message element
 */
function createMessageElement(message) {
  const messageElement = document.importNode(messageTemplate.content, true).querySelector('.message');

  // Set message data
  messageElement.querySelector('.sender-name').textContent = message.sender_name;
  messageElement.querySelector('.timestamp').textContent = formatDate(new Date(message.timestamp));

  const messageBody = messageElement.querySelector('.message-body');
  messageBody.textContent = message.message_text;

  // Add reply attachment if present
  if (message.reply_attachment_path && message.reply_attachment_type) {
    const replyAttachment = createReplyAttachmentElement(
        message.reply_attachment_path,
        message.reply_attachment_type,
        message.reply_text
    );
    if (replyAttachment) {
      // Prepend reply to keep it visually grouped with the message text it's replying to
      messageBody.prepend(replyAttachment);
    }
  }

  // Consolidate all attachment types into a single array
  const attachmentPaths = [
    { path: message.image_attachment_path, type: 'Image' },
    { path: message.document_attachment_path, type: 'Document' },
    { path: message.video_attachment_path, type: 'Video' },
    { path: message.audio_attachment_path, type: 'Audio' }
  ].filter(att => att.path);

  // If there are any attachments, create a container and add them
  if (attachmentPaths.length > 0) {
    const attachmentsDiv = document.createElement('div');
    attachmentsDiv.className = 'message-attachments';

    attachmentPaths.forEach(att => {
      const attachmentElement = createAttachmentElement(att.path, att.type, message.message_text);
      if (attachmentElement) {
        attachmentsDiv.appendChild(attachmentElement);
      }
    });

    // Append the single container for all attachments to the message body
    messageBody.appendChild(attachmentsDiv);
  }

  return messageElement;
}

/**
 * Format date for display
 * @param {Date} date - Date object
 * @returns {string} - Formatted date string
 */
function formatDate(date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  // Check if date is today
  if (date >= today) {
    return `Today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Check if date is yesterday
  if (date >= yesterday) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  // Otherwise show full date
  return date.toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Group search
  groupSearch.addEventListener('input', () => {
    const searchTerm = groupSearch.value.toLowerCase();

    // Filter groups by name
    const filteredGroups = groups.filter(group => {
      const groupName = (group.group_name || '').toLowerCase();
      return groupName.includes(searchTerm);
    });

    // Render filtered groups
    renderGroups(filteredGroups);
  });
}

/**
 * Set up Socket.io event handlers
 */
function setupSocketHandlers() {
  // New message event
  socket.on('new-message', (message) => {
    // Update group list if needed
    updateGroupWithNewMessage(message);

    // If current group is the one receiving the message, add it to the view
    if (currentGroupId === message.groupId) {
      const messageElement = createMessageElement(message);
      messagesContainer.insertBefore(messageElement, messagesContainer.firstChild);

      // Update message count
      const currentCount = parseInt(messageCountDisplay.textContent);
      messageCountDisplay.textContent = `${currentCount + 1} messages`;
    }
  });
}

/**
 * Update group list with new message
 * @param {Object} message - New message
 */
function updateGroupWithNewMessage(message) {
  // Find group in list
  const groupIndex = groups.findIndex(group => group.group_id === message.groupId);

  if (groupIndex !== -1) {
    // Update existing group
    groups[groupIndex].message_count++;
    groups[groupIndex].last_message_time = message.timestamp;
  } else {
    // Add new group
    groups.push({
      group_id: message.groupId,
      group_name: message.groupName,
      message_count: 1,
      last_message_time: message.timestamp
    });
  }

  // Re-render groups
  renderGroups(groups);
}/**
 *
 Document viewing functionality
 */

// Create document modal if it doesn't exist
function createDocumentModal() {
  if (document.getElementById('document-modal')) return;

  const modal = document.createElement('div');
  modal.id = 'document-modal';
  modal.className = 'document-modal';
  modal.innerHTML = `
    <div class="document-modal-content">
      <div class="document-modal-header">
        <h3 class="document-modal-title">Document Preview</h3>
        <button class="document-modal-close" onclick="closeDocumentModal()">&times;</button>
      </div>
      <div class="document-modal-body">
        <div id="document-preview-content"></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeDocumentModal();
    }
  });
}

/**
 * Open document modal
 */
function openDocumentModal() {
  const modal = document.getElementById('document-modal');
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

/**
 * Close document modal
 */
function closeDocumentModal() {
  const modal = document.getElementById('document-modal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

/**
 * Preview document
 */
async function previewDocument(relativePath, filename) {
  try {
    createDocumentModal();

    // Get document info
    const infoResponse = await fetch(`/api/documents/info/${encodeURIComponent(relativePath)}`);
    if (!infoResponse.ok) throw new Error('Failed to get document info');

    const docInfo = await infoResponse.json();

    // Update modal title
    document.querySelector('.document-modal-title').textContent = filename || docInfo.filename;

    const previewContent = document.getElementById('document-preview-content');

    if (docInfo.canPreview) {
      if (docInfo.extension === 'pdf') {
        // PDF preview
        previewContent.innerHTML = `
          <iframe class="document-preview" src="${docInfo.previewUrl}" type="application/pdf">
            <p>Your browser doesn't support PDF preview. <a href="${docInfo.downloadUrl}">Download the file</a> instead.</p>
          </iframe>
        `;
      } else if (['txt', 'csv'].includes(docInfo.extension)) {
        // Text file preview
        const textResponse = await fetch(docInfo.previewUrl);
        const textContent = await textResponse.text();

        previewContent.innerHTML = `
          <div class="document-text-preview">${escapeHtml(textContent)}</div>
        `;
      }
    } else if (docInfo.needsExternalViewer) {
      // Office documents
      previewContent.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <div style="font-size: 48px; margin-bottom: 20px;">📄</div>
          <h3>Office Document</h3>
          <p>This document requires an external viewer like Microsoft Office.</p>
          <p><strong>File:</strong> ${docInfo.filename}</p>
          <p><strong>Size:</strong> ${docInfo.sizeFormatted}</p>
          <p><strong>Type:</strong> ${docInfo.extension.toUpperCase()}</p>
          <br>
          <a href="${docInfo.downloadUrl}" class="btn-attachment btn-download">
            📥 Download File
          </a>
        </div>
      `;
    } else {
      // Unsupported format
      previewContent.innerHTML = `
        <div style="text-align: center; padding: 40px;">
          <div style="font-size: 48px; margin-bottom: 20px;">📎</div>
          <h3>File Attachment</h3>
          <p>Preview not available for this file type.</p>
          <p><strong>File:</strong> ${docInfo.filename}</p>
          <p><strong>Size:</strong> ${docInfo.sizeFormatted}</p>
          <br>
          <a href="${docInfo.downloadUrl}" class="btn-attachment btn-download">
            📥 Download File
          </a>
        </div>
      `;
    }

    openDocumentModal();

  } catch (error) {
    console.error('Error previewing document:', error);
    alert('Failed to preview document: ' + error.message);
  }
}

/**
 * Download document
 */
function downloadDocument(relativePath, filename) {
  const downloadUrl = `/api/documents/download/${encodeURIComponent(relativePath)}`;

  // Create temporary link and click it
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = filename || '';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Show document info
 */
async function showDocumentInfo(relativePath, filename) {
  try {
    const response = await fetch(`/api/documents/info/${encodeURIComponent(relativePath)}`);
    if (!response.ok) throw new Error('Failed to get document info');

    const docInfo = await response.json();

    const info = `
Document Information:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 Filename: ${docInfo.filename}
📏 Size: ${docInfo.sizeFormatted}
🏷️ Type: ${docInfo.extension.toUpperCase()}
📅 Modified: ${new Date(docInfo.lastModified).toLocaleString()}
🔍 Can Preview: ${docInfo.canPreview ? 'Yes' : 'No'}
🖥️ Needs External Viewer: ${docInfo.needsExternalViewer ? 'Yes' : 'No'}
📂 Path: ${docInfo.relativePath}
    `;

    alert(info);

  } catch (error) {
    console.error('Error getting document info:', error);
    alert('Failed to get document info: ' + error.message);
  }
}

/**
 * Create attachment element
 */
function createAttachmentElement(attachmentPath, type, messageText = '') {
  if (!attachmentPath) return null;

  const attachment = document.createElement('div');
  attachment.className = 'attachment';

  const filename = attachmentPath.split('/').pop();
  const extension = filename.split('.').pop().toLowerCase();

  // Get appropriate icon
  let icon = '📎';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
    icon = '🖼️';
  } else if (['pdf'].includes(extension)) {
    icon = '📄';
  } else if (['doc', 'docx'].includes(extension)) {
    icon = '📝';
  } else if (['xls', 'xlsx'].includes(extension)) {
    icon = '📊';
  } else if (['ppt', 'pptx'].includes(extension)) {
    icon = '📽️';
  } else if (['mp4', 'avi', 'mov', 'webm'].includes(extension)) {
    icon = '🎥';
  } else if (['mp3', 'wav', 'ogg', 'aac'].includes(extension)) {
    icon = '🎵';
  }

  attachment.innerHTML = `
    <div class="attachment-header">
      <div class="attachment-info">
        <div class="attachment-icon">${icon}</div>
        <div class="attachment-details">
          <div class="attachment-name">${filename}</div>
          <div class="attachment-meta">${type} • ${extension.toUpperCase()}</div>
        </div>
      </div>
      <div class="attachment-actions">
        <button class="btn-attachment btn-view" onclick="previewDocument('${attachmentPath}', '${filename}')" title="Preview">
          👁️ View
        </button>
        <button class="btn-attachment btn-download" onclick="downloadDocument('${attachmentPath}', '${filename}')" title="Download">
          📥 Download
        </button>
        <button class="btn-attachment btn-info" onclick="showDocumentInfo('${attachmentPath}', '${filename}')" title="Info">
          ℹ️ Info
        </button>
      </div>
    </div>
  `;

  // Special handling for images
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) {
    const imgPreview = document.createElement('img');
    imgPreview.src = `/attachments/${attachmentPath}`;
    imgPreview.className = 'image-attachment';
    imgPreview.alt = filename;
    imgPreview.onclick = () => previewDocument(attachmentPath, filename);
    attachment.appendChild(imgPreview);
  }

  // Special handling for videos
  if (['mp4', 'webm', 'ogg'].includes(extension)) {
    const videoPreview = document.createElement('video');
    videoPreview.src = `/attachments/${attachmentPath}`;
    videoPreview.className = 'video-attachment';
    videoPreview.controls = true;
    videoPreview.preload = 'metadata';
    attachment.appendChild(videoPreview);
  }

  // Special handling for audio
  if (['mp3', 'wav', 'ogg', 'aac'].includes(extension)) {
    const audioPreview = document.createElement('audio');
    audioPreview.src = `/attachments/${attachmentPath}`;
    audioPreview.className = 'audio-attachment';
    audioPreview.controls = true;
    audioPreview.preload = 'metadata';
    attachment.appendChild(audioPreview);
  }

  return attachment;
}

/**
 * Create reply attachment element
 */
function createReplyAttachmentElement(replyAttachmentPath, replyAttachmentType, replyText) {
  if (!replyAttachmentPath) return null;

  const replyAttachment = document.createElement('div');
  replyAttachment.className = 'reply-attachment';

  const filename = replyAttachmentPath.split('/').pop();

  replyAttachment.innerHTML = `
    <div class="reply-attachment-label">Replying to ${replyAttachmentType}:</div>
    <div class="reply-attachment-info">${filename}</div>
    ${replyText ? `<div class="reply-attachment-info">"${replyText}"</div>` : ''}
  `;

  return replyAttachment;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Trigger data cleanup
 */
async function triggerDataCleanup() {
  if (!confirm('This will delete old messages and attachments to free up space. Continue?')) {
    return;
  }

  try {
    const button = document.getElementById('cleanup-btn');
    if (button) {
      button.disabled = true;
      button.textContent = 'Cleaning up...';
    }

    const response = await fetch('/api/cleanup/trigger', {
      method: 'POST'
    });

    if (!response.ok) throw new Error('Failed to trigger cleanup');

    const result = await response.json();
    alert('Data cleanup started successfully! Check the console for progress.');

  } catch (error) {
    console.error('Error triggering cleanup:', error);
    alert('Failed to trigger cleanup: ' + error.message);
  } finally {
    const button = document.getElementById('cleanup-btn');
    if (button) {
      button.disabled = false;
      button.textContent = 'Clean Up Data';
    }
  }
}



