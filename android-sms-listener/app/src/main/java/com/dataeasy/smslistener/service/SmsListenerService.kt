package com.dataeasy.smslistener.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dataeasy.smslistener.MainActivity
import com.dataeasy.smslistener.MoMoListenerApp
import com.dataeasy.smslistener.R
import com.dataeasy.smslistener.data.MoMoTransaction
import com.dataeasy.smslistener.data.UnparsedSms
import com.dataeasy.smslistener.network.ApiClient
import kotlinx.coroutines.*
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Foreground Service for SMS Listening
 * 
 * Features:
 * - Keeps app alive with WakeLock
 * - Processes incoming MoMo transactions
 * - Retries failed sends
 * - Manages offline queue
 */
class SmsListenerService : Service() {
    
    companion object {
        private const val TAG = "SmsListenerService"
        private const val NOTIFICATION_ID = 1001
        private const val WAKELOCK_TAG = "MoMoListener:WakeLock"
        
        private const val MAX_RETRIES = 5
        private const val RETRY_INTERVAL_MS = 60_000L // 1 minute
        private const val CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000L // 24 hours
        
        private val isRunning = AtomicBoolean(false)
        
        /**
         * Process a new transaction (called from SmsReceiver)
         * IMPORTANT: Save to DB first, then send asynchronously - never block the receiver!
         */
        suspend fun processTransaction(context: Context, transaction: MoMoTransaction) {
            try {
                val app = MoMoListenerApp.getInstance()
                val dao = app.database.momoTransactionDao()
                
                // Check for duplicate
                val existingCount = try {
                    dao.existsByTransactionId(transaction.transactionId)
                } catch (e: Exception) {
                    Log.e(TAG, "DB error checking duplicate", e)
                    0 // Continue anyway
                }
                
                if (existingCount > 0) {
                    Log.w(TAG, "Duplicate transaction: ${transaction.transactionId}")
                    return
                }
                
                // Save to database FIRST (queue it)
                val id = try {
                    dao.insert(transaction)
                } catch (e: Exception) {
                    Log.e(TAG, "DB error inserting transaction", e)
                    return // Can't proceed without saving
                }
                
                Log.i(TAG, "✅ Saved transaction to queue: ${transaction.transactionId}, id=$id")
                
                // Try to send immediately (but don't block if it fails - retry loop will handle it)
                if (id > 0) {
                    try {
                        val savedTx = transaction.copy(id = id)
                        sendToServer(savedTx)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error sending (will retry later): ${e.message}")
                        // Transaction is already saved, retry loop will pick it up
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Unexpected error in processTransaction", e)
                // Don't rethrow - we don't want to crash the receiver
            }
        }
        
        /**
         * Log unparsed SMS for debugging
         */
        suspend fun logUnparsedSms(context: Context, sender: String, body: String, timestamp: Long) {
            try {
                val app = MoMoListenerApp.getInstance()
                val dao = app.database.unparsedSmsDao()
                dao.insert(UnparsedSms(sender = sender, body = body, receivedAt = timestamp))
                Log.i(TAG, "📝 Logged unparsed SMS from: $sender")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to log unparsed SMS", e)
                // Don't rethrow - this is just logging
            }
        }
        
        /**
         * Send transaction to server
         */
        private suspend fun sendToServer(transaction: MoMoTransaction) {
            val app = MoMoListenerApp.getInstance()
            val dao = app.database.momoTransactionDao()
            
            try {
                Log.i(TAG, "Sending to server: ${transaction.transactionId}")
                
                val response = ApiClient.service.reportDeposit(
                    transactionId = transaction.transactionId,
                    amount = transaction.amount,
                    senderPhone = transaction.senderPhone,
                    reference = transaction.reference,
                    rawMessage = transaction.rawMessage,
                    receivedAt = transaction.receivedAt
                )
                
                if (response.isSuccessful && response.body()?.success == true) {
                    // Success!
                    dao.updateStatus(
                        id = transaction.id,
                        status = MoMoTransaction.Status.SENT,
                        response = response.body()?.message ?: "Success",
                        sentAt = System.currentTimeMillis()
                    )
                    Log.i(TAG, "Transaction sent successfully: ${transaction.transactionId}")
                    
                    // Show notification
                    showDepositNotification(
                        transaction.amount,
                        response.body()?.username ?: "User",
                        response.body()?.message
                    )
                } else {
                    // Server rejected
                    val errorMsg = response.body()?.error ?: response.errorBody()?.string() ?: "Unknown error"
                    Log.e(TAG, "Server rejected: $errorMsg")
                    
                    // Check if permanent error (duplicate, invalid user, etc.)
                    if (response.code() == 409 || response.body()?.error?.contains("duplicate", true) == true) {
                        dao.updateStatus(
                            id = transaction.id,
                            status = MoMoTransaction.Status.ERROR,
                            response = errorMsg,
                            sentAt = null
                        )
                    } else {
                        // Temporary error, will retry
                        dao.incrementRetry(
                            id = transaction.id,
                            status = MoMoTransaction.Status.FAILED,
                            lastAttempt = System.currentTimeMillis()
                        )
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "Network error sending transaction", e)
                
                // Network error, mark for retry
                dao.incrementRetry(
                    id = transaction.id,
                    status = MoMoTransaction.Status.FAILED,
                    lastAttempt = System.currentTimeMillis()
                )
            }
        }
        
        private fun showDepositNotification(amount: Double, username: String, message: String?) {
            try {
                val app = MoMoListenerApp.getInstance()
                val notificationManager = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                
                val notification = NotificationCompat.Builder(app, MoMoListenerApp.ALERT_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle("Deposit Received!")
                    .setContentText("GHS ${"%.2f".format(amount)} credited to $username")
                    .setStyle(NotificationCompat.BigTextStyle()
                        .bigText(message ?: "GHS ${"%.2f".format(amount)} has been credited to $username's wallet"))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .build()
                
                notificationManager.notify(System.currentTimeMillis().toInt(), notification)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to show notification", e)
            }
        }
    }
    
    private var wakeLock: PowerManager.WakeLock? = null
    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var retryJob: Job? = null
    
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "🚀 Service onCreate - starting MoMo listener")
        isRunning.set(true)
        acquireWakeLock()
        startRetryLoop()
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "📱 Service onStartCommand (already running: ${isRunning.get()})")
        startForeground(NOTIFICATION_ID, createNotification())
        return START_STICKY // Restart if killed
    }
    
    override fun onDestroy() {
        Log.i(TAG, "Service onDestroy")
        isRunning.set(false)
        retryJob?.cancel()
        serviceScope.cancel()
        releaseWakeLock()
        
        // Restart the service if it gets killed
        scheduleRestart()
        
        super.onDestroy()
    }
    
    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.i(TAG, "Task removed, scheduling restart")
        scheduleRestart()
        super.onTaskRemoved(rootIntent)
    }
    
