# Backend-Only Deployment Guide

This guide provides instructions for deploying the WhatsApp Message Capture System in backend-only mode on a server or VM without frontend requirements.

## Overview

The backend-only mode disables the web server component and runs only the WhatsApp client and database services. This is ideal for:

- Headless servers or VMs
- Environments where a web interface is not needed
- Deployments that will be accessed via API only
- Systems with limited resources

## Requirements

- Node.js (v14 or higher)
- MySQL database
- WhatsApp account for business use
- SSH access to the server (for initial setup)

## Installation

1. Clone the repository and install dependencies

```bash
git clone <repository-url>
cd whatsapp-integration
npm install
```

2. Configure environment variables

```bash
cp .env.example .env
```

Edit the `.env` file with your MySQL database credentials and other settings.

## Running in Backend-Only Mode

Start the application in backend-only mode:

```bash
npm run start:backend
```

Or directly with Node.js:

```bash
node src/index.js --backend-only
```

## Authentication

When running in backend-only mode, the QR code for WhatsApp Web authentication will be displayed in the terminal. You'll need to scan this QR code with your WhatsApp account to authenticate.

If you're running on a remote server without a GUI:

1. Connect to your server via SSH with terminal access
2. Start the application in backend-only mode
3. Scan the QR code displayed in the terminal with your WhatsApp mobile app

## Process Management

For production deployments, it's recommended to use a process manager like PM2:

```bash
# Install PM2
npm install -g pm2

# Start the application with PM2 in backend-only mode
pm2 start --name "whatsapp-capture" -- npm run start:backend

# Set up PM2 to start on system boot
pm2 startup
pm2 save
```

## Graceful Shutdown

The application handles SIGINT and SIGTERM signals for graceful shutdown. When these signals are received, the application will:

1. Disconnect from the WhatsApp client
2. Close the database connection
3. Exit cleanly

This ensures that no data is lost when the application is stopped.

## Logs

All logs are output to the console. When using PM2, you can view logs with:

```bash
pm2 logs whatsapp-capture
```

For more advanced logging, consider configuring a logging service or redirecting output to a log file.

## Troubleshooting

### Authentication Issues

If you encounter issues with the QR code authentication:

1. Ensure your WhatsApp account is active and connected to the internet
2. Try clearing the session by removing the `.wwebjs_auth` directory
3. Restart the application

### Group Initialization Issues

If the application is not finding any WhatsApp groups:

1. The application now includes a robust group initialization system with multiple retry attempts
2. Groups will be automatically retried every 5 minutes if none are found initially
3. Wait at least 5-10 minutes after authentication for the WhatsApp Web client to fully synchronize
4. Check that your WhatsApp account is a member of at least one group
5. If groups still don't appear, try restarting the application

### Connection Issues

If the WhatsApp client disconnects frequently:

1. Check your server's internet connection
2. Ensure your WhatsApp account is not logged in on too many devices
3. Verify that your server has stable network connectivity

## Security Considerations

1. Use a dedicated WhatsApp account for this application
2. Secure your server with appropriate firewall rules
3. Keep your Node.js and npm packages updated
4. Use environment variables for sensitive information
5. Consider running the application in a container or with limited user privileges