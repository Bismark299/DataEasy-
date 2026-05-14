package com.dataeasy.momolistener.sms

import android.util.Log
import com.dataeasy.momolistener.domain.model.MoMoTransaction
import com.dataeasy.momolistener.domain.model.ParseResult
import com.dataeasy.momolistener.domain.model.TransactionStatus
import java.util.regex.Pattern

/**
 * SMS Parser - Pure Kotlin class
 * 
 * Responsibilities:
 * - Extract amount
 * - Extract transaction ID
 * - Extract sender name
 * - Extract reference (BT-XXXX)
 * - Validate MTN MoMo format
 * 
 * NO Android dependencies here.
 * This class is easily unit testable.
 * 
 * Expected MTN Ghana format:
 * "Payment received for GHS 1.00 from SYLVESTER KARIKARI  Current Balance: GHS 135.62 . 
 *  Available Balance: GHS 135.62. Reference: BT-2224. Transaction ID: 75785045813. 
 *  TRANSACTION FEE: 0.00"
 */
object SmsParser {
    
    private const val TAG = "SmsParser"
    
    // Valid MoMo sender addresses (lowercase for comparison)
    private val MOMO_SENDERS = setOf(
        "mobilemoney", "momo", "mtn", "mtnmomo", "mtn momo",
        "mobile money", "1515", "170", "mtn mobile money",
        "mpesa", "vodafone cash", "vodafonecash", "airtel money",
        "airtelmoney", "tigo cash", "tigocash", "at money", "atmoney"
    )
    
    // Keywords indicating a deposit (must contain at least one)
    private val DEPOSIT_KEYWORDS = setOf(
        "received", "payment received", "cash in", "credited"
    )
    
    // Keywords indicating NOT a deposit (reject if contains)
    private val REJECT_KEYWORDS = setOf(
        "you sent", "you paid", "you have sent", "withdrawal", "withdrawn",
        "deducted", "transferred to", "payment to", "airtime", "data bundle",
        "purchased", "you bought"
    )
    
    // ==================== REGEX PATTERNS ====================
    
    // Amount: "for GHS 1.00" or "GHS 50.00"
    private val AMOUNT_PATTERN = Pattern.compile(
        "(?:for\\s+)?GH[SC]\\s*([\\d,]+\\.\\d{2})",
        Pattern.CASE_INSENSITIVE
    )
    
    // Transaction ID: "Transaction ID: 75785045813"
    private val TXN_ID_PATTERN = Pattern.compile(
        "Transaction\\s*ID[:\\s]+([\\d]{8,15})",
        Pattern.CASE_INSENSITIVE
    )
    
    // Alternative Transaction ID: "ID: XXXXX"
    private val TXN_ID_ALT_PATTERN = Pattern.compile(
        "\\bID[:\\s]+([\\dA-Za-z]{8,20})\\b",
        Pattern.CASE_INSENSITIVE
    )
    
    // Sender name: "from SYLVESTER KARIKARI  Current"
    private val SENDER_NAME_PATTERN = Pattern.compile(
        "from\\s+([A-Z][A-Za-z\\s]+?)\\s{2,}",
        Pattern.CASE_INSENSITIVE
    )
    
    // Alternative sender: "from NAME Current Balance"
    private val SENDER_NAME_ALT_PATTERN = Pattern.compile(
        "from\\s+([A-Z][A-Za-z\\s]+?)\\s+Current",
        Pattern.CASE_INSENSITIVE
    )
    
    // Reference: "Reference: BT-2224"
    private val REFERENCE_PATTERN = Pattern.compile(
        "Reference[:\\s]+([\\w-]+)",
        Pattern.CASE_INSENSITIVE
    )
    
    // Agent Code: "BT-2224" anywhere in message
    private val AGENT_CODE_PATTERN = Pattern.compile(
        "\\b(BT-?\\d{4})\\b",
        Pattern.CASE_INSENSITIVE
    )
    
    // ==================== MAIN PARSE FUNCTION ====================
    