    private fun scheduleRestart() {
        try {
            val restartIntent = Intent(applicationContext, SmsListenerService::class.java)
            val pendingIntent = PendingIntent.getService(
                applicationContext,
                1,
                restartIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            )
            val alarmManager = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + 1000,
                    pendingIntent
                )
            } else {
                alarmManager.setExact(
                    AlarmManager.RTC_WAKEUP,
                    System.currentTimeMillis() + 1000,
                    pendingIntent
                )
            }
            Log.i(TAG, "Scheduled service restart")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule restart", e)
        }
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                WAKELOCK_TAG
            ).apply {
                setReferenceCounted(false)
                acquire(10 * 60 * 60 * 1000L) // 10 hours max, will be re-acquired
            }
            Log.d(TAG, "WakeLock acquired")
        }
    }
    
    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "WakeLock released")
            }
        }
        wakeLock = null
    }
    
    private fun createNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, MoMoListenerApp.CHANNEL_ID)
            .setContentTitle("MoMo Listener Active")
            .setContentText("Monitoring for MoMo deposits...")
            .setSmallIcon(android.R.drawable.ic_menu_view)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }
    
    /**
     * Retry loop for failed transactions
     * This runs continuously while the service is alive
     */
    private fun startRetryLoop() {
        Log.i(TAG, "🔄 Starting retry loop (interval: ${RETRY_INTERVAL_MS / 1000}s)")
        retryJob = serviceScope.launch {
            var loopCount = 0
            while (isActive) {
                loopCount++
                try {
                    Log.d(TAG, "🔄 Retry loop iteration #$loopCount")
                    retryFailedTransactions()
                    cleanupOldRecords()
                } catch (e: Exception) {
                    Log.e(TAG, "Retry loop error", e)
                }
                delay(RETRY_INTERVAL_MS)
            }
            Log.w(TAG, "⚠️ Retry loop ended after $loopCount iterations")
        }
    }
    
    private suspend fun retryFailedTransactions() {
        try {
            val app = MoMoListenerApp.getInstance()
            val dao = app.database.momoTransactionDao()
            
            val failedTransactions = dao.getByStatuses(
                listOf(MoMoTransaction.Status.PENDING, MoMoTransaction.Status.FAILED)
            )
            
            if (failedTransactions.isNotEmpty()) {
                Log.i(TAG, "📤 Found ${failedTransactions.size} transaction(s) to retry")
            }
        
            for (tx in failedTransactions) {
                if (tx.retryCount >= MAX_RETRIES) {
                    // Mark as permanent error
                    dao.updateStatus(
                        id = tx.id,
                        status = MoMoTransaction.Status.ERROR,
                        response = "Max retries exceeded",
                        sentAt = null
                    )
                    continue
                }
                
                Log.i(TAG, "🔄 Retrying transaction: ${tx.transactionId} (attempt ${tx.retryCount + 1})")
                sendToServer(tx)
                
                // Small delay between retries
                delay(2000)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error in retryFailedTransactions", e)
        }
    }
    
    private suspend fun cleanupOldRecords() {
        val app = MoMoListenerApp.getInstance()
        
        // Delete successfully sent transactions older than 7 days
        val sevenDaysAgo = System.currentTimeMillis() - (7 * 24 * 60 * 60 * 1000L)
        val deleted = app.database.momoTransactionDao().deleteOldSent(
            MoMoTransaction.Status.SENT,
            sevenDaysAgo
        )
        if (deleted > 0) {
            Log.i(TAG, "Cleaned up $deleted old transactions")
        }
        
        // Delete unparsed SMS older than 30 days
        val thirtyDaysAgo = System.currentTimeMillis() - (30 * 24 * 60 * 60 * 1000L)
        app.database.unparsedSmsDao().deleteOld(thirtyDaysAgo)
    }
}
