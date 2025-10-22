/**
 * Media Queue Service
 * Handles media decryption and download in a queue-based system for production resilience
 * Supports high-volume media processing from multiple districts without Redis dependency
 */

const EventEmitter = require('events');
const { getServiceLogger } = require('./loggingService');

class MediaQueueService extends EventEmitter {
    constructor(mediaDownloadService, databaseService) {
        super();
        this.mediaDownloadService = mediaDownloadService;
        this.databaseService = databaseService;
        this.logger = getServiceLogger('media-queue');
        
        // Queue configuration
        this.queue = [];
        this.processing = new Map(); // Track currently processing items
        this.completed = new Map(); // Track completed items
        this.failed = new Map(); // Track failed items
        
        // Configuration
        this.maxConcurrentJobs = parseInt(process.env.MEDIA_QUEUE_CONCURRENT_JOBS) || 5;
        this.maxRetries = parseInt(process.env.MEDIA_QUEUE_MAX_RETRIES) || 3;
        this.retryDelay = parseInt(process.env.MEDIA_QUEUE_RETRY_DELAY) || 5000; // 5 seconds
        this.jobTimeout = parseInt(process.env.MEDIA_QUEUE_JOB_TIMEOUT) || 300000; // 5 minutes
        
        // Statistics
        this.stats = {
            totalJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            currentlyProcessing: 0,
            queueLength: 0
        };
        
        // Start processing
        this.isRunning = false;
        this.startProcessing();
        
        this.logger.info('MediaQueueService initialized', {
            maxConcurrentJobs: this.maxConcurrentJobs,
            maxRetries: this.maxRetries,
            jobTimeout: this.jobTimeout
        });
    }

    /**
     * Add media job to queue
     * @param {Object} jobData - Media job data
     * @returns {Promise<string>} Job ID
     */
    async addMediaJob(jobData) {
        const jobId = this.generateJobId();
        const job = {
            id: jobId,
            ...jobData,
            status: 'queued',
            createdAt: new Date(),
            retryCount: 0,
            priority: jobData.priority || 5 // 1 = highest, 10 = lowest
        };

        // Add to queue with priority sorting
        this.queue.push(job);
        this.queue.sort((a, b) => a.priority - b.priority);
        
        this.stats.totalJobs++;
        this.stats.queueLength = this.queue.length;
        
        this.logger.info('Media job added to queue', {
            jobId,
            messageId: jobData.messageId,
            mediaType: jobData.mediaType,
            queuePosition: this.queue.length,
            priority: job.priority
        });

        // Emit event for monitoring
        this.emit('jobAdded', job);
        
        return jobId;
    }

    /**
     * Start queue processing
     */
    startProcessing() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.logger.info('Starting media queue processing');
        
        // Start multiple workers
        for (let i = 0; i < this.maxConcurrentJobs; i++) {
            this.processNextJob();
        }
        
