package com.dataeasy.momolistener.domain.model

/**
 * Transaction Status State Machine
 * 
 * Flow:
 * SMS received → PENDING
 * Worker starts → PROCESSING  
 * API 200 OK → SUCCESS
 * API error → retry (stays PROCESSING or back to PENDING)
 * Retry > limit → FAILED
 */
enum class TransactionStatus {
    PENDING,      // Saved locally, waiting for upload
    PROCESSING,   // Currently being uploaded
    SUCCESS,      // Successfully sent to server
    FAILED        // Max retries exceeded, permanent failure
}

/**
 * Domain model for MoMo Transaction
 * This is the clean domain representation
 */
data class MoMoTransaction(
    val id: Long = 0,
    val transactionId: String,      // MoMo's unique ID (for idempotency)
    val amount: Double,
    val senderName: String,         // "SYLVESTER KARIKARI"
    val senderPhone: String?,       // Phone if available
    val reference: String?,         // Agent code: "BT-2224"
    val rawMessage: String,         // Original SMS text
    val smsSender: String,          // "MobileMoney"
    val receivedAt: Long,           // When SMS was received
    val status: TransactionStatus = TransactionStatus.PENDING,
    val retryCount: Int = 0,
    val lastError: String? = null,
    val serverResponse: String? = null,
    val processedAt: Long? = null   // When successfully processed
)
