# Design Document

## Overview

The WhatsApp Message Capture System is a Node.js-based application that uses WhatsApp Web automation to monitor messages from 250+ WhatsApp groups and store them in a MySQL database. The system provides a real-time web interface for viewing messages organized by group.

## Architecture

The system follows a modular architecture with clear separation of concerns:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   WhatsApp Web  │───▶│   Node.js App    │───▶│   MySQL DB      │
│   (via library) │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌──────────────────┐
                       │   Web Interface  │
                       │   (Express +     │
                       │   Socket.io)     │
                       └──────────────────┘
```

### Technology Stack
- **Backend**: Node.js with Express.js
- **WhatsApp Integration**: whatsapp-web.js library
- **Database**: MySQL with mysql2 driver
- **Real-time Updates**: Socket.io
- **Frontend**: Simple HTML/CSS/JavaScript

## Components and Interfaces

### 1. WhatsApp Client Manager
**Purpose**: Manages WhatsApp Web connection and message listening

**Key Methods**:
- `initializeClient()`: Sets up WhatsApp Web client
- `handleQRCode(qr)`: Displays QR code for authentication
- `onMessageReceived(message)`: Processes incoming messages
- `isBusinessMessage(message)`: Filters out business account's own messages

**Dependencies**: whatsapp-web.js

### 2. Database Manager
**Purpose**: Handles all MySQL database operations

**Key Methods**:
- `connect()`: Establishes database connection
- `saveMessage(groupId, sender, messageText, timestamp)`: Stores message
- `getMessagesByGroup(groupId)`: Retrieves messages for specific group
- `getAllGroups()`: Gets list of all monitored groups
- `reconnect()`: Handles connection recovery

**Dependencies**: mysql2

### 3. Message Processor
**Purpose**: Processes and validates messages before storage

**Key Methods**:
- `processMessage(rawMessage)`: Extracts relevant data from WhatsApp message
- `validateMessage(message)`: Ensures message meets storage criteria
- `formatMessageData(message)`: Formats data for database storage

### 4. Web Server
**Purpose**: Serves web interface and API endpoints

**Key Routes**:
- `GET /`: Main dashboard showing all groups
- `GET /api/groups`: Returns list of all groups with message counts
- `GET /api/messages/:groupId`: Returns messages for specific group
- `GET /api/messages`: Returns all messages with pagination

**Dependencies**: Express.js, Socket.io

### 5. Real-time Notification Service
**Purpose**: Provides real-time updates to web interface

**Key Methods**:
- `broadcastNewMessage(message)`: Sends new message to all connected clients
- `notifyGroupUpdate(groupId)`: Updates group message counts

## Data Models

### Message Model
```sql
CREATE TABLE messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    group_id VARCHAR(255) NOT NULL,
    group_name VARCHAR(255),
    sender_name VARCHAR(255) NOT NULL,
    message_text TEXT NOT NULL,
    timestamp DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_group_id (group_id),
    INDEX idx_timestamp (timestamp)
);
```

### Group Model (Virtual - derived from messages)
```javascript
{
    groupId: String,
    groupName: String,
    messageCount: Number,
    lastMessageTime: Date
}
```

### Message Processing Flow
```
WhatsApp Message → Validate → Extract Data → Store in DB → Notify Web Interface
```

## Error Handling

### WhatsApp Connection Errors
- **QR Code Expiry**: Generate new QR code and log event
- **Session Timeout**: Attempt automatic reconnection, fallback to QR code
- **Rate Limiting**: Implement exponential backoff for message processing

### Database Errors
- **Connection Loss**: Implement connection pooling and automatic reconnection
- **Query Failures**: Log errors and continue processing other messages
- **Storage Full**: Monitor disk space and implement log rotation

### Message Processing Errors
- **Invalid Message Format**: Log and skip malformed messages
- **Large Message Content**: Truncate messages exceeding text field limits
- **Duplicate Messages**: Use message ID to prevent duplicates

## Testing Strategy

### Unit Tests
- Message processing functions
- Database operations
- Data validation methods
- Error handling scenarios

### Integration Tests
- WhatsApp client initialization
- Database connection and queries
- Web server endpoints
- Socket.io real-time updates

### System Tests
- End-to-end message flow from WhatsApp to database to web interface
- Multiple group message handling
- Connection recovery scenarios
- Performance testing with high message volumes

### Manual Testing
- QR code authentication process
- Web interface functionality
- Real-time message updates
- System behavior during network interruptions

## Performance Considerations

### Message Volume Handling
- Implement message queuing for high-volume periods
- Use database connection pooling
- Batch insert operations when possible

### Memory Management
- Limit in-memory message cache size
- Implement periodic garbage collection
- Monitor Node.js heap usage

### Database Optimization
- Index on group_id and timestamp columns
- Implement message archiving for old data
- Use prepared statements for frequent queries

## Deployment Architecture

### Single Server Deployment
```
┌─────────────────────────────────────┐
│           Server                    │
│  ┌─────────────────────────────────┐│
│  │        Node.js App              ││
│  │  ┌─────────────────────────────┐││
│  │  │    WhatsApp Client          │││
│  │  │    Express Server           │││
│  │  │    Socket.io                │││
│  │  └─────────────────────────────┘││
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │        MySQL Database          ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

### Configuration Management
- Environment variables for database credentials
- Configurable message retention periods
- Adjustable connection timeout settings