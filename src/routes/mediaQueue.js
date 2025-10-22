/**
 * Media Queue API Routes
 * Provides endpoints to monitor and manage the media processing queue
 */

const express = require('express');
const { getServiceLogger } = require('../services/loggingService');

const router = express.Router();
const logger = getServiceLogger('media-queue-api');

/**
 * Get queue statistics
 * GET /api/queue/stats
 */
router.get('/stats', (req, res) => {
    try {
        const databaseService = req.app.get('databaseService');
        
        if (!databaseService || !databaseService.mediaQueueService) {
            return res.status(503).json({
                error: 'Media queue service not available'
            });
        }

        const stats = databaseService.mediaQueueService.getStats();
        
        res.json({
            success: true,
            stats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error getting queue stats', {
            error: error.message
        });

        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * Get job status
 * GET /api/queue/job/:jobId
 */
router.get('/job/:jobId', (req, res) => {
    try {
        const { jobId } = req.params;
        const databaseService = req.app.get('databaseService');
        
        if (!databaseService || !databaseService.mediaQueueService) {
            return res.status(503).json({
                error: 'Media queue service not available'
            });
        }

        const job = databaseService.mediaQueueService.getJobStatus(jobId);
        
        if (!job) {
            return res.status(404).json({
                error: 'Job not found'
            });
        }

        res.json({
            success: true,
            job: {
                id: job.id,
                status: job.status,
                messageId: job.messageId,
                mediaType: job.mediaType,
                priority: job.priority,
                retryCount: job.retryCount,
                createdAt: job.createdAt,
                startedAt: job.startedAt,
                completedAt: job.completedAt,
                failedAt: job.failedAt,
                lastError: job.lastError
            }
        });

    } catch (error) {
        logger.error('Error getting job status', {
            error: error.message,
            jobId: req.params.jobId
        });

        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

/**
 * Get queue health status
 * GET /api/queue/health
 */
router.get('/health', (req, res) => {
    try {
        const databaseService = req.app.get('databaseService');
        
        if (!databaseService || !databaseService.mediaQueueService) {
            return res.status(503).json({
                healthy: false,
                error: 'Media queue service not available'
            });
        }

        const stats = databaseService.mediaQueueService.getStats();
        
        // Determine health based on queue metrics
        const isHealthy = stats.currentlyProcessing < 50 && stats.queueLength < 1000;
        const status = isHealthy ? 'healthy' : 'degraded';
        
        res.json({
            healthy: isHealthy,
            status,
            stats: {
                queueLength: stats.queueLength,
                processing: stats.currentlyProcessing,
                completed: stats.completedJobs,
                failed: stats.failedJobs
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error checking queue health', {
            error: error.message
        });

        res.status(500).json({
            healthy: false,
            error: 'Internal server error'
        });
    }
});

/**
 * Get detailed queue information
 * GET /api/queue/info
 */
router.get('/info', (req, res) => {
    try {
        const databaseService = req.app.get('databaseService');
        
        if (!databaseService || !databaseService.mediaQueueService) {
            return res.status(503).json({
                error: 'Media queue service not available'
            });
        }

        const queueService = databaseService.mediaQueueService;
        const stats = queueService.getStats();
        
        res.json({
            success: true,
            info: {
                configuration: {
                    maxConcurrentJobs: queueService.maxConcurrentJobs,
                    maxRetries: queueService.maxRetries,
                    retryDelay: queueService.retryDelay,
                    jobTimeout: queueService.jobTimeout
                },
                statistics: stats,
                status: queueService.isRunning ? 'running' : 'stopped'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error getting queue info', {
            error: error.message
        });

        res.status(500).json({
            error: 'Internal server error'
        });
    }
});

module.exports = router;