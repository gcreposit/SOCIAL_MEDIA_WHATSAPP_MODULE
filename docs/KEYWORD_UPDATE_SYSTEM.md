# Keyword Update System

## Overview

The Keyword Update System automatically fetches and updates keyword data from your API every 6 hours, ensuring that the WhatsApp message filtering system always uses the latest crime-related keywords for accurate message filtering.

## Features

### 🔄 Automatic Updates
- **Scheduled Updates**: Runs every 6 hours automatically
- **Smart Change Detection**: Only updates when data actually changes
- **Backup Creation**: Creates backups before each update
- **Service Notification**: Automatically notifies filtering services of updates

### 🛡️ Reliability
- **Retry Logic**: 3 retry attempts with exponential backoff
- **Error Handling**: Comprehensive error handling and logging
- **Health Monitoring**: Continuous health checks and status reporting
- **Graceful Degradation**: Continues working even if API is temporarily unavailable

### 📊 Monitoring
- **Detailed Statistics**: Tracks all operations and performance metrics
- **API Endpoints**: RESTful endpoints for status and manual control
- **Comprehensive Logging**: Detailed logs for troubleshooting

## Configuration

### Environment Variables

Add to your `.env` file:
```bash
# Keyword Update Service Configuration
KEYWORD_API_URL=94.136.189.241:2121/api/data/get-Keywords
```

### API Response Format

The system expects your API to return data in this format:
```json
[
    {
        "id": 31,
        "hindiKeyword": "हत्या, खून, कत्ल, जान से मारना, मार डाला",
        "englishKeyword": "murder, killing, homicide, to kill, killed",
        "hinglishKeyword": "hatya, khoon, katl, jaan se marna, maar dala",
        "broadCategoryName": "CRIME",
        "subCategoryName": "MURDER"
    }
]
```

## API Endpoints

### Get Service Status
```http
GET /api/keywords/status
```

**Response:**
```json
{
    "success": true,
    "status": "healthy",
    "isRunning": true,
    "stats": {
        "totalFetches": 10,
        "successfulFetches": 10,
        "failedFetches": 0,
        "updatesApplied": 3,
        "noChangeSkips": 7,
        "lastSuccessTime": "2025-10-28T12:22:02.000Z",
        "nextUpdateIn": 18000000
    },
    "configuration": {
        "apiUrl": "94.136.189.241:2121/api/data/get-Keywords",
        "updateInterval": "6 hours",
        "currentDataHash": "a13958da"
    },
    "health": {
        "status": "healthy",
        "lastSuccessAge": "5 minutes ago",
        "issues": []
    }
}
```

### Force Manual Update
```http
POST /api/keywords/update
```

**Response:**
```json
{
    "success": true,
    "updated": true,
    "message": "Keywords updated successfully",
    "result": {
        "recordCount": 18,
        "newHash": "a13958da",
        "processingTime": 133,
        "reason": "contains_district_and_keyword"
    }
}
```

### Get Current Configuration
```http
GET /api/keywords/config
```

**Response:**
```json
{
    "success": true,
    "configuration": {
        "englishDistricts": 75,
        "hindiDistricts": 75,
        "hindiKeywords": 151,
        "englishKeywords": 145,
        "hinglishKeywords": 147
    },
    "samples": {
        "englishDistricts": ["Agra", "Aligarh", "Ambedkar Nagar", "Amethi", "Amroha"],
        "hindiDistricts": ["आगरा", "अलीगढ़", "अम्बेडकर नगर", "अमेठी", "अमरोहा"],
        "hindiKeywords": ["हत्या", "खून", "कत्ल", "जान से मारना", "मार डाला"],
        "englishKeywords": ["murder", "killing", "homicide", "to kill", "killed"],
        "hinglishKeywords": ["hatya", "khoon", "katl", "jaan se marna", "maar dala"]
    },
    "filterMetrics": {
        "totalProcessed": 100,
        "passedFilter": 25,
        "failedFilter": 75,
        "passRate": "25.00%",
        "avgProcessingTime": 0.4,
        "dataReloads": 3
    }
}
```

## How It Works

### 1. Scheduled Operation
- Service starts automatically when the application starts
- Runs initial update check immediately
- Schedules subsequent checks every 6 hours

### 2. Change Detection
- Calculates SHA256 hash of keyword data
- Compares with previous hash to detect changes
- Only updates JSON file when changes are detected

### 3. Update Process
1. **Fetch Data**: Retrieves data from your API with retry logic
2. **Validate**: Ensures data structure is correct
3. **Compare**: Checks if data has changed using hash comparison
4. **Backup**: Creates timestamped backup of current file
5. **Update**: Writes new data to JSON file
6. **Notify**: Notifies filtering services to reload data

### 4. Service Integration
- **MessageFilterService**: Automatically reloads data when notified
- **Database Service**: Uses updated keywords for filtering
- **Group Message Monitor**: Applies updated filters in real-time

## File Structure

```
├── src/services/
│   ├── keywordUpdateService.js      # Main update service
│   └── messageFilterService.js      # Enhanced with auto-reload
├── backups/                         # Automatic backups (last 10 kept)
│   └── youtube_matrix_keywords_backup_*.json
├── youtube_matrix_keywords.json     # Current keyword data
├── .keyword_update_notification     # Notification file for services
└── test-keyword-update.js          # Test script
```

## Testing

### Manual Test
```bash
# Test the service functionality
node test-keyword-update.js

# Start service in test mode
node test-keyword-update.js --start-service
```

### Integration Test
```bash
# Test the complete filtering system
node test-integration.js
```

## Monitoring

### Logs
- All operations are logged with detailed information
- Logs include timing, success/failure, and error details
- Log level can be controlled via environment variables

### Health Checks
- Service provides health status via API
- Monitors last successful update time
- Alerts when service is degraded

### Backup Management
- Automatic backup creation before each update
- Keeps last 10 backups (configurable)
- Automatic cleanup of old backups

## Troubleshooting

### Common Issues

1. **API Connection Failed**
   - Check if API URL is correct in `.env`
   - Verify API is accessible from your server
   - Check network connectivity

2. **Service Not Running**
   - Check application logs for startup errors
   - Verify environment variables are set
   - Restart the application

3. **Updates Not Applied**
   - Check if data actually changed on API
   - Verify backup directory permissions
   - Check service health via API endpoint

### Debug Commands

```bash
# Check service status
curl http://localhost:3000/api/keywords/status

# Force manual update
curl -X POST http://localhost:3000/api/keywords/update

# Check current configuration
curl http://localhost:3000/api/keywords/config
```

## Security Considerations

- API endpoint should be secured and rate-limited
- Backup files contain sensitive keyword data
- Service logs may contain API responses
- Consider using HTTPS for API communication

## Performance

- **Update Frequency**: 6 hours (configurable)
- **Processing Time**: ~100-200ms per update
- **Memory Usage**: Minimal (service is stateless)
- **Network Usage**: Only during scheduled updates

## Future Enhancements

- [ ] Webhook support for immediate updates
- [ ] Multiple API source support
- [ ] Custom update schedules per keyword category
- [ ] Real-time filtering performance metrics
- [ ] Integration with monitoring systems (Prometheus, etc.)