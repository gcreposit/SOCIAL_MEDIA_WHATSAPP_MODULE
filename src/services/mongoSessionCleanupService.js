// /**
//  * MongoDB Session Cleanup Service with Stack-Based Management
//  * Implements proper stack data structure (LIFO) to manage WhatsApp RemoteAuth sessions
//  * Prevents unlimited storage growth while maintaining latest sessions
//  */
//
// const mongoose = require('mongoose');
//
// class MongoSessionStackCleanupService {
//   constructor() {
//     // Stack-based session management configuration
//     this.maxSessionsInStack = 3; // Keep only 3 latest sessions in stack (reduced from 2)
//     this.cleanupIntervalMinutes = 15; // Clean more frequently - every 15 minutes
//     this.maxChunkAge = 3 * 24 * 60 * 60 * 1000; // Reduced to 3 days (from 7 days)
//     this.maxStorageSizeMB = 100; // Maximum total storage size in MB
//     this.emergencyCleanupThresholdMB = 500; // Emergency cleanup if above this size
//
//     // Collection names for WhatsApp RemoteAuth
//     this.filesCollectionName = 'whatsapp-RemoteAuth-persistent-whatsapp-client.files';
//     this.chunksCollectionName = 'whatsapp-RemoteAuth-persistent-whatsapp-client.chunks';
//
//     // Stack management
//     this.sessionStack = []; // In-memory representation of session stack
//     this.isCleanupInProgress = false;
//
//     // Start automatic cleanup
//     this.startAutomaticStackCleanup();
//   }
//
//   /**
//    * Start automatic stack-based cleanup
//    */
//   startAutomaticStackCleanup() {
//     console.log('🔥 Starting MongoDB Session Stack Cleanup Service...');
//     console.log(`📚 Stack Config: Max ${this.maxSessionsInStack} sessions, ${this.maxStorageSizeMB}MB limit`);
//     console.log('⚠️  This ONLY cleans WhatsApp session data, NOT your messages!');
//
//     // Initial cleanup after 1 minute
//     setTimeout(() => {
//       this.performStackBasedCleanup();
//     }, 60 * 1000);
//
//     // Regular cleanup every 15 minutes
//     setInterval(() => {
//       this.performStackBasedCleanup();
//     }, this.cleanupIntervalMinutes * 60 * 1000);
//   }
//
//   /**
//    * Main stack-based cleanup method
//    */
//   async performStackBasedCleanup() {
//     if (this.isCleanupInProgress) {
//       console.log('🔄 Cleanup already in progress, skipping...');
//       return;
//     }
//
//     this.isCleanupInProgress = true;
//
//     try {
//       if (mongoose.connection.readyState !== 1) {
//         console.log('⚠️ MongoDB not connected, skipping cleanup');
//         return;
//       }
//
//       console.log('🔥 Starting Stack-Based Session Cleanup...');
//       const startTime = Date.now();
//
//       const db = mongoose.connection.db;
//
//       // Check if collections exist
//       const collections = await db.listCollections().toArray();
//       const collectionNames = collections.map(c => c.name);
//
//       if (!collectionNames.includes(this.filesCollectionName) ||
//           !collectionNames.includes(this.chunksCollectionName)) {
//         console.log('ℹ️ RemoteAuth collections not found, nothing to clean');
//         return;
//       }
//
//       const filesCollection = db.collection(this.filesCollectionName);
//       const chunksCollection = db.collection(this.chunksCollectionName);
//
//       // Get current stats
//       const beforeStats = await this.getCollectionStats(db);
//       console.log('📊 Before cleanup:', this.formatStats(beforeStats));
//
//       // Check if emergency cleanup is needed
//       const totalSizeMB = beforeStats.totalSize / (1024 * 1024);
//       if (totalSizeMB > this.emergencyCleanupThresholdMB) {
//         console.log(`🚨 EMERGENCY CLEANUP: Size ${totalSizeMB.toFixed(2)}MB exceeds ${this.emergencyCleanupThresholdMB}MB`);
//         await this.performEmergencyStackCleanup(filesCollection, chunksCollection);
//       } else {
//         await this.performNormalStackCleanup(filesCollection, chunksCollection);
//       }
//
//       // Final stats
//       const afterStats = await this.getCollectionStats(db);
//       console.log('📊 After cleanup:', this.formatStats(afterStats));
//
//       const endTime = Date.now();
//       const duration = Math.round((endTime - startTime) / 1000);
//       const savedMB = (beforeStats.totalSize - afterStats.totalSize) / (1024 * 1024);
//
//       console.log(`✅ Stack cleanup completed in ${duration}s. Saved ${savedMB.toFixed(2)}MB`);
//
//     } catch (error) {
//       console.error('❌ Error during stack cleanup:', error);
//     } finally {
//       this.isCleanupInProgress = false;
//     }
//   }
//
//   /**
//    * Normal stack-based cleanup (maintains stack discipline)
//    */
//   async performNormalStackCleanup(filesCollection, chunksCollection) {
//     let totalCleaned = 0;
//
//     // 1. Build session stack (LIFO order)
//     await this.buildSessionStack(filesCollection);
//
//     // 2. Clean sessions using stack discipline
//     totalCleaned += await this.cleanSessionsUsingStack(filesCollection, chunksCollection);
//
//     // 3. Clean orphaned chunks
//     totalCleaned += await this.cleanOrphanedChunks(filesCollection, chunksCollection);
//
//     // 4. Clean old chunks by age
//     totalCleaned += await this.cleanOldChunks(chunksCollection);
//
//     // 5. Size-based cleanup if still too large
//     const stats = await this.getCollectionStats(mongoose.connection.db);
//     const sizeMB = stats.totalSize / (1024 * 1024);
//     if (sizeMB > this.maxStorageSizeMB) {
//       console.log(`📏 Size ${sizeMB.toFixed(2)}MB exceeds limit ${this.maxStorageSizeMB}MB, performing additional cleanup`);
//       totalCleaned += await this.performSizeBasedStackCleanup(filesCollection, chunksCollection);
//     }
//
//     return totalCleaned;
//   }
//
//   /**
//    * Build in-memory session stack from database
//    */
//   async buildSessionStack(filesCollection) {
//     try {
//       // Get all sessions ordered by creation time (oldest first for proper stack building)
//       const allSessions = await filesCollection
//           .find({})
//           .sort({ uploadDate: 1 }) // Ascending order to build stack properly
//           .toArray();
//
//       // Build stack (push operations)
//       this.sessionStack = [];
//       for (const session of allSessions) {
//         this.sessionStack.push({
//           id: session._id,
//           filename: session.filename,
//           uploadDate: session.uploadDate,
//           length: session.length || 0
//         });
//       }
//
//       console.log(`📚 Built session stack with ${this.sessionStack.length} sessions`);
//       console.log(`🔝 Top of stack (newest): ${this.sessionStack[this.sessionStack.length - 1]?.filename}`);
//       console.log(`🔻 Bottom of stack (oldest): ${this.sessionStack[0]?.filename}`);
//
//     } catch (error) {
//       console.error('❌ Error building session stack:', error);
//       this.sessionStack = [];
//     }
//   }
//
//   /**
//    * Clean sessions using proper stack discipline (LIFO)
//    */
//   async cleanSessionsUsingStack(filesCollection, chunksCollection) {
//     if (this.sessionStack.length > this.maxSessionsInStack) {
//       console.log(`✅ Stack size OK: ${this.sessionStack.length} <= ${this.maxSessionsInStack}`);
//       return 0;
//     }
//
//     console.log(`📚 Stack overflow: ${this.sessionStack.length} sessions > ${this.maxSessionsInStack} limit`);
//
//     let deletedCount = 0;
//     const sessionsToKeep = this.maxSessionsInStack;
//     const sessionsToDelete = this.sessionStack.length - sessionsToKeep;
//
//     // Pop from bottom of stack (delete oldest sessions)
//     for (let i = 0; i < sessionsToDelete; i++) {
//       const sessionToDelete = this.sessionStack.shift(); // Remove from bottom (FIFO for deletion)
//
//       try {
//         // Delete file metadata
//         await filesCollection.deleteOne({ _id: sessionToDelete.id });
//
//         // Delete corresponding chunks
//         const chunksResult = await chunksCollection.deleteMany({
//           files_id: sessionToDelete.id
//         });
//
//         deletedCount += 1 + chunksResult.deletedCount;
//
//         console.log(`🗑️ Popped from stack: ${sessionToDelete.filename} (${chunksResult.deletedCount} chunks)`);
//
//       } catch (deleteError) {
//         console.error(`⚠️ Error deleting session ${sessionToDelete.id}:`, deleteError.message);
//       }
//     }
//
//     console.log(`📚 Stack management: Kept top ${sessionsToKeep} sessions, removed ${sessionsToDelete} oldest`);
//     return deletedCount;
//   }
//
//   /**
//    * Emergency cleanup when storage is critically high
//    */
//   async performEmergencyStackCleanup(filesCollection, chunksCollection) {
//     console.log('🚨 EMERGENCY STACK CLEANUP - Aggressive mode');
//
//     // Keep only 1 session in emergency mode
//     this.maxSessionsInStack = 1;
//     this.maxChunkAge = 1 * 24 * 60 * 60 * 1000; // 1 day only
//
//     await this.buildSessionStack(filesCollection);
//
//     let totalCleaned = 0;
//
//     // 1. Aggressive session cleanup
//     totalCleaned += await this.cleanSessionsUsingStack(filesCollection, chunksCollection);
//
//     // 2. Delete all old chunks
//     totalCleaned += await this.cleanOldChunks(chunksCollection);
//
//     // 3. Clean all orphaned data
//     totalCleaned += await this.cleanOrphanedChunks(filesCollection, chunksCollection);
//
//     // Reset to normal values after emergency
//     this.maxSessionsInStack = 3;
//     this.maxChunkAge = 3 * 24 * 60 * 60 * 1000;
//
//     console.log(`🚨 Emergency cleanup removed ${totalCleaned} items`);
//     return totalCleaned;
//   }
//
//   /**
//    * Size-based cleanup using stack discipline
//    */
//   async performSizeBasedStackCleanup(filesCollection, chunksCollection) {
//     console.log('📏 Performing size-based stack cleanup...');
//
//     let deletedCount = 0;
//     let currentStats = await this.getCollectionStats(mongoose.connection.db);
//     let currentSizeMB = currentStats.totalSize / (1024 * 1024);
//
//     // Keep popping from stack until size is acceptable
//     while (currentSizeMB > this.maxStorageSizeMB && this.sessionStack.length > 1) {
//       const sessionToDelete = this.sessionStack.shift(); // Pop from bottom
//
//       try {
//         // Delete session and chunks
//         await filesCollection.deleteOne({ _id: sessionToDelete.id });
//         const chunksResult = await chunksCollection.deleteMany({
//           files_id: sessionToDelete.id
//         });
//
//         deletedCount += 1 + chunksResult.deletedCount;
//
//         // Update size
//         currentStats = await this.getCollectionStats(mongoose.connection.db);
//         currentSizeMB = currentStats.totalSize / (1024 * 1024);
//
//         console.log(`📏 Size-based pop: ${sessionToDelete.filename}, new size: ${currentSizeMB.toFixed(2)}MB`);
//
//       } catch (error) {
//         console.error('⚠️ Error in size-based cleanup:', error.message);
//         break;
//       }
//     }
//
//     return deletedCount;
//   }
//
//   /**
//    * Clean orphaned chunks
//    */
//   async cleanOrphanedChunks(filesCollection, chunksCollection) {
//     try {
//       const fileIds = await filesCollection.distinct('_id');
//       const fileIdSet = new Set(fileIds.map(id => id.toString()));
//
//       // Find orphaned chunks by checking which chunks don't have corresponding files
//       const allChunks = await chunksCollection.find({}).toArray();
//       const orphanedChunks = allChunks.filter(chunk =>
//           !fileIdSet.has(chunk.files_id.toString())
//       );
//
//       if (orphanedChunks.length === 0) {
//         console.log('✅ No orphaned chunks found');
//         return 0;
//       }
//
//       // Delete orphaned chunks
//       const orphanedIds = orphanedChunks.map(chunk => chunk._id);
//       const result = await chunksCollection.deleteMany({
//         _id: { $in: orphanedIds }
//       });
//
//       if (result.deletedCount > 0) {
//         console.log(`🗑️ Cleaned ${result.deletedCount} orphaned chunks`);
//       }
//
//       return result.deletedCount;
//
//     } catch (error) {
//       console.error('❌ Error cleaning orphaned chunks:', error);
//       return 0;
//     }
//   }
//
//   /**
//    * Clean old chunks by age
//    */
//   async cleanOldChunks(chunksCollection) {
//     try {
//       const cutoffDate = new Date(Date.now() - this.maxChunkAge);
//
//       const result = await chunksCollection.deleteMany({
//         uploadDate: { $lt: cutoffDate }
//       });
//
//       if (result.deletedCount > 0) {
//         const ageDays = Math.round(this.maxChunkAge / (24 * 60 * 60 * 1000));
//         console.log(`🗑️ Cleaned ${result.deletedCount} chunks older than ${ageDays} days`);
//       }
//
//       return result.deletedCount;
//
//     } catch (error) {
//       console.error('❌ Error cleaning old chunks:', error);
//       return 0;
//     }
//   }
//
//   /**
//    * Get collection statistics
//    */
//   /**
//    * Get collection statistics using manual calculation
//    */
//   async getCollectionStats(db) {
//     try {
//       console.log('📊 Getting collection stats manually...');
//
//       const filesCollection = db.collection(this.filesCollectionName);
//       const chunksCollection = db.collection(this.chunksCollectionName);
//
//       // Get files stats manually
//       const filesCount = await filesCollection.countDocuments();
//       const allFiles = await filesCollection.find({}).toArray();
//       let filesSize = 0;
//       for (const file of allFiles) {
//         filesSize += file.length || 0;
//       }
//
//       console.log(`📁 Files: ${filesCount} docs, ${this.formatBytes(filesSize)}`);
//
//       // Get chunks stats manually
//       const chunksCount = await chunksCollection.countDocuments();
//       const allChunks = await chunksCollection.find({}).toArray();
//       let chunksSize = 0;
//       for (const chunk of allChunks) {
//         if (chunk.data && typeof chunk.data.length === 'function') {
//           chunksSize += chunk.data.length();
//         }
//       }
//
//       console.log(`🧩 Chunks: ${chunksCount} docs, ${this.formatBytes(chunksSize)}`);
//
//       const totalSize = filesSize + chunksSize;
//       const totalCount = filesCount + chunksCount;
//
//       console.log(`📊 Total: ${totalCount} docs, ${this.formatBytes(totalSize)}`);
//
//       return {
//         files: {
//           count: filesCount,
//           size: filesSize
//         },
//         chunks: {
//           count: chunksCount,
//           size: chunksSize
//         },
//         totalSize: totalSize,
//         totalCount: totalCount
//       };
//
//     } catch (error) {
//       console.error('❌ Error getting collection stats:', error);
//       return {
//         files: { count: 0, size: 0 },
//         chunks: { count: 0, size: 0 },
//         totalSize: 0,
//         totalCount: 0
//       };
//     }
//   }
//
//   /**
//    * Format statistics for display
//    */
//   formatStats(stats) {
//     return {
//       files: `${stats.files.count} files (${this.formatBytes(stats.files.size)})`,
//       chunks: `${stats.chunks.count} chunks (${this.formatBytes(stats.chunks.size)})`,
//       total: `${this.formatBytes(stats.totalSize)} data, ${this.formatBytes(stats.totalStorageSize || stats.totalSize)} storage`,
//       sessionStackSize: this.sessionStack.length
//     };
//   }
//
//   /**
//    * Format bytes to human readable
//    */
//   formatBytes(bytes) {
//     if (bytes === 0) return '0 Bytes';
//     const k = 1024;
//     const sizes = ['Bytes', 'KB', 'MB', 'GB'];
//     const i = Math.floor(Math.log(bytes) / Math.log(k));
//     return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
//   }
//
//   /**
//    * Get current session stack info
//    */
//   getSessionStackInfo() {
//     return {
//       stackSize: this.sessionStack.length,
//       maxStackSize: this.maxSessionsInStack,
//       topOfStack: this.sessionStack[this.sessionStack.length - 1],
//       bottomOfStack: this.sessionStack[0],
//       stackItems: this.sessionStack.map((session, index) => ({
//         position: index,
//         filename: session.filename,
//         uploadDate: session.uploadDate,
//         size: this.formatBytes(session.length)
//       }))
//     };
//   }
//
//   /**
//    * Manual trigger for stack cleanup
//    */
//   async triggerManualStackCleanup() {
//     console.log('🔥 Manual stack cleanup triggered...');
//     await this.performStackBasedCleanup();
//   }
//
//   /**
//    * Update stack configuration
//    */
//   updateStackConfig(config) {
//     if (config.maxSessionsInStack) this.maxSessionsInStack = config.maxSessionsInStack;
//     if (config.cleanupIntervalMinutes) this.cleanupIntervalMinutes = config.cleanupIntervalMinutes;
//     if (config.maxChunkAgeDays) this.maxChunkAge = config.maxChunkAgeDays * 24 * 60 * 60 * 1000;
//     if (config.maxStorageSizeMB) this.maxStorageSizeMB = config.maxStorageSizeMB;
//     if (config.emergencyCleanupThresholdMB) this.emergencyCleanupThresholdMB = config.emergencyCleanupThresholdMB;
//
//     console.log('🔧 Stack configuration updated:', {
//       maxSessionsInStack: this.maxSessionsInStack,
//       cleanupIntervalMinutes: this.cleanupIntervalMinutes,
//       maxChunkAgeDays: Math.round(this.maxChunkAge / (24 * 60 * 60 * 1000)),
//       maxStorageSizeMB: this.maxStorageSizeMB,
//       emergencyThresholdMB: this.emergencyCleanupThresholdMB
//     });
//   }
// }
//
// // Usage example:
// const sessionCleanup = new MongoSessionStackCleanupService();
//
// // To manually trigger cleanup:
// sessionCleanup.triggerManualStackCleanup();
//
// // To get stack info:
// const stackInfo = sessionCleanup.getSessionStackInfo();
//
// // To update configuration:
// sessionCleanup.updateStackConfig({
//   maxSessionsInStack: 2,
//   maxStorageSizeMB: 10,
//   emergencyCleanupThresholdMB: 15
// });
//
// module.exports = MongoSessionStackCleanupService;