package com.dataeasy.momolistener.sms

import android.content.Context
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Telephony
import android.util.Log
import com.dataeasy.momolistener.MoMoListenerApp
import com.dataeasy.momolistener.domain.model.ParseResult
import com.dataeasy.momolistener.worker.TransactionUploadWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * SMS ContentObserver - More reliable than BroadcastReceiver
 * 
 * Why this works better:
 * - Not blocked by battery optimization
 * - Works on all phone brands
 * - Detects SMS even if broadcasts are blocked
 * 
 * Watches the SMS content provider for changes
 */
class SmsObserver(
    private val context: Context,
    handler: Handler = Handler(Looper.getMainLooper())
) : ContentObserver(handler) {
    
    companion object {
        private const val TAG = "SmsObserver"
        private val SMS_URI = Uri.parse("content://sms")
        
        @Volatile
        private var lastProcessedId: Long = 0
        
        @Volatile
        private var instance: SmsObserver? = null
        
        fun register(context: Context) {
            if (instance != null) {
                Log.d(TAG, "Already registered")
                return
            }
            
            instance = SmsObserver(context.applicationContext)
            context.contentResolver.registerContentObserver(
                SMS_URI,
                true,
                instance!!
            )
            Log.i(TAG, "SMS Observer registered")
        }
        
        fun unregister(context: Context) {
            instance?.let {
                context.contentResolver.unregisterContentObserver(it)
                instance = null
                Log.i(TAG, "SMS Observer unregistered")
            }
        }
    }
    
    override fun onChange(selfChange: Boolean) {
        super.onChange(selfChange)
        Log.d(TAG, "SMS content changed")
        
        // Check for new messages in background
        CoroutineScope(Dispatchers.IO).launch {
            checkForNewSms()
        }
    }
    
    private suspend fun checkForNewSms() {
        try {
            val cursor = context.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                arrayOf(
                    Telephony.Sms._ID,
                    Telephony.Sms.ADDRESS,
                    Telephony.Sms.BODY,
                    Telephony.Sms.DATE
                ),
                null,
                null,
                "${Telephony.Sms.DATE} DESC LIMIT 5"  // Check last 5 messages
            )
            
            cursor?.use {
                val idIdx = it.getColumnIndexOrThrow(Telephony.Sms._ID)
                val addrIdx = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
                val bodyIdx = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
                val dateIdx = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
                
                var savedCount = 0
                
                while (it.moveToNext()) {
                    val smsId = it.getLong(idIdx)
                    
                    // Skip if already processed
                    if (smsId <= lastProcessedId) {
                        continue
                    }
                    
                    val address = it.getString(addrIdx) ?: continue
                    val body = it.getString(bodyIdx) ?: continue
                    val date = it.getLong(dateIdx)
                    
                    Log.d(TAG, "Checking SMS from: $address (id: $smsId)")
                    
                    // Parse the message
                    when (val result = SmsParser.parse(address, body, date)) {
                        is ParseResult.Success -> {
                            val repository = MoMoListenerApp.getInstance().repository
                            val saved = repository.saveTransaction(result.transaction)
                            if (saved) {
                                savedCount++
                                Log.i(TAG, "✅ Saved via Observer: ${result.transaction.transactionId}")
                            }
                        }
                        else -> { /* Not a MoMo message */ }
                    }
                    
                    // Update last processed ID
                    if (smsId > lastProcessedId) {
                        lastProcessedId = smsId
                    }
                }
                
                // Trigger upload if we found new transactions
                if (savedCount > 0) {
                    Log.i(TAG, "Found $savedCount new MoMo message(s), triggering upload")
                    TransactionUploadWorker.enqueueImmediate(context)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error checking SMS", e)
        }
    }
}
