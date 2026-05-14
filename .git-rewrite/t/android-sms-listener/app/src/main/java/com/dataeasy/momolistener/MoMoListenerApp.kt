package com.dataeasy.momolistener

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.dataeasy.momolistener.data.local.AppDatabase
import com.dataeasy.momolistener.data.repository.TransactionRepository

/**
 * Application class - Entry point
 * 
 * Initializes:
 * - Database
 * - Repository
 * - Notification channels
 */
class MoMoListenerApp : Application() {
    
    lateinit var database: AppDatabase
        private set
    
    lateinit var repository: TransactionRepository
        private set
    
    override fun onCreate() {
        super.onCreate()
        instance = this
        
        // Initialize database
        database = AppDatabase.getInstance(this)
        
        // Initialize repository
        repository = TransactionRepository(database)
        
        // Create notification channels
        createNotificationChannels()
    }
    
    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)
            
            // Service channel (low priority, no sound) - MUST be created before startForeground
            val serviceChannel = NotificationChannel(
                CHANNEL_SERVICE,
                "MoMo Listener Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when MoMo listener is active"
                setShowBadge(false)
                setSound(null, null)  // No sound
            }
            
            // Alert channel (high priority, with sound)
            val alertChannel = NotificationChannel(
                CHANNEL_ALERTS,
                "Deposit Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications for processed deposits"
            }
            
            manager.createNotificationChannel(serviceChannel)
            manager.createNotificationChannel(alertChannel)
            
            android.util.Log.i("MoMoListenerApp", "Notification channels created")
        }
    }
    
    companion object {
        const val CHANNEL_SERVICE = "service_channel"
        const val CHANNEL_ALERTS = "alerts_channel"
        
        @Volatile
        private var instance: MoMoListenerApp? = null
        
        fun getInstance(): MoMoListenerApp {
            return instance ?: throw IllegalStateException("App not initialized")
        }
    }
}
