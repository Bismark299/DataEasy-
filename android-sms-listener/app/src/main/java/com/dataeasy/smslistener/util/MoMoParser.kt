package com.dataeasy.smslistener.util

import android.util.Log
import com.dataeasy.smslistener.data.MoMoTransaction
import java.util.regex.Pattern

/**
 * MoMo SMS Parser
 * 
 * Parses MoMo SMS messages to extract:
 * - Transaction ID
 * - Amount received
 * - Sender phone number
 * - Reference/Message (used for username matching)
 * 
 * Sample MoMo SMS formats:
 * 
 * MTN Ghana Format 1:
 * "You have received GHS 50.00 from 0241234567. Transaction ID: 123456789012. Your new balance is GHS 100.00"
 * 
 * MTN Ghana Format 2:
 * "Cash In of GHS 100.00 received from 0551234567. Ref: username123. Trans ID: 987654321012. Balance: GHS 200.00"
 * 
 * Telecel Ghana:
 * "You have received GHS 25.00 from 0201234567. Reference: myusername. ID: TXN123456789"
 * 
 * AirtelTigo:
 * "Deposit of GHS 75.00 received from 0271234567 with message: testuser. Transaction ID: AT123456789"
 */
object MoMoParser {
    
    private const val TAG = "MoMoParser"
    
    // Regex patterns for different MoMo message formats
    
