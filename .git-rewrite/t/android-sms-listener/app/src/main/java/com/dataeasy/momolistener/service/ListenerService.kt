package com.dataeasy.momolistener.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dataeasy.momolistener.R
import com.dataeasy.momolistener.sms.SmsObserver
import com.dataeasy.momolistener.ui.MainActivity
import com.dataeasy.momolistener.worker.TransactionUploadWorker

/**
 * Foreground Service for continuous SMS listening
 * 
 * WHY Foreground Service?
 * - Android 8+ requires it for background work
 * - Prevents system from killing the app
 * - Shows user that app is actively listening
 * - Required for reliable SMS reception
 * 
 * This service:
 * 1. Keeps app alive with visible notification
 * 2. Holds partial wake lock (optional, for reliability)
 * 3. Ensures WorkManager is scheduled
 */
class ListenerService : Service() {
    
    companion object {
        private const val TAG = "ListenerService"
        private const val NOTIFICATION_ID = 1001
        private const val CHANNEL_ID = "service_channel"  // Must match MoMoListenerApp.CHANNEL_SERVICE
        private const val CHANNEL_NAME = "MoMo Listener"
    }
    
    private var wakeLock: PowerManager.WakeLock? = null
    
    override fun onCreate() {
        super.onCreate()
        Log.i(TAG, "Service created")
        
        // Channel is already created in MoMoListenerApp.onCreate()
        // Create it again here as a safety fallback
        createNotificationChannel()
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.i(TAG, "Service started")
        
        try {
            // Start as foreground service with notification
            // Android 14+ requires specifying foreground service type
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, createNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, createNotification())
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground: ${e.message}", e)
            // Try to recover by creating channel
            createNotificationChannel()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, createNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, createNotification())
            }
        }
        
        // Acquire wake lock for reliability (optional)
        acquireWakeLock()
        
        // Register SMS ContentObserver (more reliable than BroadcastReceiver)
        SmsObserver.register(this)
        Log.i(TAG, "SMS Observer registered for reliable detection")
        
        // Ensure periodic upload worker is scheduled
        TransactionUploadWorker.enqueuePeriodicWork(this)
        
        // START_STICKY ensures service restarts if killed
        return START_STICKY
    }
    
    override fun onDestroy() {
        super.onDestroy()
        Log.w(TAG, "Service destroyed")
        
        // Unregister SMS Observer
        SmsObserver.unregister(this)
        
        releaseWakeLock()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    // ==================== NOTIFICATION ====================
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_LOW  // Low importance = no sound
            ).apply {
                description = "Shows when MoMo listener is active"
                setShowBadge(false)
            }
            
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
    
    private fun createNotification(): Notification {
        // Intent to open app when notification is tapped
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("MoMo Listener Active")
            .setContentText("Monitoring for MoMo deposits...")
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }
    
    // ==================== WAKE LOCK ====================
    
    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "MoMoListener:WakeLock"
            ).apply {
                acquire(10 * 60 * 1000L)  // 10 minutes, will auto-release
            }
            Log.d(TAG, "Wake lock acquired")
        }
    }
    
    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "Wake lock released")
            }
        }
        wakeLock = null
    }
}
