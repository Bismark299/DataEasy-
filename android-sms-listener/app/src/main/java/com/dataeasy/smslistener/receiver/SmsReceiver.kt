package com.dataeasy.smslistener.receiver

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.provider.Telephony
import android.util.Log
import androidx.core.app.NotificationCompat
import com.dataeasy.smslistener.MoMoListenerApp
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
        
        // Show DEBUG notification for ANY broadcast (to verify receiver is working)
        showDebugNotification(context, "Broadcast received: ${intent.action}")
        
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            Log.d(TAG, "Ignoring non-SMS intent")
            return
        }
        
        Log.i(TAG, "✅ SMS_RECEIVED_ACTION - Processing...")
        
        // Show notification that SMS was detected
        showDebugNotification(context, "SMS Detected! Processing...")
        
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
                val body = smsMessage.messageBody ?: ""
                val timestamp = smsMessage.timestampMillis
                
                // LOG EVERY SMS
                Log.i(TAG, "╔═══════════════════════════════════════════════════╗")
                Log.i(TAG, "║          📱 SMS MESSAGE RECEIVED                  ║")
                Log.i(TAG, "╠═══════════════════════════════════════════════════╣")
                Log.i(TAG, "║ Sender: '$sender'")
                Log.i(TAG, "║ Body: ${body.take(150)}")
                Log.i(TAG, "╚═══════════════════════════════════════════════════╝")
                
                // Show notification for EVERY SMS (for debugging)
                showDebugNotification(context, "SMS from: $sender")
                
                // PROCESS ALL SMS FOR NOW (no filtering) - we'll add filters back later
                Log.i(TAG, "✅ Adding to process queue")
                momoMessages.add(Triple(sender, body, timestamp))
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
                        // Show message preview in notification
                        showDebugNotification(context, "MSG: ${body.take(60)}...")
                        
                        // Extract fields using simple reliable patterns
                        val amount = extractAmountSimple(body) ?: 0.0
                        val transactionId = extractTransactionIdSimple(body) ?: "AUTO${timestamp}"
                        val reference = extractReferenceSimple(body)
                        val senderName = extractSenderSimple(body) ?: sender
                        
                        Log.i(TAG, "✅ Extracted: Amount=$amount, TxnID=$transactionId, Ref=$reference, Sender=$senderName")
                        
                        // Create transaction
                        val transaction = MoMoTransaction(
                            transactionId = transactionId,
                            amount = amount,
                            senderPhone = senderName,
                            reference = reference,
                            rawMessage = body,
                            smsSender = sender,
                            receivedAt = timestamp,
                            status = MoMoTransaction.Status.PENDING
                        )
                        
                        showDebugNotification(context, "💾 GHS $amount | ${reference ?: "No ref"} | ID:${transactionId.take(8)}...")
                        
                        // Save and send to server
                        SmsListenerService.processTransaction(context, transaction)
                        showDebugNotification(context, "📤 Sending to server...")
                        
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
    
    /**
     * Show a debug notification to verify receiver is working
     * This helps diagnose if the broadcast receiver is being triggered at all
     */
    private fun showDebugNotification(context: Context, message: String) {
        try {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            
            val notification = NotificationCompat.Builder(context, MoMoListenerApp.ALERT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("📨 MoMo Listener Debug")
                .setContentText(message)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .build()
            
            // Use timestamp as unique ID so multiple notifications can show
            notificationManager.notify(System.currentTimeMillis().toInt(), notification)
            Log.i(TAG, "Debug notification shown: $message")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to show debug notification", e)
        }
    }
    
    /**
     * Simple amount extraction - find "GHS X.XX" or "for GHS X.XX"
     * Based on: /(\d+(\.\d+)?)/
     */
    private fun extractAmountSimple(body: String): Double? {
        // Best: "for GHS 1.00" or "GHS 1.00"
        val ghsPattern = Regex("GH[SC]\\s*([\\d,]+\\.\\d{2})", RegexOption.IGNORE_CASE)
        ghsPattern.find(body)?.let { match ->
            val amountStr = match.groupValues[1].replace(",", "")
            try {
                return amountStr.toDouble()
            } catch (e: Exception) { }
        }
        
        // Fallback: any decimal number (like Node.js example)
        val simplePattern = Regex("(\\d+\\.\\d{2})")
        simplePattern.find(body)?.let { match ->
            try {
                return match.groupValues[1].toDouble()
            } catch (e: Exception) { }
        }
        
        return null
    }
    
    /**
     * Simple transaction ID extraction
     * Based on: /ID[:\s]?(\w+)/i
     */
    private fun extractTransactionIdSimple(body: String): String? {
        // MTN format: "Transaction ID: 75785045813"
        val txnPattern = Regex("Transaction\\s*ID[:\\s]+([\\w]+)", RegexOption.IGNORE_CASE)
        txnPattern.find(body)?.let { match ->
            return match.groupValues[1]
        }
        
        // Fallback: "ID: XXXXX" or "ID:XXXXX"
        val idPattern = Regex("ID[:\\s]+([\\w]{8,})", RegexOption.IGNORE_CASE)
        idPattern.find(body)?.let { match ->
            return match.groupValues[1]
        }
        
        return null
    }
    
    /**
     * Simple reference extraction - look for BT-XXXX pattern
     */
    private fun extractReferenceSimple(body: String): String? {
        // "Reference: BT-2224"
        val refPattern = Regex("Reference[:\\s]+([\\w-]+)", RegexOption.IGNORE_CASE)
        refPattern.find(body)?.let { match ->
            val ref = match.groupValues[1]
            // Check if it's an agent code
            if (ref.uppercase().startsWith("BT")) {
                return ref.uppercase()
            }
            return ref
        }
        
        // Direct BT-XXXX pattern anywhere in message
        val btPattern = Regex("\\b(BT-?\\d{4})\\b", RegexOption.IGNORE_CASE)
        btPattern.find(body)?.let { match ->
            val code = match.groupValues[1].uppercase()
            // Normalize to BT-XXXX format
            return if (code.contains("-")) code else "BT-${code.substring(2)}"
        }
        
        return null
    }
    
    /**
     * Extract sender name from "from NAME  Current" pattern
     */
    private fun extractSenderSimple(body: String): String? {
        // "from SYLVESTER KARIKARI  Current Balance"
        val namePattern = Regex("from\\s+([A-Z][A-Za-z\\s]+?)\\s{2,}", RegexOption.IGNORE_CASE)
        namePattern.find(body)?.let { match ->
            return match.groupValues[1].trim()
        }
        
        // "from NAME Current Balance"
        val namePattern2 = Regex("from\\s+([A-Z][A-Za-z\\s]+?)\\s+Current", RegexOption.IGNORE_CASE)
        namePattern2.find(body)?.let { match ->
            return match.groupValues[1].trim()
        }
        
        return null
    }
}
