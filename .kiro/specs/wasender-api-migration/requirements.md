# Requirements Document

## Introduction

This document outlines the requirements for migrating the WhatsApp Message Capture System from whatsapp-web.js to Wasender API architecture. The system will focus exclusively on monitoring and capturing group messages from WhatsApp groups where the authenticated user is a member.

## Glossary

- **Wasender_API**: Cloud-based WhatsApp API service that provides webhook-based message processing
- **Group_Message_Monitor**: System component that captures and processes messages from WhatsApp groups only
- **Webhook_Handler**: Service that receives and processes incoming webhook events from Wasender API
- **Media_Decryption_Service**: Component that decrypts and stores WhatsApp media files (images, videos, documents, audio)
- **Database_Service**: Service that manages data persistence using PostBank, CommonAttachment, and PostUser models
- **Session_Manager**: Component that manages WhatsApp session authentication via Wasender API
- **Ngrok_Tunnel**: Local tunnel service that exposes webhook endpoint for development

## Requirements

### Requirement 1

**User Story:** As a system administrator, I want to migrate from whatsapp-web.js to Wasender API, so that I can eliminate browser dependencies and improve system reliability.

#### Acceptance Criteria

1. WHEN the system starts, THE Wasender_API SHALL establish a WhatsApp session using API credentials
2. WHEN session authentication is required, THE Session_Manager SHALL display QR code via Wasender API endpoints
3. WHEN the old whatsapp-web.js client is running, THE System SHALL gracefully shut down the old client before starting Wasender integration
4. WHEN migration is complete, THE System SHALL remove all Puppeteer and browser-related dependencies
5. WHEN the new system is operational, THE System SHALL achieve 99.9% uptime compared to current 95%

### Requirement 2

**User Story:** As a monitoring system, I want to capture only group messages, so that I can focus on group communications and ignore personal messages.

#### Acceptance Criteria

1. WHEN a message is received via webhook, THE Group_Message_Monitor SHALL verify the message originates from a WhatsApp group
2. WHEN a personal message is received, THE System SHALL ignore and not process the message
3. WHEN a group message is received, THE Database_Service SHALL store the message in PostBank table with source="whatsapp"
4. WHEN group metadata is available, THE System SHALL store group information including group ID and group name
5. WHEN user information is available, THE Database_Service SHALL store sender details in PostUser table

### Requirement 3

**User Story:** As a webhook receiver, I want to process incoming Wasender API webhooks, so that I can capture messages in real-time.

#### Acceptance Criteria

1. WHEN Wasender API sends a webhook, THE Webhook_Handler SHALL verify webhook signature for security
2. WHEN a "messages.upsert" event is received, THE System SHALL process new group messages
3. WHEN a "messages.update" event is received, THE System SHALL update message status if applicable
4. WHEN webhook processing fails, THE System SHALL log detailed error information and continue operation
5. WHEN webhook endpoint is not accessible, THE Ngrok_Tunnel SHALL provide public URL for local development

### Requirement 4

**User Story:** As a media processor, I want to decrypt and store WhatsApp media files, so that I can preserve complete message content including attachments.

#### Acceptance Criteria

1. WHEN a group message contains media, THE Media_Decryption_Service SHALL decrypt the media using Wasender API
2. WHEN media is decrypted successfully, THE System SHALL store file path in CommonAttachment table
3. WHEN media decryption fails, THE System SHALL log error details and mark attachment status as failed
4. WHEN multiple media files are in one message, THE System SHALL process each attachment separately
5. WHEN reply messages contain attachments, THE System SHALL avoid duplicate file storage

### Requirement 5

**User Story:** As a database manager, I want to use the new data models, so that I can store WhatsApp data in a structured format compatible with other platforms.

#### Acceptance Criteria

1. WHEN storing a group message, THE Database_Service SHALL use PostBank model with WhatsApp-specific fields
2. WHEN storing user information, THE Database_Service SHALL use PostUser model with platform="whatsapp"
3. WHEN storing attachments, THE Database_Service SHALL use CommonAttachment model with proper foreign key relationships
4. WHEN duplicate messages are received, THE System SHALL prevent duplicate storage using unique message identifiers
5. WHEN database operations fail, THE System SHALL implement retry logic and error handling

### Requirement 6

**User Story:** As a system operator, I want comprehensive logging, so that I can monitor system health and troubleshoot issues effectively.

#### Acceptance Criteria

1. WHEN any service operation occurs, THE System SHALL log operation details with timestamp and service name
2. WHEN webhook events are received, THE System SHALL log event type, payload size, and processing status
3. WHEN API calls are made to Wasender, THE System SHALL log request/response details and response times
4. WHEN errors occur, THE System SHALL log stack traces and context information for debugging
5. WHEN system performance metrics are available, THE System SHALL log processing times and success rates

### Requirement 7

**User Story:** As a development environment, I want to use ngrok for webhook testing, so that I can receive webhooks locally during development.

#### Acceptance Criteria

1. WHEN development mode is enabled, THE Ngrok_Tunnel SHALL create a public HTTPS URL
2. WHEN ngrok tunnel is established, THE System SHALL automatically update Wasender webhook URL configuration
3. WHEN ngrok connection fails, THE System SHALL retry connection and log failure details
4. WHEN switching between development and production, THE System SHALL use appropriate webhook URLs
5. WHEN ngrok session expires, THE System SHALL detect disconnection and re-establish tunnel

### Requirement 8

**User Story:** As a session manager, I want to maintain WhatsApp authentication, so that I can ensure continuous message monitoring without manual intervention.

#### Acceptance Criteria

1. WHEN WhatsApp session is disconnected, THE Session_Manager SHALL attempt automatic reconnection
2. WHEN QR code authentication is required, THE System SHALL provide QR code via API endpoint for web interface
3. WHEN session expires, THE System SHALL notify administrators and provide re-authentication options
4. WHEN session is active, THE System SHALL monitor session health and report status
5. WHEN multiple sessions are needed, THE System SHALL support session management for different phone numbers