        // Start cleanup interval
        this.startCleanupInterval();
    }

    /**
     * Process next job in queue
     */
    async processNextJob() {
        if (!this.isRunning) return;

        try {
            // Get next job from queue
            const job = this.queue.shift();
            
            if (!job) {
                // No jobs available, wait and try again
                setTimeout(() => this.processNextJob(), 1000);
                return;
            }

            this.stats.queueLength = this.queue.length;
            this.stats.currentlyProcessing++;
            
            // Move job to processing
            job.status = 'processing';
            job.startedAt = new Date();
            this.processing.set(job.id, job);
            
            this.logger.info('Processing media job', {
                jobId: job.id,
                messageId: job.messageId,
                mediaType: job.mediaType,
                attempt: job.retryCount + 1
            });

            // Set job timeout
            const timeoutId = setTimeout(() => {
                this.handleJobTimeout(job.id);
            }, this.jobTimeout);

            try {
                // Process the media
                const result = await this.processMediaJob(job);
                
                // Clear timeout
                clearTimeout(timeoutId);
                
                if (result.success) {
                    await this.handleJobSuccess(job, result);
                } else {
                    await this.handleJobFailure(job, result.error);
                }
                
            } catch (error) {
                clearTimeout(timeoutId);
                await this.handleJobFailure(job, error.message);
            }

        } catch (error) {
            this.logger.error('Error in processNextJob', {
                error: error.message
            });
        }

        // Continue processing
        setTimeout(() => this.processNextJob(), 100);
    }

    /**
     * Process individual media job
     * @param {Object} job - Job data
     * @returns {Promise<Object>} Processing result
     */
    async processMediaJob(job) {
        try {
            // Step 1: Decrypt and download media
            const downloadResult = await this.mediaDownloadService.decryptAndDownloadMedia(
                job.messageData,
                job.messageId
            );

            if (!downloadResult.success) {
                return {
                    success: false,
                    error: downloadResult.error
                };
            }

            // Step 2: Update database with media path
            await this.updateDatabaseWithMediaPath(job, downloadResult);

            return {
                success: true,
                result: downloadResult
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Update database with media path
     * @param {Object} job - Job data
     * @param {Object} downloadResult - Download result
     */
    async updateDatabaseWithMediaPath(job, downloadResult) {
        try {
            // Update CommonAttachment record with local path
            const updateData = {};
            
            switch (job.mediaType) {
                case 'image':
                case 'sticker':
                    updateData.image_attachment_path = downloadResult.relativePath;
                    break;
                case 'video':
                    updateData.video_attachment_path = downloadResult.relativePath;
                    break;
                case 'audio':
                    updateData.audio_attachment_path = downloadResult.relativePath;
                    break;
                case 'document':
                    updateData.document_attachment_path = downloadResult.relativePath;
                    break;
            }

            updateData.download_status = 'DOWNLOADED';
            updateData.processing_status = 'PROCESSED';
            updateData.updated_at = new Date();

            // Update the attachment record
            await this.databaseService.models.CommonAttachment.update(
                updateData,
                {
                    where: {
                        post_bank_id: job.postBankId,
                        attachment_type: job.mediaType
                    }
                }
            );

            this.logger.info('Database updated with media path', {
                jobId: job.id,
                postBankId: job.postBankId,
                relativePath: downloadResult.relativePath
            });

        } catch (error) {
            this.logger.error('Failed to update database with media path', {
                jobId: job.id,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Handle successful job completion
     */
    async handleJobSuccess(job, result) {
        // Remove from processing
        this.processing.delete(job.id);
        
        // Add to completed
        job.status = 'completed';
        job.completedAt = new Date();
        job.result = result;
        this.completed.set(job.id, job);
        
        // Update stats
        this.stats.completedJobs++;
        this.stats.currentlyProcessing--;
        
        this.logger.info('Media job completed successfully', {
            jobId: job.id,
            messageId: job.messageId,
            mediaType: job.mediaType,
            processingTime: job.completedAt - job.startedAt
        });

        // Emit success event
        this.emit('jobCompleted', job);
    }

    /**
     * Handle job failure
     */
    async handleJobFailure(job, error) {
        // Remove from processing
        this.processing.delete(job.id);
        
        job.retryCount++;
        job.lastError = error;
        
        // Check if we should retry
        if (job.retryCount < this.maxRetries) {
            // Add back to queue for retry
            job.status = 'queued';
            job.priority += 1; // Lower priority for retries
            
            setTimeout(() => {
                this.queue.push(job);
                this.queue.sort((a, b) => a.priority - b.priority);
                this.stats.queueLength = this.queue.length;
            }, this.retryDelay);
            
            this.logger.warn('Media job failed, will retry', {
                jobId: job.id,
                messageId: job.messageId,
                error,
                retryCount: job.retryCount,
                maxRetries: this.maxRetries
            });
            
        } else {
            // Max retries reached, mark as failed
            job.status = 'failed';
            job.failedAt = new Date();
            this.failed.set(job.id, job);
            
            this.stats.failedJobs++;
            
            this.logger.error('Media job failed permanently', {
                jobId: job.id,
                messageId: job.messageId,
                error,
                retryCount: job.retryCount
            });

            // Emit failure event
            this.emit('jobFailed', job);
        }
        
        this.stats.currentlyProcessing--;
    }

    /**
     * Handle job timeout
     */
    async handleJobTimeout(jobId) {
        const job = this.processing.get(jobId);
        if (!job) return;
        
        this.logger.warn('Media job timed out', {
            jobId,
            messageId: job.messageId,
            processingTime: Date.now() - job.startedAt
        });

        await this.handleJobFailure(job, 'Job timeout');
    }

    /**
     * Get job status
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job status
     */
    getJobStatus(jobId) {
        // Check processing
        if (this.processing.has(jobId)) {
            return this.processing.get(jobId);
        }
        
        // Check completed
        if (this.completed.has(jobId)) {
            return this.completed.get(jobId);
        }
        
        // Check failed
        if (this.failed.has(jobId)) {
            return this.failed.get(jobId);
        }
        
        // Check queue
        const queuedJob = this.queue.find(job => job.id === jobId);
        if (queuedJob) {
            return queuedJob;
        }
        
        return null;
    }

    /**
     * Get queue statistics
     */
    getStats() {
        return {
            ...this.stats,
            queueLength: this.queue.length,
            processingCount: this.processing.size,
            completedCount: this.completed.size,
            failedCount: this.failed.size
        };
    }

    /**
     * Generate unique job ID
     */
    generateJobId() {
        return `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Start cleanup interval to remove old completed/failed jobs
     */
    startCleanupInterval() {
        setInterval(() => {
            const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
            
            // Clean completed jobs
            for (const [jobId, job] of this.completed.entries()) {
                if (job.completedAt && job.completedAt.getTime() < cutoffTime) {
                    this.completed.delete(jobId);
                }
            }
            
            // Clean failed jobs
            for (const [jobId, job] of this.failed.entries()) {
                if (job.failedAt && job.failedAt.getTime() < cutoffTime) {
                    this.failed.delete(jobId);
                }
            }
            
        }, 60 * 60 * 1000); // Run every hour
    }

    /**
     * Stop queue processing
     */
    stop() {
        this.isRunning = false;
        this.logger.info('Media queue processing stopped');
    }
}

module.exports = MediaQueueService;