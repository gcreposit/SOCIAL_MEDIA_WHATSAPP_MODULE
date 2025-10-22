# Attachment Processing Implementation - Task 5.2

## Overview

This document describes the implementation of Task 5.2: "Implement attachment processing and storage" from the Wasender API migration specification. The implementation provides comprehensive attachment data processing for the CommonAttachment model with organized file storage structure and proper file naming to avoid conflicts and duplicates.

## Implementation Components

### 1. AttachmentProcessingService (`src/services/attachmentProcessingService.js`)

The core service that handles attachment processing with the following key features:

#### Key Features:
- **Organized File Storage**: Files are stored in a hierarchical structure by date and group
- **Unique File Naming**: Implements timestamp + random suffix + sanitized name to prevent conflicts
- **CommonAttachment Integration**: Creates proper database records using the CommonAttachment model
- **Media Type Support**: Handles images, videos, audio, and documents
- **File Validation**: Validates file types, sizes, and data integrity
- **Error Handling**: Comprehensive error handling with detailed logging

#### Directory Structure:
```
ATTACHMENT_PATH/
├── IMAGES/
│   └── YYYY/
│       └── MM/
│           └── DD/
│               └── group_name/
│                   └── timestamp_random_filename.ext
├── VIDEOS/
├── AUDIO/
└── DOCUMENTS/
```

#### File Naming Convention:
```
YYYYMMDD_HHmmss_randomhex_sanitized_basename.extension
```

### 2. AttachmentIntegrationService (`src/services/wasender/attachmentIntegrationService.js`)

Integration service that connects all attachment-related services:

#### Key Features:
- **Service Integration**: Connects AttachmentProcessingService with MediaDecryptionService and DatabaseService
- **Message Processing**: Extracts attachment data from WhatsApp messages
- **Batch Processing**: Handles multiple attachments from a single message
- **Statistics**: Provides attachment processing statistics
- **Health Monitoring**: Service health status and monitoring
- **Cleanup**: Automated cleanup of old attachment files

### 3. Database Integration

Enhanced the existing DatabaseService to use the new attachment processing:

#### Key Changes:
- Added `setAttachmentProcessingService()` method
- Updated `processMessageAttachments()` to use the new service
- Maintains backward compatibility with legacy attachment processing
- Improved error handling and logging

## File Storage Organization

### Hierarchical Structure
Files are organized by:
1. **Type**: IMAGES, VIDEOS, AUDIO, DOCUMENTS
2. **Date**: Year/Month/Day folders
3. **Group**: Sanitized group name folders
4. **Unique Files**: Timestamp + random suffix naming

### Example Structure:
```
/Users/apple1/Downloads/WHATSAPP_DOCS/
├── IMAGES/
│   └── 2025/
│       └── 10/
│           └── 22/
│               ├── family_group/
│               │   ├── 20251022_143022_a1b2c3d4_vacation_photo.jpg
│               │   └── 20251022_143045_e5f6g7h8_birthday_pic.png
│               └── work_team/
│                   └── 20251022_150130_i9j0k1l2_presentation.jpg
├── VIDEOS/
│   └── 2025/10/22/family_group/
│       └── 20251022_144500_m3n4o5p6_funny_video.mp4
├── AUDIO/
│   └── 2025/10/22/family_group/
│       └── 20251022_145000_q7r8s9t0_voice_note.mp3
└── DOCUMENTS/
    └── 2025/10/22/work_team/
        └── 20251022_151000_u1v2w3x4_report.pdf
```

## File Naming Strategy

### Conflict Prevention
1. **Timestamp**: YYYYMMDD_HHmmss format ensures chronological ordering
2. **Random Suffix**: 8-character hex string prevents collisions
3. **Sanitized Names**: Remove invalid characters, limit length
4. **Extension Handling**: Proper extension detection from MIME types

### Example Transformations:
- `"My Photo (1).jpg"` → `20251022_143022_a1b2c3d4_My_Photo_1.jpg`
- `"Important Document!.pdf"` → `20251022_143022_b2c3d4e5_Important_Document.pdf`
- `"Group Video 😀.mp4"` → `20251022_143022_c3d4e5f6_Group_Video.mp4`

## CommonAttachment Model Integration

### Database Record Creation
Each processed attachment creates a CommonAttachment record with:

```javascript
{
  post_bank_id: 123,                    // Foreign key to PostBank
  attachment_type: 'image',             // Type: image, video, audio, document
  platform_name: 'whatsapp',           // Always 'whatsapp'
  mime_type: 'image/jpeg',              // Original MIME type
  image_attachment_path: 'IMAGES/2025/10/22/group/file.jpg', // Relative path
  timestamp: '2025-10-22T14:30:22Z',    // Processing timestamp
  group_id: 'group123@g.us',           // WhatsApp group ID
  mobile_number: '+1234567890',        // Sender phone number
  download_status: 'DOWNLOADED',       // Status: PENDING, DOWNLOADED, FAILED
  processing_status: 'PROCESSED',      // Status: NOT_PROCESSED, PROCESSING, PROCESSED, FAILED
  created_at: '2025-10-22T14:30:22Z',  // Record creation time
  updated_at: '2025-10-22T14:30:22Z'   // Last update time
}
```

