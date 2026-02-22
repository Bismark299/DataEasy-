package com.dataeasy.smslistener.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.Index

/**
 * MoMo Transaction Entity
 * Stored locally for offline queuing and retry logic
 */
@Entity(
    tableName = "momo_transactions",
    indices = [Index(value = ["transactionId"], unique = true)]
)
data class MoMoTransaction(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    
    /** MoMo Transaction ID (unique identifier from MoMo) */
    val transactionId: String,
    
    /** Amount received in GHS */
    val amount: Double,
    
    /** Phone number that sent the money */
    val senderPhone: String,
    
    /** Reference/message (should contain username) */
    val reference: String?,
    
    /** Original SMS body */
    val rawMessage: String,
    
    /** SMS sender (e.g., "MobileMoney") */
    val smsSender: String,
    
    /** Timestamp when SMS was received */
    val receivedAt: Long,
    
    /** Processing status */
    val status: Status = Status.PENDING,
    
    /** Server response message */
    val serverResponse: String? = null,
    
    /** Number of send attempts */
    val retryCount: Int = 0,
    
    /** Last attempt timestamp */
    val lastAttemptAt: Long? = null,
    
    /** When successfully sent to server */
    val sentAt: Long? = null
) {
    enum class Status {
        PENDING,      // Not yet sent to server
        SENDING,      // Currently being sent
        SENT,         // Successfully sent to server
        FAILED,       // Failed to send (will retry)
        ERROR         // Permanent error (won't retry)
    }
}

/**
 * Unparsed SMS log (for debugging)
 */
@Entity(tableName = "unparsed_sms")
data class UnparsedSms(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val sender: String,
    val body: String,
    val receivedAt: Long
)
