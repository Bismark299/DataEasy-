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
 * - Reference/Message (used for username matching via Agent Code BT-XXXX)
 * 
 * ===== SUPPORTED MTN GHANA MOMO FORMATS =====
 * 
 * Format 1 (Standard Receive Money):
 * "You have received GHS 50.00 from 0241234567. Transaction ID: 123456789012. Your new balance is GHS 100.00"
 * 
 * Format 2 (Cash In with Reference):
 * "Cash In of GHS 100.00 received from 0551234567. Ref: BT-1234. Trans ID: 987654321012. Balance: GHS 200.00"
 * 
 * Format 3 (Agent Deposit):
 * "You have received GHS 75.00 from Agent 0241234567.Ref:BT-5678.TxnID:MTN123456789.Bal:GHS150.00"
 * 
 * Format 4 (Merchant Payment Received):
 * "Payment of GHS 30.00 received from 0551112222. Message: BT-9999. ID: PAY987654321"
 * 
 * Format 5 (International Format):
 * "You have received GHS 200.00 from +233241234567. Reference: BT-0001. Transaction ID: INT123456789"
 * 
 * Format 6 (Short Format):
 * "Received GHS50.00 from 0241234567. ID:123456789012"
 * 
 * Format 7 (Credit Alert):
 * "Credit Alert: GHS 100.00 credited to your wallet from 0551234567. Narration: BT-1111. Ref: TXN123456"
 * 
 * ===== AGENT CODE MATCHING =====
 * Users add their Agent Code (BT-XXXX) as the reference/message when sending
 * This allows automatic matching of deposits to user accounts
 */
object MoMoParser {
    
    private const val TAG = "MoMoParser"
    
    // ========== REGEX PATTERNS FOR DATA EXTRACTION ==========
    
    // Amount patterns: "GHS 50.00", "GHS50.00", "GHC 50.00", "50.00 GHS"
    private val AMOUNT_PATTERNS = listOf(
        Pattern.compile("GH[SC]\\s*([\\d,]+\\.?\\d*)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("([\\d,]+\\.?\\d*)\\s*GH[SC]", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:received|credited|of)\\s+([\\d,]+\\.\\d{2})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:GH[SC])?\\s*([\\d]{1,3}(?:,?\\d{3})*\\.\\d{2})\\s*(?:GH[SC])?", Pattern.CASE_INSENSITIVE)
    )
    
