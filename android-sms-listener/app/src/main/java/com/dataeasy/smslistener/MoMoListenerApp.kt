package com.dataeasy.smslistener

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.room.Room
import com.dataeasy.smslistener.data.AppDatabase
import com.dataeasy.smslistener.network.ApiClient

class MoMoListenerApp : Application() {
    
    lateinit var database: AppDatabase
        private set
    
    override fun onCreate() {
        super.onCreate()
        instance = this
        
        // Initialize Room database
        database = Room.databaseBuilder(
            applicationContext,
            AppDatabase::class.java,
            "momo_listener.db"
        ).fallbackToDestructiveMigration()
         .build()
        
        // Initialize API client
        ApiClient.initialize(this)
        
        // Create notification channel
        createNotificationChannel()
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "MoMo SMS Listener",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Listening for MoMo SMS deposits"
                setShowBadge(false)
            }
            
            val alertChannel = NotificationChannel(
                ALERT_CHANNEL_ID,
                "Deposit Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications when deposits are processed"
            }
            
            val notificationManager = getSystemService(NotificationManager::class.java)
            notificationManager.createNotificationChannel(channel)
            notificationManager.createNotificationChannel(alertChannel)
        }
    }
    
    companion object {
        const val CHANNEL_ID = "momo_listener_service"
        const val ALERT_CHANNEL_ID = "momo_deposit_alert"
        
        @Volatile
        private var instance: MoMoListenerApp? = null
        
        fun getInstance(): MoMoListenerApp {
            return instance ?: throw IllegalStateException("Application not initialized")
        }
    }
}
