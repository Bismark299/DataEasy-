package com.dataeasy.momolistener.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

/**
 * Data Access Object for Transactions
 * All database operations go through here
 */
@Dao
interface TransactionDao {
    
    // ==================== QUERIES ====================
    
    /** Get all transactions ordered by received time (newest first) */
    @Query("SELECT * FROM transactions ORDER BY receivedAt DESC")
    fun getAllTransactions(): Flow<List<TransactionEntity>>
    
    /** Get transactions by status */
    @Query("SELECT * FROM transactions WHERE status = :status ORDER BY receivedAt ASC")
    suspend fun getByStatus(status: String): List<TransactionEntity>
    
    /** Get pending and processing transactions for upload */
    @Query("SELECT * FROM transactions WHERE status IN ('PENDING', 'PROCESSING') ORDER BY receivedAt ASC LIMIT 20")
    suspend fun getPendingForUpload(): List<TransactionEntity>
    
    /** Check if transaction exists (for duplicate detection) */
    @Query("SELECT COUNT(*) FROM transactions WHERE transactionId = :txnId")
    suspend fun existsByTransactionId(txnId: String): Int
    
    /** Get transaction by MoMo transaction ID */
    @Query("SELECT * FROM transactions WHERE transactionId = :txnId LIMIT 1")
    suspend fun getByTransactionId(txnId: String): TransactionEntity?
    
    /** Count by status */
    @Query("SELECT COUNT(*) FROM transactions WHERE status = :status")
    suspend fun countByStatus(status: String): Int
    
    /** Get counts for dashboard */
    @Query("SELECT status, COUNT(*) as count FROM transactions GROUP BY status")
    suspend fun getStatusCounts(): List<StatusCount>
    
    // ==================== INSERTS ====================
    
    /** Insert new transaction. Returns -1 if duplicate (IGNORE strategy) */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(entity: TransactionEntity): Long
    
    // ==================== UPDATES ====================
    
    /** Mark as PROCESSING when upload starts */
    @Query("UPDATE transactions SET status = 'PROCESSING' WHERE id = :id AND status = 'PENDING'")
    suspend fun markProcessing(id: Long): Int
    
    /** Mark as SUCCESS after successful upload */
    @Query("""
        UPDATE transactions 
        SET status = 'SUCCESS', 
            serverResponse = :response, 
            processedAt = :processedAt,
            lastError = NULL
        WHERE id = :id
    """)
    suspend fun markSuccess(id: Long, response: String?, processedAt: Long)
    
    /** Mark as FAILED with error (increment retry count) */
    @Query("""
        UPDATE transactions 
        SET status = CASE WHEN retryCount >= :maxRetries THEN 'FAILED' ELSE 'PENDING' END,
            retryCount = retryCount + 1,
            lastError = :error
        WHERE id = :id
    """)
    suspend fun markRetryOrFailed(id: Long, error: String, maxRetries: Int)
    
    /** Force mark as FAILED (manual or max retries) */
    @Query("UPDATE transactions SET status = 'FAILED', lastError = :error WHERE id = :id")
    suspend fun markFailed(id: Long, error: String)
    
    /** Reset to PENDING (for manual retry) */
    @Query("UPDATE transactions SET status = 'PENDING', retryCount = 0, lastError = NULL WHERE id = :id")
    suspend fun resetToPending(id: Long)
    
    /** Reset ALL failed transactions to PENDING (for retry all) */
    @Query("UPDATE transactions SET status = 'PENDING', retryCount = 0, lastError = NULL WHERE status = 'FAILED'")
    suspend fun resetAllFailedToPending(): Int
    
    // ==================== DELETES ====================
    
    /** Delete old successful transactions (cleanup) */
    @Query("DELETE FROM transactions WHERE status = 'SUCCESS' AND processedAt < :beforeTime")
    suspend fun deleteOldSuccessful(beforeTime: Long): Int
    
    /** Delete by ID */
    @Query("DELETE FROM transactions WHERE id = :id")
    suspend fun deleteById(id: Long)
}

/** Helper class for status counts */
data class StatusCount(
    val status: String,
    val count: Int
)
