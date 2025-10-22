/**
 * Media API Routes
 * Serves downloaded WhatsApp media files as byte arrays
 */

const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { getServiceLogger } = require('../services/loggingService');

const router = express.Router();
const logger = getServiceLogger('media-api');

/**
 * Serve media files by relative path
 * GET /api/media/file?path=images/filename.jpg
 */
router.get('/file', async (req, res) => {
    try {
        const { path: relativePath } = req.query;
        
        if (!relativePath) {
            return res.status(400).json({
                error: 'Missing path parameter'
            });
        }

        const mediaDirectory = process.env.ATTACHMENT_PATH || './media';
        const filePath = path.join(mediaDirectory, relativePath);
        
        // Security check - ensure file is within media directory
        const resolvedPath = path.resolve(filePath);
        const resolvedMediaDir = path.resolve(mediaDirectory);
        
        if (!resolvedPath.startsWith(resolvedMediaDir)) {
            return res.status(403).json({
                error: 'Access denied'
            });
        }

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch (error) {
            return res.status(404).json({
                error: 'Media file not found'
            });
        }

        // Get file stats and serve
        const stats = await fs.stat(filePath);
        const mimeType = getMimeType(path.basename(filePath));
        
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        
        const fileBuffer = await fs.readFile(filePath);
        res.send(fileBuffer);

    } catch (error) {
        logger.error('Error serving media file by path', {
            error: error.message,
            path: req.query.path
        });
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Serve media files by type and filename
 * GET /api/media/:type/:filename
 */
router.get('/:type/:filename', async (req, res) => {
    try {
        const { type, filename } = req.params;
        const mediaDirectory = process.env.ATTACHMENT_PATH || './media';
        
        // Validate type
        const allowedTypes = ['images', 'videos', 'audio', 'documents'];
        if (!allowedTypes.includes(type)) {
            return res.status(400).json({
                error: 'Invalid media type',
                allowedTypes
            });
        }

        // Construct file path (handle both relative and absolute paths)
        let filePath;
        if (path.isAbsolute(filename)) {
            filePath = filename;
        } else {
            filePath = path.join(mediaDirectory, type, filename);
        }
        
        // Check if file exists
        try {
            await fs.access(filePath);
        } catch (error) {
            logger.warn('Media file not found', {
                filePath,
                type,
                filename
            });
            return res.status(404).json({
                error: 'Media file not found'
            });
        }

        // Get file stats
        const stats = await fs.stat(filePath);
        
        // Determine MIME type
        const mimeType = getMimeType(filename);
        
        // Set appropriate headers
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        // Read and send file as buffer
        const fileBuffer = await fs.readFile(filePath);
        
        logger.debug('Media file served', {
            filename,
            type,
            size: stats.size,
            mimeType
        });

        res.send(fileBuffer);

    } catch (error) {
        logger.error('Error serving media file', {
            error: error.message,
            params: req.params
        });

        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * Get media file info without downloading
 * GET /api/media/:type/:filename/info
 */
router.get('/:type/:filename/info', async (req, res) => {
    try {
        const { type, filename } = req.params;
        const mediaDirectory = process.env.ATTACHMENT_PATH || './media';
        const filePath = path.join(mediaDirectory, type, filename);
        
        // Check if file exists
        try {
            const stats = await fs.stat(filePath);
            const mimeType = getMimeType(filename);
            
            res.json({
                filename,
                type,
                size: stats.size,
                mimeType,
                created: stats.birthtime,
                modified: stats.mtime,
                downloadUrl: `/api/media/${type}/${filename}`
            });
        } catch (error) {
            res.status(404).json({
                error: 'Media file not found'
            });
        }

    } catch (error) {
        logger.error('Error getting media file info', {
            error: error.message,
            params: req.params
        });

        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * List media files by type
 * GET /api/media/:type
 */
router.get('/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const mediaDirectory = process.env.ATTACHMENT_PATH || './media';
        const typeDirectory = path.join(mediaDirectory, type);
        
        // Validate type
        const allowedTypes = ['images', 'videos', 'audio', 'documents'];
        if (!allowedTypes.includes(type)) {
            return res.status(400).json({
                error: 'Invalid media type',
                allowedTypes
            });
        }

        try {
            const files = await fs.readdir(typeDirectory);
            const fileList = [];

            for (const file of files) {
                const filePath = path.join(typeDirectory, file);
                const stats = await fs.stat(filePath);
                
                fileList.push({
                    filename: file,
                    size: stats.size,
                    mimeType: getMimeType(file),
                    created: stats.birthtime,
                    downloadUrl: `/api/media/${type}/${file}`
                });
            }

            res.json({
                type,
                count: fileList.length,
                files: fileList
            });

        } catch (error) {
            res.status(404).json({
                error: 'Media directory not found'
            });
        }

    } catch (error) {
        logger.error('Error listing media files', {
            error: error.message,
            type: req.params.type
        });

        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * Get MIME type from filename
 */
function getMimeType(filename) {
    const ext = path.extname(filename).toLowerCase();
    
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.avi': 'video/avi',
        '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.pdf': 'application/pdf',
        '.doc': 'application/msword',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.txt': 'text/plain'
    };

    return mimeTypes[ext] || 'application/octet-stream';
}

module.exports = router;