    // Transaction ID patterns (various MTN formats)
    private val TRANSACTION_ID_PATTERNS = listOf(
        // Standard formats
        Pattern.compile("Trans(?:action)?\\s*(?:ID)?[:\\s]*([A-Za-z0-9]{8,20})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("TxnID[:\\s]*([A-Za-z0-9]{8,20})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("Txn\\s*ID[:\\s]*([A-Za-z0-9]{8,20})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("\\bID[:\\s]+([A-Za-z0-9]{10,20})\\b", Pattern.CASE_INSENSITIVE),
        // Short formats
        Pattern.compile("ID:([A-Za-z0-9]{10,20})", Pattern.CASE_INSENSITIVE),
        // With prefixes
        Pattern.compile("(MTN[A-Za-z0-9]{10,15})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(PAY[A-Za-z0-9]{10,15})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(TXN[A-Za-z0-9]{10,15})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(INT[A-Za-z0-9]{10,15})", Pattern.CASE_INSENSITIVE)
    )
    
    // Sender phone number patterns (Ghana formats: 024, 054, 055, 059, etc.)
    private val PHONE_PATTERNS = listOf(
        Pattern.compile("from\\s+(\\+?233[0-9]{9})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("from\\s+(0[235][0-9]{8})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("from\\s+Agent\\s+(0[235][0-9]{8})", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(\\+233[0-9]{9})"),
        Pattern.compile("\\b(0[235][0-9]{8})\\b")
    )
    
    // Reference/Message patterns (for Agent Code BT-XXXX matching)
    private val REFERENCE_PATTERNS = listOf(
        // Agent Code is highest priority
        Pattern.compile("\\b(BT-\\d{4})\\b", Pattern.CASE_INSENSITIVE),
        // Reference variations
        Pattern.compile("Ref[:\\s]+([\\w-]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("Reference[:\\s]+([\\w-]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("Message[:\\s]+([\\w-]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("Narration[:\\s]+([\\w-]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("with\\s+message[:\\s]+([\\w-]+)", Pattern.CASE_INSENSITIVE),
        // Short formats (no space after colon)
        Pattern.compile("Ref:([\\w-]+)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("Msg:([\\w-]+)", Pattern.CASE_INSENSITIVE)
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
        Log.i(TAG, "========== PARSING MOMO SMS ==========")
        Log.d(TAG, "Body: $body")
        Log.d(TAG, "Sender: $sender")
        
        val lowerBody = body.lowercase()
        
        // ===== STEP 1: Validate this is a deposit message =====
        // Skip if this is clearly not a deposit (outgoing transaction)
        val nonDepositKeywords = listOf(
            "you sent", "you paid", "you have sent", "withdrawal", "withdrawn",
            "deducted", "transferred to", "payment to", "airtime", "data bundle"
        )
        if (nonDepositKeywords.any { lowerBody.contains(it) }) {
            Log.i(TAG, "❌ REJECTED: Contains non-deposit keywords")
            return null
        }
        
        // Must contain deposit keywords
        val depositKeywords = listOf("received", "cash in", "deposit", "credited", "credit alert")
        if (!depositKeywords.any { lowerBody.contains(it) }) {
            Log.i(TAG, "❌ REJECTED: No deposit keywords found")
            return null
        }
        
        // ===== STEP 2: Extract Amount (REQUIRED) =====
        val amount = extractAmount(body)
        if (amount == null || amount <= 0) {
            Log.w(TAG, "❌ REJECTED: Could not extract valid amount")
            return null
        }
        Log.i(TAG, "✅ Amount: GHS ${"%.2f".format(amount)}")
        
        // ===== STEP 3: Extract Transaction ID (generate if not found) =====
        var transactionId = extractTransactionId(body)
        if (transactionId == null) {
            // Generate a fallback transaction ID from timestamp + partial hash
            transactionId = "AUTO${timestamp}${body.hashCode().toString().takeLast(4)}"
            Log.w(TAG, "⚠️ No transaction ID found, generated: $transactionId")
        } else {
            Log.i(TAG, "✅ Transaction ID: $transactionId")
        }
        
        // ===== STEP 4: Extract Sender Phone (OPTIONAL) =====
        val senderPhone = extractPhone(body) ?: "Unknown"
        Log.i(TAG, "ℹ️ Sender Phone: $senderPhone")
        
        // ===== STEP 5: Extract Reference/Agent Code (CRITICAL for user matching) =====
        val reference = extractReference(body)
        if (reference != null) {
            Log.i(TAG, "✅ Reference/Agent Code: $reference")
        } else {
            Log.w(TAG, "⚠️ No reference found - will need manual matching")
        }
        
        Log.i(TAG, "========== PARSE SUCCESS ==========")
        
        return MoMoTransaction(
            transactionId = transactionId,
            amount = amount,
            senderPhone = senderPhone,
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
        // ===== PRIORITY 1: Look for Agent Code pattern (BT-XXXX) anywhere in message =====
        // This is the MOST IMPORTANT extraction for automatic user matching
        val agentCodePatterns = listOf(
            Pattern.compile("\\b(BT-\\d{4})\\b", Pattern.CASE_INSENSITIVE),
            Pattern.compile("(BT\\d{4})", Pattern.CASE_INSENSITIVE),  // Without hyphen
            Pattern.compile("\\b(BT[-_]?\\d{4})\\b", Pattern.CASE_INSENSITIVE)  // With hyphen or underscore
        )
        
        for (pattern in agentCodePatterns) {
            val matcher = pattern.matcher(body)
            if (matcher.find()) {
                var agentCode = matcher.group(1)?.uppercase() ?: continue
                // Normalize: ensure format is BT-XXXX
                if (!agentCode.contains("-")) {
                    agentCode = "BT-${agentCode.substring(2)}"
                }
                Log.i(TAG, "✅ Found Agent Code: $agentCode")
                return agentCode
            }
        }
        
        // ===== PRIORITY 2: Try standard reference patterns =====
        for (pattern in REFERENCE_PATTERNS) {
            val matcher = pattern.matcher(body)
            if (matcher.find()) {
                val ref = matcher.group(1)?.trim()
                if (ref != null && ref.length >= 3) {
                    // Check if this ref contains an agent code
                    for (agentPattern in agentCodePatterns) {
                        val innerMatcher = agentPattern.matcher(ref)
                        if (innerMatcher.find()) {
                            var agentCode = innerMatcher.group(1)?.uppercase() ?: continue
                            if (!agentCode.contains("-")) {
                                agentCode = "BT-${agentCode.substring(2)}"
                            }
                            Log.i(TAG, "✅ Found Agent Code in reference: $agentCode")
                            return agentCode
                        }
                    }
                    // Return the reference as-is if no agent code found
                    Log.d(TAG, "Found reference (no agent code): $ref")
                    return ref
                }
            }
        }
        
        Log.d(TAG, "No reference/agent code found in message")
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
