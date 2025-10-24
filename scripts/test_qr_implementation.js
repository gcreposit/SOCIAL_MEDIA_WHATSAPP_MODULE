/**
 * Test script to verify QR code implementation
 * This script simulates the API responses to test the frontend behavior
 */

const express = require('express');
const path = require('path');
const app = express();

// Serve static files
app.use(express.static(path.join(__dirname, 'src/public')));

// Mock session states
let currentState = 'logged_out'; // Can be: 'need_scan', 'connected', 'unknown', 'logged_out'
let qrCodeCounter = 0;

// Mock API endpoints for testing
app.get('/api/whatsapp/status', (req, res) => {
    console.log(`[TEST] Status check - Current state: ${currentState}`);
    
    switch (currentState) {
        case 'connected':
            res.json({
                authenticated: true,
                isAuthenticated: true,
                isReady: true,
                status: 'connected',
                architecture: 'wasender',
                sessionId: 25402,
                sessionName: 'matrixSession',
                phoneNumber: '+917275147094',
                sessionInfo: {
                    id: 25402,
                    name: 'matrixSession',
                    phoneNumber: '+917275147094',
                    status: 'connected'
                },
                message: 'Session connected successfully'
            });
            break;
            
        case 'need_scan':
            res.json({
                authenticated: false,
                isAuthenticated: false,
                isReady: false,
                status: 'need_scan',
                architecture: 'wasender',
                sessionId: 25402,
                sessionName: 'matrixSession',
                phoneNumber: '+917275147094',
                sessionInfo: {
                    id: 25402,
                    name: 'matrixSession',
                    phoneNumber: '+917275147094',
                    status: 'need_scan'
                },
                message: 'QR code scan required'
            });
            break;
            
        case 'logged_out':
            res.json({
                authenticated: false,
                isAuthenticated: false,
                isReady: false,
                status: 'need_scan', // Frontend treats logged_out as need_scan
                architecture: 'wasender',
                sessionId: 25402,
                sessionName: 'matrixSession',
                phoneNumber: '+917275147094',
                sessionInfo: {
                    id: 25402,
                    name: 'matrixSession',
                    phoneNumber: '+917275147094',
                    status: 'logged_out',
                    originalStatus: 'logged_out'
                },
                message: 'Session logged out, QR code scan required'
            });
            break;
            
        default: // 'unknown'
            res.json({
                authenticated: false,
                isAuthenticated: false,
                isReady: false,
                status: 'unknown',
                architecture: 'wasender',
                sessionName: 'matrixSession',
                sessionInfo: {
                    name: 'matrixSession'
                },
                message: 'Session status unknown'
            });
    }
});

app.get('/api/whatsapp/qr', (req, res) => {
    qrCodeCounter++;
    console.log(`[TEST] QR code request #${qrCodeCounter}`);
    
    // Simulate the actual QR code string from Wasender
    const qrCodeString = '2@CYKmetLXeYo1s6D6QzfcMYxIex3XIPD7E5vcNW1MWer1rb2uIq6If3fRCVxbiFI/lc50OXeF5tuokQJBKiONGYWMv9Z9EN0Kn7Q=,OEL9gHmMjsuq3FU6kwN7PMzXqSnfIPpAKFcVd/sloD8=,wa6lmmPljZ1Cm6IiHzMejmVWqPREKtp2ToV+gV8VLjM=,xGT7nTQcLa5ZRnZvAzw5EFGcw0/td3Aysxu0XTCysfU=';
    
    // Generate QR code image from string (simulate the backend conversion)
    const QRCode = require('qrcode');
    QRCode.toDataURL(qrCodeString, { width: 300 })
        .then(dataURL => {
            const base64Data = dataURL.split(',')[1];
            
            res.json({
                success: true,
                qrCode: base64Data,
                qrCodeString: qrCodeString,
                sessionId: 25402,
                sessionName: 'matrixSession',
                architecture: 'wasender',
                timestamp: new Date().toISOString(),
                qrCodeTime: new Date().toISOString()
            });
        })
        .catch(error => {
            console.error('Error generating QR code:', error);
            // Fallback to simple placeholder
            const qrCodeBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
            
            res.json({
                success: true,
                qrCode: qrCodeBase64,
                qrCodeString: qrCodeString,
                sessionId: 25402,
                sessionName: 'matrixSession',
                architecture: 'wasender',
                timestamp: new Date().toISOString(),
                qrCodeTime: new Date().toISOString()
            });
        });
});

app.post('/api/wasender/reconnect', (req, res) => {
    console.log('[TEST] Reconnect request received');
    
    res.json({
        success: true,
        message: 'Reconnection initiated successfully',
        sessionId: 25402,
        sessionName: 'matrixSession',
        timestamp: new Date().toISOString(),
        architecture: 'wasender'
    });
});

// Test control endpoints
app.post('/test/set-state/:state', (req, res) => {
    const newState = req.params.state;
    console.log(`[TEST] Changing state from ${currentState} to ${newState}`);
    currentState = newState;
    res.json({ success: true, newState, message: `State changed to ${newState}` });
});

app.get('/test/current-state', (req, res) => {
    res.json({ currentState, qrCodeCounter });
});

// Serve the QR page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'src/public/qr.html'));
});

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`
🧪 QR Code Test Server Running on http://localhost:${PORT}

Test Commands:
- View QR page: http://localhost:${PORT}
- Set to CONNECTED: curl -X POST http://localhost:${PORT}/test/set-state/connected
- Set to NEED_SCAN: curl -X POST http://localhost:${PORT}/test/set-state/need_scan  
- Set to LOGGED_OUT: curl -X POST http://localhost:${PORT}/test/set-state/logged_out
- Set to UNKNOWN: curl -X POST http://localhost:${PORT}/test/set-state/unknown
- Check current state: curl http://localhost:${PORT}/test/current-state

The page will automatically check status 3 times on load and show appropriate UI.
QR codes will auto-refresh every 45 seconds when in NEED_SCAN state.
    `);
});