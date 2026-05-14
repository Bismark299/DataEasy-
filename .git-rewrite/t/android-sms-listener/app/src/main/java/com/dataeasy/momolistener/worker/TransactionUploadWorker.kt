package com.dataeasy.momolistener.worker

import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.*
import com.dataeasy.momolistener.MoMoListenerApp
import com.dataeasy.momolistener.R
import kotlinx.coroutines.delay
import java.util.concurrent.TimeUnit

/**
 * WorkManager Worker for uploading transactions
 * 
 * WHY WorkManager?
 * - Survives app kill
 * - Respects battery policies
 * - Handles exponential backoff automatically
 * - Guaranteed execution
 * 
 * This worker:
 * 1. Fetches PENDING transactions
 * 2. Uploads one by one
 * 3. Marks SUCCESS or increments retry
 * 4. Reschedules itself if more work needed
 */
class TransactionUploadWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {
    
    companion object {
        private const val TAG = "UploadWorker"
        private const val WORK_NAME = "transaction_upload"
        private const val NOTIFICATION_ID = 2001
        
        /**
         * Enqueue periodic upload worker
         * Runs every 15 minutes to catch any missed uploads
         */
        fun enqueuePeriodicWork(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            
            val periodicRequest = PeriodicWorkRequestBuilder<TransactionUploadWorker>(
                15, TimeUnit.MINUTES
            )
                .setConstraints(constraints)
                .setBackoffCriteria(
                    BackoffPolicy.EXPONENTIAL,
                    1, TimeUnit.MINUTES
                )
                .build()
            
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                periodicRequest
            )
            
            Log.i(TAG, "Periodic upload worker scheduled")
        }
        
        /**
         * Enqueue immediate upload with expedited/foreground priority
         * This ensures uploads happen immediately, even with battery optimization
         */
        fun enqueueImmediate(context: Context) {
            val request = OneTimeWorkRequestBuilder<TransactionUploadWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setBackoffCriteria(
                    BackoffPolicy.LINEAR,
                    15, TimeUnit.SECONDS
                )
                .build()
            
            WorkManager.getInstance(context).enqueueUniqueWork(
                "immediate_upload",
                ExistingWorkPolicy.REPLACE,
                request
            )
            
            Log.i(TAG, "Immediate upload worker enqueued (expedited)")
        }
    }
    
    /**
     * Create foreground notification for expedited work
     */
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val notification = NotificationCompat.Builder(applicationContext, MoMoListenerApp.CHANNEL_SERVICE)
            .setContentTitle("Uploading Transaction")
            .setContentText("Sending MoMo deposit to server...")
            .setSmallIcon(R.drawable.ic_notification)
            .setProgress(0, 0, true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .build()
        
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }
    
    override suspend fun doWork(): Result {
        Log.i(TAG, "Upload worker started (attempt: $runAttemptCount)")
        
        // Set as foreground for immediate execution
        try {
            setForeground(getForegroundInfo())
        } catch (e: Exception) {
            Log.w(TAG, "Could not set foreground: ${e.message}")
            // Continue anyway - expedited work should still run
        }
        
        val app = applicationContext as? MoMoListenerApp
        if (app == null) {
            Log.e(TAG, "App context not available")
            return Result.failure()
        }
        
        val repository = app.repository
        
        try {
            // Get pending transactions
            val pending = repository.getPendingForUpload()
            
            if (pending.isEmpty()) {
                Log.d(TAG, "No pending transactions")
                return Result.success()
            }
            
            Log.i(TAG, "Found ${pending.size} pending transaction(s)")
            
            var successCount = 0
            var failCount = 0
            
            for (entity in pending) {
                Log.d(TAG, "Uploading: ${entity.transactionId}")
                
                val result = repository.uploadTransaction(entity)
                
                when (result) {
                    is com.dataeasy.momolistener.domain.model.ApiResult.Success -> {
                        successCount++
                        Log.i(TAG, "✅ Uploaded: ${entity.transactionId}")
                    }
                    is com.dataeasy.momolistener.domain.model.ApiResult.Error -> {
                        failCount++
                        Log.w(TAG, "❌ Server error: ${result.message}")
                    }
                    is com.dataeasy.momolistener.domain.model.ApiResult.NetworkError -> {
                        failCount++
                        Log.w(TAG, "❌ Network error: ${result.exception.message}")
                        // Network error - let WorkManager retry with backoff
                        if (failCount == pending.size) {
                            return Result.retry()
                        }
                    }
                }
                
                // Small delay between uploads to not overwhelm server
                delay(500)
            }
            
            Log.i(TAG, "Upload complete: $successCount success, $failCount failed")
            
            // Run cleanup
            repository.cleanupOldTransactions()
            
            return Result.success()
            
        } catch (e: Exception) {
            Log.e(TAG, "Worker error", e)
            return if (runAttemptCount < 5) {
                Result.retry()
            } else {
                Result.failure()
            }
        }
    }
}