    /**
     * Parse SMS into MoMoTransaction
     * 
     * @param sender SMS sender address (e.g., "MobileMoney")
     * @param body SMS body text
     * @param timestamp When SMS was received
     * @return ParseResult.Success with transaction, or appropriate error
     */
    fun parse(sender: String, body: String, timestamp: Long): ParseResult {
        Log.d(TAG, "Parsing SMS from: $sender")
        
        // Step 1: Validate sender OR content looks like MoMo
        val isKnownSender = isMoMoSender(sender)
        val contentLooksMoMo = looksLikeMoMoDeposit(body)
        
        if (!isKnownSender && !contentLooksMoMo) {
            Log.d(TAG, "Not a MoMo message - sender: $sender, content check: $contentLooksMoMo")
            return ParseResult.NotMoMoMessage(sender)
        }
        
        if (!isKnownSender && contentLooksMoMo) {
            Log.i(TAG, "Unknown sender '$sender' but content looks like MoMo - processing anyway")
        }
        
        val lowerBody = body.lowercase()
        
        // Step 2: Check for reject keywords (not a deposit)
        for (keyword in REJECT_KEYWORDS) {
            if (lowerBody.contains(keyword)) {
                Log.d(TAG, "Rejected: contains '$keyword'")
                return ParseResult.InvalidFormat("Not a deposit (contains: $keyword)", body)
            }
        }
        
        // Step 3: Check for deposit keywords
        val hasDepositKeyword = DEPOSIT_KEYWORDS.any { lowerBody.contains(it) }
        if (!hasDepositKeyword) {
            Log.d(TAG, "Rejected: no deposit keywords found")
            return ParseResult.InvalidFormat("No deposit keywords", body)
        }
        
        // Step 4: Extract amount (REQUIRED)
        val amount = extractAmount(body)
        if (amount == null || amount <= 0) {
            Log.w(TAG, "Failed to extract amount")
            return ParseResult.InvalidFormat("Could not extract amount", body)
        }
        
        // Step 5: Extract transaction ID (REQUIRED for idempotency)
        val transactionId = extractTransactionId(body)
        if (transactionId == null) {
            Log.w(TAG, "Failed to extract transaction ID")
            return ParseResult.InvalidFormat("Could not extract transaction ID", body)
        }
        
        // Step 6: Extract sender name (optional, use sender as fallback)
        val senderName = extractSenderName(body) ?: sender
        
        // Step 7: Extract reference/agent code (optional but important)
        val reference = extractReference(body)
        
        Log.i(TAG, "✅ Parsed: Amount=$amount, TxnID=$transactionId, Ref=$reference")
        
        val transaction = MoMoTransaction(
            transactionId = transactionId,
            amount = amount,
            senderName = senderName,
            senderPhone = null,  // MTN shows names, not phones
            reference = reference,
            rawMessage = body,
            smsSender = sender,
            receivedAt = timestamp,
            status = TransactionStatus.PENDING
        )
        
        return ParseResult.Success(transaction)
    }
    
    // ==================== HELPER FUNCTIONS ====================
    
    private fun isMoMoSender(sender: String): Boolean {
        val lower = sender.lowercase().trim()
        // Check if sender matches known MoMo senders
        return MOMO_SENDERS.any { lower.contains(it) }
    }
    
    /**
     * Check if message CONTENT looks like a MoMo deposit
     * This is a fallback when sender doesn't match known list
     */
    private fun looksLikeMoMoDeposit(body: String): Boolean {
        val lower = body.lowercase()
        // Must have amount in GHS
        val hasAmount = lower.contains("ghs") || lower.contains("ghc")
        // Must have deposit indicator
        val hasDeposit = DEPOSIT_KEYWORDS.any { lower.contains(it) }
        // Must have transaction ID
        val hasTransactionId = lower.contains("transaction id") || lower.contains("transaction")
        
        return hasAmount && hasDeposit && hasTransactionId
    }
    
    private fun extractAmount(body: String): Double? {
        val matcher = AMOUNT_PATTERN.matcher(body)
        if (matcher.find()) {
            val amountStr = matcher.group(1)?.replace(",", "")
            return amountStr?.toDoubleOrNull()
        }
        return null
    }
    
    private fun extractTransactionId(body: String): String? {
        // Try primary pattern first
        var matcher = TXN_ID_PATTERN.matcher(body)
        if (matcher.find()) {
            return matcher.group(1)
        }
        
        // Try alternative pattern
        matcher = TXN_ID_ALT_PATTERN.matcher(body)
        if (matcher.find()) {
            val id = matcher.group(1)
            // Make sure it's at least 8 chars and not just "GHS" or similar
            if (id != null && id.length >= 8 && !id.contains("GH", ignoreCase = true)) {
                return id
            }
        }
        
        return null
    }
    
    private fun extractSenderName(body: String): String? {
        // Try primary pattern
        var matcher = SENDER_NAME_PATTERN.matcher(body)
        if (matcher.find()) {
            return matcher.group(1)?.trim()
        }
        
        // Try alternative pattern
        matcher = SENDER_NAME_ALT_PATTERN.matcher(body)
        if (matcher.find()) {
            return matcher.group(1)?.trim()
        }
        
        return null
    }
    
    private fun extractReference(body: String): String? {
        // First try explicit Reference field
        var matcher = REFERENCE_PATTERN.matcher(body)
        if (matcher.find()) {
            val ref = matcher.group(1)
            if (ref != null) {
                // Normalize agent code format
                return normalizeAgentCode(ref)
            }
        }
        
        // Fallback: look for BT-XXXX pattern anywhere
        matcher = AGENT_CODE_PATTERN.matcher(body)
        if (matcher.find()) {
            return normalizeAgentCode(matcher.group(1))
        }
        
        return null
    }
    
    /**
     * Normalize agent code to BT-XXXX format
     */
    private fun normalizeAgentCode(code: String?): String? {
        if (code == null) return null
        
        val upper = code.uppercase()
        
        // Already correct format
        if (upper.matches(Regex("BT-\\d{4}"))) {
            return upper
        }
        
        // Missing hyphen: "BT1234" → "BT-1234"
        if (upper.matches(Regex("BT\\d{4}"))) {
            return "BT-${upper.substring(2)}"
        }
        
        // Return as-is if not an agent code
        return upper
    }
}
