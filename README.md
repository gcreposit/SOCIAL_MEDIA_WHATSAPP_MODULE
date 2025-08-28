# WhatsApp Message Capture System

A Node.js application that monitors messages from WhatsApp groups and stores them in a MySQL database with a real-time web interface for viewing messages.

## Features

- Monitors 250+ WhatsApp groups simultaneously
- Stores messages in MySQL database
- Real-time web interface for viewing messages by group
- Automatic reconnection to WhatsApp Web
- Message filtering to exclude business account's own messages

## Requirements

- Node.js (v14 or higher)
- MySQL database
- WhatsApp account for business use

## Installation

1. Clone the repository

```bash
git clone <repository-url>
cd whatsapp-integration
```

2. Install dependencies

```bash
npm install
```

3. Configure environment variables

Copy the `.env.example` file to `.env` and update the values:

```bash
cp .env.example .env
```

Edit the `.env` file with your MySQL database credentials and other settings.

4. Create MySQL database

```sql
CREATE DATABASE whatsapp_messages;
```

The application will automatically create the required tables on startup.

## Usage

### Standard Mode (with Web Interface)

1. Start the application

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

2. Scan the QR code with your WhatsApp business account

When the application starts, it will display a QR code in the terminal. Scan this with your WhatsApp business account to authenticate.

3. Access the web interface

Open your browser and navigate to `http://localhost:3000` (or the port you configured in the `.env` file).

### Backend-Only Mode

For running on a VM or server without frontend requirements:

```bash
npm run start:backend
```

This mode disables the web server component and runs only the WhatsApp client and database services. The QR code for authentication will be displayed in the terminal.

## Architecture

The system follows a modular architecture with the following components:

- **WhatsApp Client**: Manages WhatsApp Web connection and message listening
- **Database Service**: Handles MySQL database operations
- **Message Processor**: Processes and validates messages before storage
- **Web Server**: Serves web interface and API endpoints
- **Real-time Updates**: Provides real-time updates to web interface using Socket.io

## Step-by-Step Implementation Guide

### 1. Project Setup

- [x] Create Node.js project with package.json
  ```bash
  npm init -y
  ```
- [x] Install required dependencies
  ```bash
  npm install express whatsapp-web.js mysql2 socket.io dotenv qrcode-terminal
  npm install --save-dev jest nodemon
  ```
- [x] Create directory structure
  ```bash
  mkdir -p src/models src/services src/routes src/public/css src/public/js
  ```
- [x] Create environment configuration (.env file)

### 2. Database Implementation

- [x] Create database schema with messages table
- [x] Implement database connection module with connection pooling
- [x] Add database connection error handling and reconnection logic
- [x] Implement database service methods for saving and retrieving messages

### 3. WhatsApp Integration

- [x] Initialize WhatsApp Web client using whatsapp-web.js
- [x] Implement QR code generation and display for authentication
- [x] Add session management and automatic reconnection handling
- [x] Create message event listener for incoming WhatsApp messages
- [x] Add logic to filter out business account's own messages

### 4. Message Processing

- [x] Implement Message model with validation methods
- [x] Create data formatting functions for WhatsApp message processing
- [x] Process and validate messages before database storage
- [x] Integrate message processor with database service
- [x] Add error handling for message storage failures

### 5. Web Server & API

- [x] Set up Express server with basic configuration
- [x] Create route to serve main dashboard page
- [x] Implement API endpoints for retrieving groups and messages
- [x] Add error handling middleware for web server

### 6. Real-time Updates

- [x] Set up Socket.io server integration with Express
- [x] Create event handlers for broadcasting new messages
- [x] Implement client-side Socket.io connection for real-time updates

### 7. Web Interface

- [x] Build HTML template for main dashboard showing all groups
- [x] Create JavaScript for fetching and displaying messages by group
- [x] Implement real-time message updates in the web interface
- [x] Add basic CSS styling for readable message display

### 8. System Startup & Error Handling

- [x] Create main application entry point that starts all services
- [x] Implement global error handlers for uncaught exceptions
- [x] Add retry logic for failed database operations
- [x] Create fallback mechanisms for WhatsApp connection issues

## API Endpoints

- `GET /api/groups`: Returns list of all groups with message counts
- `GET /api/messages/:groupId`: Returns messages for specific group
- `GET /api/messages`: Returns all messages with pagination

## Project Structure

```
├── src/
│   ├── index.js                  # Main application entry point
│   ├── models/                   # Data models
│   ├── services/
│   │   ├── databaseService.js    # MySQL database operations
│   │   ├── messageProcessor.js   # Message validation and formatting
│   │   └── whatsappClient.js     # WhatsApp Web integration
│   ├── routes/
│   │   └── api.js               # API endpoints
│   └── public/                   # Web interface files
│       ├── index.html           # Main dashboard HTML
│       ├── css/
│       │   └── styles.css       # CSS styling
│       └── js/
│           └── main.js          # Client-side JavaScript
├── .env                          # Environment variables
└── package.json                  # Project dependencies
```


## Troubleshooting

### WhatsApp Connection Issues

- **QR Code Not Scanning**: Make sure your phone has a stable internet connection
- **Authentication Failed**: Delete the WhatsApp session folder and restart the application
- **Client Disconnected**: The system will automatically attempt to reconnect

### Database Connection Issues

- **Connection Refused**: Check your MySQL server is running and credentials are correct
- **Table Not Found**: The application will automatically create tables on startup

### Common Errors

- **TypeError: this.client.getWid is not a function**: This is fixed by using `client.info.wid.user` instead
- **EADDRINUSE**: The port is already in use, change the PORT in .env file

## Performance Optimization

- The system implements connection pooling for database operations
- Message batching is used for high-volume scenarios
- Pagination is implemented for large message sets
- Indexes are created on frequently queried fields

## Development

Run tests:

```bash
npm test
```

Development mode with auto-restart:

```bash
npm run dev
```

## License

ISC