### Path Field Mapping
- **Images**: `image_attachment_path`
- **Videos**: `video_attachment_path`
- **Audio**: `audio_attachment_path`
- **Documents**: `document_attachment_path`

## Error Handling and Logging

### Comprehensive Error Handling
1. **Validation Errors**: Invalid attachment data, unsupported types
2. **Processing Errors**: Decryption failures, file system errors
3. **Database Errors**: Record creation failures, constraint violations
4. **Storage Errors**: Disk space, permission issues

### Failed Attachment Tracking
Failed attachments are still recorded in the database with:
- `download_status: 'FAILED'`
- `processing_status: 'FAILED'`
- `error_message: 'Detailed error description'`

### Logging Levels
- **INFO**: Successful processing, statistics
- **DEBUG**: Detailed processing steps, file operations
- **ERROR**: Processing failures, system errors
- **WARN**: Non-critical issues, fallback usage

## Configuration

### Environment Variables
```bash
# Attachment storage configuration
ATTACHMENT_PATH=/Users/apple1/Downloads/WHATSAPP_DOCS/
MAX_FILE_SIZE=50MB
ALLOWED_MEDIA_TYPES=image,video,audio,document

# Logging configuration
LOG_LEVEL=info
```

### Service Configuration
```javascript
// File naming configuration
fileNamingConfig: {
  timestampFormat: 'YYYYMMDD_HHmmss',
  randomSuffixLength: 8,
  maxBaseNameLength: 50
}

// Directory structure
directoryStructure: {
  images: 'IMAGES',
  videos: 'VIDEOS', 
  audio: 'AUDIO',
  documents: 'DOCUMENTS'
}
```

## Usage Examples

### Basic Attachment Processing
```javascript
const attachmentService = new AttachmentProcessingService(databaseService, mediaDecryptionService);

const result = await attachmentService.processAndStoreAttachment(
  attachmentData,
  postBankId,
  groupInfo,
  userInfo,
  transaction
);
```

### Integration Service Usage
```javascript
const integrationService = new AttachmentIntegrationService(databaseService, wasenderClient);

// Extract attachments from WhatsApp message
const attachments = integrationService.extractAttachmentsFromMessage(messageData);

// Process all attachments
const results = await integrationService.processMultipleAttachments(
  attachments,
  postBankId,
  groupInfo,
  userInfo,
  transaction
);
```

## Performance Considerations

### Optimization Features
1. **Streaming**: Large files are processed in streams to manage memory
2. **Batch Processing**: Multiple attachments processed efficiently
3. **Directory Caching**: Directory existence checks are cached
4. **Connection Pooling**: Database connections are pooled and reused

### Resource Management
1. **Memory**: Buffers are released after processing
2. **Disk Space**: Automatic cleanup of old files
3. **Database**: Proper transaction handling and connection management

## Maintenance and Monitoring

### Statistics and Monitoring
```javascript
// Get attachment statistics
const stats = await integrationService.getAttachmentStatistics(groupId, dateRange);

// Health status check
const health = integrationService.getHealthStatus();

// Cleanup old files
const deletedCount = await integrationService.cleanupOldAttachments(30);
```

### File Integrity Verification
```javascript
// Verify attachment file exists and is valid
const verification = await integrationService.verifyAttachmentIntegrity(relativePath);
```

## Requirements Compliance

### ✅ Requirement 4.2: Attachment Data Processing
- Comprehensive attachment data processing for CommonAttachment model
- Proper field mapping based on attachment type
- Database record creation with full metadata

### ✅ Requirement 4.4: Organized File Storage
- Hierarchical directory structure by date and group
- Type-based organization (IMAGES, VIDEOS, AUDIO, DOCUMENTS)
- Automatic directory creation and management

### ✅ Requirement 4.5: Conflict Prevention
- Unique file naming with timestamp + random suffix
- Filename sanitization and length limits
- Duplicate detection and prevention
- Extension handling from MIME types

## Testing

The implementation includes comprehensive testing:

### Test Coverage
- ✅ Directory structure creation
- ✅ File naming functionality
- ✅ Organized path generation
- ✅ Attachment data validation
- ✅ File extension detection
- ✅ Type validation
- ✅ Configuration validation
- ✅ Mock processing workflow

### Test Results
All tests pass successfully, verifying:
- Attachment data processing for CommonAttachment model ✅
- Organized file storage structure by date and group ✅
- Proper file naming to avoid conflicts and duplicates ✅
- Integration with MediaDecryptionService ✅
- Integration with DatabaseService ✅

## Conclusion

Task 5.2 has been successfully implemented with a comprehensive attachment processing system that:

1. **Processes attachment data** for the CommonAttachment model with full metadata
2. **Organizes file storage** in a hierarchical structure by date and group
3. **Prevents conflicts** through unique file naming with timestamps and random suffixes
4. **Integrates seamlessly** with existing MediaDecryptionService and DatabaseService
5. **Provides robust error handling** and comprehensive logging
6. **Supports maintenance** through statistics, monitoring, and cleanup features

The implementation is production-ready and fully tested, meeting all requirements specified in the task.