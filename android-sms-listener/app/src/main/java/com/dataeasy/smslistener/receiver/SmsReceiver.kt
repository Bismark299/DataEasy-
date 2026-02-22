package com.dataeasy.smslistener.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
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
        private const val WAKE_LOCK_TIMEOUT = 30000L // 30 seconds
        
        // ========== AUTHORIZED MOMO SENDERS ==========
        // These are the official MTN MoMo sender IDs in Ghana
        // Add more as you discover them from actual MoMo SMS
        private val MOMO_SENDERS = listOf(
            // MTN Ghana official senders
            "mobilemoney",
            "mtnmomo",
            "mtn momo",
            "mtn",
            "momo",
            "mobile money",
            // Short codes (Ghana)
            "1515",
            "170",
            // Possible variations
            "mtn_momo",
            "mtnghana",
            "mtn-momo"
        )
        
        // Keywords that MUST be in a valid MoMo deposit message
        private val DEPOSIT_KEYWORDS = listOf(
            "received",
            "cash in",
            "deposit",
            "credited",
            "credit alert"
        )
        
        // Keywords that indicate this is NOT a deposit (outgoing transaction)
        private val NON_DEPOSIT_KEYWORDS = listOf(
            "you sent",
            "you have sent",
            "you paid",
            "payment to",
            "transferred to",
            "withdrawal",
            "withdrawn",
            "deducted",
            "airtime",
            "data bundle"
        )
    }
    
    override fun onReceive(context: Context, intent: Intent) {
        // Log EVERY call to onReceive
        Log.i(TAG, "═══════════════════════════════════════════════")
        Log.i(TAG, "📨 SMS BROADCAST RECEIVED!")
        Log.i(TAG, "Action: ${intent.action}")
        Log.i(TAG, "═══════════════════════════════════════════════")
        
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            Log.d(TAG, "Ignoring non-SMS intent")
            return
        }
        
        Log.i(TAG, "✅ SMS_RECEIVED_ACTION - Processing...")
        
        // Acquire wake lock to ensure processing completes
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "MoMoListener:SmsProcessing"
        )
        wakeLock.acquire(WAKE_LOCK_TIMEOUT)
        Log.d(TAG, "Wake lock acquired")
        
        // Use goAsync() to extend receiver lifetime (beyond 10 seconds)
        val pendingResult = goAsync()
        Log.d(TAG, "goAsync() called - receiver lifetime extended")
        
        // Ensure the service is running (restart if needed)
        ensureServiceRunning(context)
        
        try {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            Log.i(TAG, "📬 Got ${messages?.size ?: 0} SMS message(s) from intent")
            
            if (messages == null || messages.isEmpty()) {
                Log.w(TAG, "No messages in intent")
                releaseAndFinish(wakeLock, pendingResult)
                return
            }
            
            // Process ALL messages (for debugging - process everything)
            val momoMessages = mutableListOf<Triple<String, String, Long>>()
            
            for (smsMessage in messages) {
                val sender = smsMessage.displayOriginatingAddress ?: ""
                val senderLower = sender.lowercase()
                val body = smsMessage.messageBody ?: ""
                val bodyLower = body.lowercase()
                val timestamp = smsMessage.timestampMillis
                
                // LOG EVERY SMS FOR DEBUGGING
                Log.i(TAG, "╔═══════════════════════════════════════════════════╗")
                Log.i(TAG, "║          📱 SMS MESSAGE RECEIVED                  ║")
                Log.i(TAG, "╠═══════════════════════════════════════════════════╣")
                Log.i(TAG, "║ Sender: '$sender'")
                Log.i(TAG, "║ Body length: ${body.length} chars")
                Log.i(TAG, "║ Body preview: ${body.take(100)}...")
                Log.i(TAG, "╚═══════════════════════════════════════════════════╝")
                
                // FOR DEBUGGING: Process ANY SMS that contains "GHS" or comes from MoMo-like sender
                val containsGHS = bodyLower.contains("ghs") || bodyLower.contains("ghc")
                val containsMoMoKeywords = bodyLower.contains("momo") || bodyLower.contains("mobile money") || bodyLower.contains("received")
                val isMoMo = isMoMoSender(senderLower)
                
                Log.i(TAG, "🔍 Analysis: containsGHS=$containsGHS, containsMoMoKeywords=$containsMoMoKeywords, isMoMoSender=$isMoMo")
                
                // Process if ANY of these are true (for debugging purposes)
                if (containsGHS || containsMoMoKeywords || isMoMo) {
                    Log.i(TAG, "✅ PROCESSING this SMS (matched criteria)")
                    momoMessages.add(Triple(sender, body, timestamp))
                } else {
                    Log.i(TAG, "⏭️ SKIPPING - no match criteria")
                }
            }
            
            if (momoMessages.isEmpty()) {
                Log.d(TAG, "No MoMo messages found in this batch")
                releaseAndFinish(wakeLock, pendingResult)
                return
            }
            
            // Process all MoMo messages
            Log.i(TAG, "Processing ${momoMessages.size} MoMo message(s)")
            processMoMoMessages(context, momoMessages, pendingResult, wakeLock)
            
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error processing SMS batch", e)
            releaseAndFinish(wakeLock, pendingResult)
        }
    }
    
    private fun releaseAndFinish(wakeLock: PowerManager.WakeLock, pendingResult: PendingResult) {
        try {
            if (wakeLock.isHeld) {
                wakeLock.release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing wake lock", e)
        }
        pendingResult.finish()
    }
    
    private fun ensureServiceRunning(context: Context) {
        try {
            val serviceIntent = Intent(context, SmsListenerService::class.java)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            Log.d(TAG, "Ensured service is running")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start service", e)
        }
    }
    
    /**
     * Validate if sender is an authorized MoMo sender
     * This is the first line of defense against processing non-MoMo SMS
     */
    private fun isMoMoSender(sender: String): Boolean {
        val lowerSender = sender.lowercase().trim()
        val isValid = MOMO_SENDERS.any { lowerSender.contains(it) }
        if (isValid) {
            Log.i(TAG, "✅ Valid MoMo sender: $sender")
        }
        return isValid
    }
    
    /**
     * Additional validation: Check if message content looks like a MoMo deposit
     * This provides defense-in-depth against spoofed sender IDs
     */
    private fun isValidMoMoDepositMessage(body: String): Boolean {
        val lowerBody = body.lowercase()
        
        // Must NOT contain non-deposit keywords
        if (NON_DEPOSIT_KEYWORDS.any { lowerBody.contains(it) }) {
            Log.d(TAG, "Message contains non-deposit keywords, skipping")
            return false
        }
        
        // Must contain at least one deposit keyword
        val hasDepositKeyword = DEPOSIT_KEYWORDS.any { lowerBody.contains(it) }
        if (!hasDepositKeyword) {
            Log.d(TAG, "Message missing deposit keywords")
            return false
        }
        
        // Must contain an amount (GHS followed by numbers)
        val hasAmount = lowerBody.contains(Regex("gh[sc]\\s*[\\d,]+")) || 
                        lowerBody.contains(Regex("[\\d,]+\\.?\\d*\\s*gh[sc]"))
        if (!hasAmount) {
            Log.d(TAG, "Message missing amount pattern")
            return false
        }
        
        Log.i(TAG, "✅ Valid MoMo deposit message format")
        return true
    }
    
    /**
     * Process multiple MoMo messages asynchronously
     * Key principle: Queue all to database FAST, then process - never block receiver
     */
    private fun processMoMoMessages(
        context: Context, 
        messages: List<Triple<String, String, Long>>,
        pendingResult: PendingResult,
        wakeLock: PowerManager.WakeLock
    ) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                for ((index, msgData) in messages.withIndex()) {
                    val (sender, body, timestamp) = msgData
                    Log.i(TAG, "Processing message ${index + 1}/${messages.size}")
                    
                    try {
                        // Parse the MoMo message
                        val transaction = MoMoParser.parse(body, sender, timestamp)
                        
                        if (transaction != null) {
                            Log.i(TAG, "✅ Parsed: ID=${transaction.transactionId}, Amount=${transaction.amount}")
                            SmsListenerService.processTransaction(context, transaction)
                        } else {
                            Log.w(TAG, "⚠️ Could not parse MoMo message, logging for review")
                            SmsListenerService.logUnparsedSms(context, sender, body, timestamp)
                        }
                    } catch (e: Exception) {
                        // Log but continue with next message - don't let one failure stop others
                        Log.e(TAG, "❌ Error processing message ${index + 1}, continuing with next", e)
                    }
                }
                Log.i(TAG, "✅ Finished processing ${messages.size} message(s)")
            } catch (e: Exception) {
                Log.e(TAG, "❌ Fatal error in processMoMoMessages", e)
            } finally {
                // Always release resources when done
                releaseAndFinish(wakeLock, pendingResult)
                Log.d(TAG, "Released wake lock and finished pending result")
            }
        }
    }
}
