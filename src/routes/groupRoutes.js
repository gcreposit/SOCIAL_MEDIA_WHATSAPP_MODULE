const express = require('express');
const axios = require('axios');
const router = express.Router();

// Rate limiting storage (in production, use Redis or database)
const rateLimitStore = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60000; // 1 minute

// Rate limiting middleware
function rateLimit(req, res, next) {
    const clientId = req.ip;
    const now = Date.now();

    if (!rateLimitStore.has(clientId)) {
        rateLimitStore.set(clientId, { count: 0, resetTime: now + RATE_WINDOW });
    }

    const clientData = rateLimitStore.get(clientId);

    // Reset if window has passed
    if (now > clientData.resetTime) {
        clientData.count = 0;
        clientData.resetTime = now + RATE_WINDOW;
    }

    if (clientData.count >= RATE_LIMIT) {
        return res.status(429).json({
            success: false,
            message: 'Rate limit exceeded. Maximum 5 requests per minute allowed.',
            resetTime: clientData.resetTime
        });
    }

    clientData.count++;
    next();
}

// Get groups from database
router.get('/database', async (req, res) => {
    try {
        const databaseService = req.app.get('databaseService');

        if (!databaseService || !databaseService.sequelize) {
            return res.status(503).json({
                success: false,
                message: 'Database service not available'
            });
        }

        // Create table if it doesn't exist
        await databaseService.sequelize.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_group_names (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                group_name VARCHAR(255) NOT NULL,
                group_id VARCHAR(100) NOT NULL UNIQUE,
                img_url TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);



        // Fetch groups
        const [groups] = await databaseService.sequelize.query(`
            SELECT * FROM whatsapp_group_names 
            ORDER BY created_at DESC
        `);

        res.json({
            success: true,
            data: groups,
            count: groups.length
        });
    } catch (error) {
        console.error('Error fetching groups from database:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch groups from database',
            error: error.message
        });
    }
});

// Fetch groups from API and save to database
router.get('/fetch-from-api', rateLimit, async (req, res) => {
    try {
        const databaseService = req.app.get('databaseService');

        if (!databaseService || !databaseService.sequelize) {
            return res.status(503).json({
                success: false,
                message: 'Database service not available'
            });
        }

        console.log('Fetching groups from Wasender API...');

        // Check if API key is available
        if (!process.env.WASENDER_API_KEY) {
            throw new Error('WASENDER_API_KEY environment variable is required');
        }

        // Get Wasender base URL
        const wasenderBaseUrl = process.env.WASENDER_BASE_URL || 'https://wasenderapi.com';

        // Fetch from Wasender API
        const apiResponse = await axios.get(`${wasenderBaseUrl}/api/groups`, {
            timeout: 10000,
            headers: {
                'User-Agent': 'WhatsApp-Groups-Manager/1.0',
                'Authorization': `Bearer ${process.env.WASENDER_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!apiResponse.data || !apiResponse.data.success) {
            throw new Error('Invalid API response format');
        }

        const apiGroups = apiResponse.data.data || [];
        console.log(`Received ${apiGroups.length} groups from API`);

        // Create table if it doesn't exist
        await databaseService.sequelize.query(`
            CREATE TABLE IF NOT EXISTS whatsapp_group_names (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                group_name VARCHAR(255) NOT NULL,
                group_id VARCHAR(100) NOT NULL UNIQUE,
                img_url TEXT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Save to database (upsert - update if exists, create if not)
        const savedGroups = [];
        for (const group of apiGroups) {
            try {
                await databaseService.sequelize.query(`
                    INSERT INTO whatsapp_group_names (group_name, group_id, img_url)
                    VALUES (?, ?, ?)
                    ON DUPLICATE KEY UPDATE 
                        group_name = VALUES(group_name),
                        img_url = VALUES(img_url),
                        updated_at = CURRENT_TIMESTAMP
                `, {
                    replacements: [
                        group.name || 'Unknown Group',
                        group.id,
                        group.imgUrl || null
                    ]
                });

                savedGroups.push(group);
                console.log(`Saved group: ${group.name}`);
            } catch (dbError) {
                console.error(`Error saving group ${group.id}:`, dbError.message);
                // Continue with other groups even if one fails
            }
        }

        res.json({
            success: true,
            data: apiGroups,
            count: apiGroups.length,
            savedCount: savedGroups.length,
            message: `Successfully fetched ${apiGroups.length} groups and saved ${savedGroups.length} to database`
        });

    } catch (error) {
        console.error('Error fetching groups from API:', error);

        let errorMessage = 'Failed to fetch groups from API';
        if (error.code === 'ECONNABORTED') {
            errorMessage = 'API request timeout. Please try again.';
        } else if (error.response) {
            if (error.response.status === 401) {
                errorMessage = 'Authentication failed. Please check your WASENDER_API_KEY.';
            } else if (error.response.status === 403) {
                errorMessage = 'Access forbidden. Please verify your API permissions.';
            } else {
                errorMessage = `API Error: ${error.response.status} - ${error.response.statusText}`;
            }
        } else if (error.request) {
            errorMessage = 'Network error. Please check your connection.';
        } else if (error.message.includes('WASENDER_API_KEY')) {
            errorMessage = 'WASENDER_API_KEY environment variable is not set.';
        }

        res.status(500).json({
            success: false,
            message: errorMessage,
            error: error.message
        });
    }
});

// Get rate limit status
router.get('/rate-limit-status', (req, res) => {
    const clientId = req.ip;
    const now = Date.now();

    if (!rateLimitStore.has(clientId)) {
        return res.json({
            requestsLeft: RATE_LIMIT,
            resetTime: now + RATE_WINDOW
        });
    }

    const clientData = rateLimitStore.get(clientId);

    // Reset if window has passed
    if (now > clientData.resetTime) {
        clientData.count = 0;
        clientData.resetTime = now + RATE_WINDOW;
    }

    res.json({
        requestsLeft: Math.max(0, RATE_LIMIT - clientData.count),
        resetTime: clientData.resetTime
    });
});

// Delete a group from database
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const databaseService = req.app.get('databaseService');

        if (!databaseService || !databaseService.sequelize) {
            return res.status(503).json({
                success: false,
                message: 'Database service not available'
            });
        }

        const [result] = await databaseService.sequelize.query(`
            DELETE FROM whatsapp_group_names WHERE id = ?
        `, {
            replacements: [id]
        });

        if (result.affectedRows > 0) {
            res.json({
                success: true,
                message: 'Group deleted successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                message: 'Group not found'
            });
        }
    } catch (error) {
        console.error('Error deleting group:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete group',
            error: error.message
        });
    }
});

// Clear all groups from database
router.delete('/clear/all', async (req, res) => {
    try {
        const databaseService = req.app.get('databaseService');

        if (!databaseService || !databaseService.sequelize) {
            return res.status(503).json({
                success: false,
                message: 'Database service not available'
            });
        }

        const [result] = await databaseService.sequelize.query(`
            DELETE FROM whatsapp_group_names
        `);

        res.json({
            success: true,
            message: 'All groups cleared from database',
            deletedCount: result.affectedRows || 0
        });
    } catch (error) {
        console.error('Error clearing groups:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to clear groups',
            error: error.message
        });
    }
});

module.exports = router;