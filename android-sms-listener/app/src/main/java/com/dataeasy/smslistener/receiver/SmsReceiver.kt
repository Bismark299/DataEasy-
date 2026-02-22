package com.dataeasy.smslistener.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.dataeasy.smslistener.data.MoMoTransaction
import com.dataeasy.smslistener.service.SmsListenerService
import com.dataeasy.smslistener.util.MoMoParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * SMS BroadcastReceiver
 * Intercepts incoming SMS and filters for MoMo messages
 * 
 * Looks for senders: "MobileMoney", "MTNMoMo", "MoMo"
 * Extracts: Transaction ID, Amount, Sender Number, Reference
 */
class SmsReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "SmsReceiver"
        
        // MoMo sender identifiers (add more as needed for your region)
        private val MOMO_SENDERS = listOf(
            "mobilemoney",
            "mtnmomo",
            "momo",
            "mtn",
            "mobile money",
            "mtn momo"
        )
    }
    
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            return
        }
        
        Log.d(TAG, "SMS Received broadcast triggered")
        
        try {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            
            for (smsMessage in messages) {
                val sender = smsMessage.displayOriginatingAddress?.lowercase() ?: ""
                val body = smsMessage.messageBody ?: ""
                
                Log.d(TAG, "SMS from: $sender")
                
                // Check if this is a MoMo message
                if (isMoMoSender(sender)) {
                    Log.i(TAG, "MoMo SMS detected from: $sender")
                    processMoMoSms(context, sender, body, smsMessage.timestampMillis)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing SMS", e)
        }
    }
    
    private fun isMoMoSender(sender: String): Boolean {
        return MOMO_SENDERS.any { sender.contains(it) }
    }
    
    private fun processMoMoSms(context: Context, sender: String, body: String, timestamp: Long) {
        Log.d(TAG, "Processing MoMo SMS: $body")
        
        // Parse the MoMo message
        val transaction = MoMoParser.parse(body, sender, timestamp)
        
        if (transaction != null) {
            Log.i(TAG, "Parsed transaction: ID=${transaction.transactionId}, Amount=${transaction.amount}")
            
            // Send to service for processing
            CoroutineScope(Dispatchers.IO).launch {
                SmsListenerService.processTransaction(context, transaction)
            }
        } else {
            Log.w(TAG, "Could not parse MoMo transaction from: $body")
            
            // Still log it for debugging
            CoroutineScope(Dispatchers.IO).launch {
                SmsListenerService.logUnparsedSms(context, sender, body, timestamp)
            }
        }
    }
}
