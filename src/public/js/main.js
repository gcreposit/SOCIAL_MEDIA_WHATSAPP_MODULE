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
function createMessageElement(message) {
  const messageElement = document.importNode(messageTemplate.content, true).querySelector('.message');
  
  // Set message data
  messageElement.querySelector('.sender-name').textContent = message.sender_name;
  messageElement.querySelector('.timestamp').textContent = formatDate(new Date(message.timestamp));
  
  const messageBody = messageElement.querySelector('.message-body');
  messageBody.textContent = message.message_text;
  
  // Add attachments if present
  if (message.image_attachment_path || message.document_attachment_path) {
    const attachmentsDiv = document.createElement('div');
    attachmentsDiv.className = 'message-attachments';
    
    // Add image attachment
    if (message.image_attachment_path) {
      const imageContainer = document.createElement('div');
      imageContainer.className = 'image-attachment';
      
      const imageLink = document.createElement('a');
      imageLink.href = `/attachments/${message.image_attachment_path}`;
      imageLink.target = '_blank';
      
      const image = document.createElement('img');
      image.src = `/attachments/${message.image_attachment_path}`;
      image.alt = 'Image attachment';
      image.style.maxWidth = '200px';
      image.style.maxHeight = '200px';
      
      imageLink.appendChild(image);
      imageContainer.appendChild(imageLink);
      attachmentsDiv.appendChild(imageContainer);
    }
    
    // Add document attachment
    if (message.document_attachment_path) {
      const docContainer = document.createElement('div');
      docContainer.className = 'document-attachment';
      
      const docLink = document.createElement('a');
      docLink.href = `/attachments/${message.document_attachment_path}`;
      docLink.target = '_blank';
      docLink.className = 'document-link';
      docLink.textContent = 'View Document';
      
      docContainer.appendChild(docLink);
      attachmentsDiv.appendChild(docContainer);
    }
    
    messageElement.appendChild(attachmentsDiv);
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
}