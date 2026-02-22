package com.dataeasy.momolistener.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.dataeasy.momolistener.MoMoListenerApp
import com.dataeasy.momolistener.domain.model.ParseResult
import com.dataeasy.momolistener.worker.TransactionUploadWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * SMS BroadcastReceiver - THIN LAYER
 * 
 * Responsibilities (ONLY):
 * 1. Receive SMS broadcast
 * 2. Pass to parser
 * 3. Save to database
 * 4. Enqueue WorkManager job
 * 
 * NEVER do:
 * - Network calls
 * - Heavy processing
 * - Long-running operations
 * 
 * BroadcastReceiver must complete quickly (<10 seconds)
 */
class SmsReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "SmsReceiver"
    }
    
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            return
        }
        
        Log.i(TAG, "SMS broadcast received")
        
        // Get messages from intent
        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
        if (messages.isNullOrEmpty()) {
            Log.w(TAG, "No messages in intent")
            return
        }
        
        // Use goAsync() to get more time (still limited, but helpful)
        val pendingResult = goAsync()
        
        // Process in coroutine (but quickly!)
        CoroutineScope(Dispatchers.IO).launch {
            try {
                processMessages(context, messages)
            } catch (e: Exception) {
                Log.e(TAG, "Error processing SMS", e)
            } finally {
                pendingResult.finish()
            }
        }
    }
    
    /**
     * Process received SMS messages
     * - Parse each message
     * - Save valid transactions to database
     * - Trigger upload worker
     */
    private suspend fun processMessages(
        context: Context,
        messages: Array<android.telephony.SmsMessage>
    ) {
        // Get repository safely
        val repository = try {
            MoMoListenerApp.getInstance().repository
        } catch (e: IllegalStateException) {
            Log.e(TAG, "App not initialized, cannot process SMS")
            return
        }
        var savedCount = 0
        
        for (smsMessage in messages) {
            val sender = smsMessage.displayOriginatingAddress ?: ""
            val body = smsMessage.messageBody ?: ""
            val timestamp = smsMessage.timestampMillis
            
            Log.d(TAG, "Processing SMS from: $sender")
            
            // Parse the message
            when (val result = SmsParser.parse(sender, body, timestamp)) {
                is ParseResult.Success -> {
                    val transaction = result.transaction
                    
                    // Save to database (duplicate check is in repository)
                    val saved = repository.saveTransaction(transaction)
                    if (saved) {
                        savedCount++
                        Log.i(TAG, "✅ Saved: ${transaction.transactionId}")
                    } else {
                        Log.d(TAG, "Duplicate ignored: ${transaction.transactionId}")
                    }
                }
                
                is ParseResult.InvalidFormat -> {
                    Log.d(TAG, "Invalid format: ${result.reason}")
                    // Could save to unparsed_sms table for debugging
                }
                
                is ParseResult.NotMoMoMessage -> {
                    Log.d(TAG, "Not MoMo message from: ${result.sender}")
                }
            }
        }
        
        // Trigger upload worker if we saved any transactions
        if (savedCount > 0) {
            Log.i(TAG, "Saved $savedCount transaction(s), triggering upload worker")
            enqueueUploadWorker(context)
        }
    }
    
    /**
     * Enqueue WorkManager to upload pending transactions
     * Uses expedited work for immediate execution
     */
    private fun enqueueUploadWorker(context: Context) {
        // Use expedited work for immediate upload
        TransactionUploadWorker.enqueueImmediate(context)
        Log.i(TAG, "Upload worker enqueued (expedited)")
    }
}
