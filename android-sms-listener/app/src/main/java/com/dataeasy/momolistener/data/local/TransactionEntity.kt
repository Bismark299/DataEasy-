package com.dataeasy.momolistener.data.local

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Room Entity for Transaction
 * 
 * CRITICAL: transactionId has UNIQUE index
 * This prevents duplicate processing
 */
@Entity(
    tableName = "transactions",
    indices = [
        Index(value = ["transactionId"], unique = true),
        Index(value = ["status"])
    ]
)
data class TransactionEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    
    /** MoMo Transaction ID - UNIQUE constraint prevents duplicates */
    val transactionId: String,
    
    /** Amount in GHS */
    val amount: Double,
    
    /** Sender's name from MoMo */
    val senderName: String,
    
    /** Sender's phone (if available) */
    val senderPhone: String?,
    
    /** Reference/Agent Code (BT-XXXX) */
    val reference: String?,
    
    /** Original SMS body */
    val rawMessage: String,
    
    /** SMS sender address (MobileMoney) */
    val smsSender: String,
    
    /** When SMS was received (millis) */
    val receivedAt: Long,
    
    /** Current status: PENDING, PROCESSING, SUCCESS, FAILED */
    val status: String = "PENDING",
    
    /** Number of upload attempts */
    val retryCount: Int = 0,
    
    /** Last error message if failed */
    val lastError: String? = null,
    
    /** Server's response message */
    val serverResponse: String? = null,
    
    /** When successfully processed (millis) */
    val processedAt: Long? = null,
    
    /** When record was created */
    val createdAt: Long = System.currentTimeMillis()
)