    // Amount patterns: "GHS 50.00", "GHS50.00", "GHC 50.00", "50.00 GHS"
    private val AMOUNT_PATTERNS = listOf(
        Pattern.compile("GH[SC]\\s*([\\d,]+\\.?\\d*)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("([\\d,]+\\.?\\d*)\\s*GH[SC]", Pattern.CASE_INSENSITIVE),
        Pattern.compile("received\\s+([\\d,]+\\.?\\d*)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("of\\s+([\\d,]+\\.?\\d*)", Pattern.CASE_INSENSITIVE)
    )
    
    // Transaction ID patterns
    private val TRANSACTION_ID_PATTERNS = listOf(
        Pattern.compile("Trans(?:action)?\\s*(?:ID)?[:\\s]+([A-Za-z0-9]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("ID[:\\s]+([A-Za-z0-9]{8,})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("Ref(?:erence)?[:\\s]+([A-Za-z0-9]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("TXN[:\\s]*([A-Za-z0-9]+)", Pattern.CASE_INSENSITIVE)
    )
    
    // Sender phone number patterns (Ghana formats)
    private val PHONE_PATTERNS = listOf(
        Pattern.compile("from\\s+(\\+?233[0-9]{9}|0[0-9]{9})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(\\+?233[0-9]{9}|0[235][0-9]{8})"),
        Pattern.compile("from\\s+([0-9]{10,})", Pattern.CASE_INSENSITIVE)
    )
    
    // Reference/Message patterns (for username matching)
    private val REFERENCE_PATTERNS = listOf(
        Pattern.compile("Ref(?:erence)?[:\\s]+([\\w]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("message[:\\s]+([\\w]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("with\\s+message[:\\s]+([\\w]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("narration[:\\s]+([\\w]+)", Pattern.CASE_INSENSITIVE)
    )
    
    /**
     * Parse a MoMo SMS message
     * 
     * @param body The SMS body text
     * @param sender The SMS sender address
     * @param timestamp When the SMS was received
     * @return MoMoTransaction if parsing successful, null otherwise
     */
    fun parse(body: String, sender: String, timestamp: Long): MoMoTransaction? {
        Log.d(TAG, "Parsing SMS: $body")
        
        // Skip if this is clearly not a deposit (e.g., "You sent", "You paid", "Withdrawal")
        val lowerBody = body.lowercase()
        if (lowerBody.contains("you sent") || 
            lowerBody.contains("you paid") ||
            lowerBody.contains("you have sent") ||
            lowerBody.contains("withdrawal") ||
            lowerBody.contains("withdrawn") ||
            lowerBody.contains("deducted") ||
            lowerBody.contains("transferred to")) {
            Log.d(TAG, "Skipping non-deposit message")
            return null
        }
        
        // Must contain deposit keywords
        if (!lowerBody.contains("received") && 
            !lowerBody.contains("cash in") &&
            !lowerBody.contains("deposit") &&
            !lowerBody.contains("credited")) {
            Log.d(TAG, "No deposit keywords found")
            return null
        }
        
        // Extract amount
        val amount = extractAmount(body)
        if (amount == null || amount <= 0) {
            Log.w(TAG, "Could not extract valid amount")
            return null
        }
        
        // Extract transaction ID
        val transactionId = extractTransactionId(body)
        if (transactionId == null) {
            Log.w(TAG, "Could not extract transaction ID")
            return null
        }
        
        // Extract sender phone (optional but useful)
        val senderPhone = extractPhone(body)
        
        // Extract reference (USERNAME for matching)
        val reference = extractReference(body)
        
        return MoMoTransaction(
            transactionId = transactionId,
            amount = amount,
            senderPhone = senderPhone ?: "Unknown",
            reference = reference,
            rawMessage = body,
            smsSender = sender,
            receivedAt = timestamp,
            status = MoMoTransaction.Status.PENDING
        )
    }
    
    private fun extractAmount(body: String): Double? {
        for (pattern in AMOUNT_PATTERNS) {
            val matcher = pattern.matcher(body)
            if (matcher.find()) {
                val amountStr = matcher.group(1)?.replace(",", "") ?: continue
                try {
                    val amount = amountStr.toDouble()
                    if (amount > 0) {
                        Log.d(TAG, "Extracted amount: $amount")
                        return amount
                    }
                } catch (e: NumberFormatException) {
                    continue
                }
            }
        }
        return null
    }
    
    private fun extractTransactionId(body: String): String? {
        for (pattern in TRANSACTION_ID_PATTERNS) {
            val matcher = pattern.matcher(body)
            if (matcher.find()) {
                val id = matcher.group(1)
                if (id != null && id.length >= 6) {
                    Log.d(TAG, "Extracted transaction ID: $id")
                    return id
                }
            }
        }
        
        // Fallback: Look for any long alphanumeric string
        val fallbackPattern = Pattern.compile("\\b([A-Z0-9]{10,20})\\b")
        val matcher = fallbackPattern.matcher(body)
        if (matcher.find()) {
            return matcher.group(1)
        }
        
        return null
    }
    
    private fun extractPhone(body: String): String? {
        for (pattern in PHONE_PATTERNS) {
            val matcher = pattern.matcher(body)
            if (matcher.find()) {
                val phone = matcher.group(1)
                if (phone != null && phone.length >= 10) {
                    Log.d(TAG, "Extracted phone: $phone")
                    return normalizePhone(phone)
                }
            }
        }
        return null
    }
    
    private fun extractReference(body: String): String? {
        // PRIORITY 1: Look for Agent Code pattern (BT-XXXX)
        val agentCodePattern = Pattern.compile("\\b(BT-\\d{4})\\b", Pattern.CASE_INSENSITIVE)
        val agentMatcher = agentCodePattern.matcher(body)
        if (agentMatcher.find()) {
            val agentCode = agentMatcher.group(1)?.uppercase()
            if (agentCode != null) {
                Log.d(TAG, "Extracted agent code: $agentCode")
                return agentCode
            }
        }
        
        // PRIORITY 2: Try standard reference patterns
        for (pattern in REFERENCE_PATTERNS) {
            val matcher = pattern.matcher(body)
            if (matcher.find()) {
                val ref = matcher.group(1)
                if (ref != null && ref.length >= 3) {
                    // Check if this ref contains an agent code
                    val innerAgentMatch = agentCodePattern.matcher(ref)
                    if (innerAgentMatch.find()) {
                        Log.d(TAG, "Extracted agent code from ref: ${innerAgentMatch.group(1)?.uppercase()}")
                        return innerAgentMatch.group(1)?.uppercase()
                    }
                    Log.d(TAG, "Extracted reference: $ref")
                    return ref
                }
            }
        }
        return null
    }
    
    /**
     * Normalize Ghana phone number to international format
     */
    private fun normalizePhone(phone: String): String {
        val cleaned = phone.replace(Regex("[^0-9]"), "")
        return when {
            cleaned.startsWith("233") -> "+$cleaned"
            cleaned.startsWith("0") -> "+233${cleaned.substring(1)}"
            else -> "+233$cleaned"
        }
    }
}
