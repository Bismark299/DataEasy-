package com.dataeasy.smslistener.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface MoMoTransactionDao {
    
    @Query("SELECT * FROM momo_transactions ORDER BY receivedAt DESC")
    fun getAllTransactions(): Flow<List<MoMoTransaction>>
    
    @Query("SELECT * FROM momo_transactions WHERE status = :status ORDER BY receivedAt ASC")
    suspend fun getByStatus(status: MoMoTransaction.Status): List<MoMoTransaction>
    
    @Query("SELECT * FROM momo_transactions WHERE status IN (:statuses) ORDER BY receivedAt ASC")
    suspend fun getByStatuses(statuses: List<MoMoTransaction.Status>): List<MoMoTransaction>
    
    @Query("SELECT * FROM momo_transactions WHERE transactionId = :txId LIMIT 1")
    suspend fun getByTransactionId(txId: String): MoMoTransaction?
    
    @Query("SELECT COUNT(*) FROM momo_transactions WHERE transactionId = :txId")
    suspend fun existsByTransactionId(txId: String): Int
    
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(transaction: MoMoTransaction): Long
    
    @Update
    suspend fun update(transaction: MoMoTransaction)
    
    @Query("UPDATE momo_transactions SET status = :status, serverResponse = :response, sentAt = :sentAt WHERE id = :id")
    suspend fun updateStatus(id: Long, status: MoMoTransaction.Status, response: String?, sentAt: Long?)
    
    @Query("UPDATE momo_transactions SET status = :status, retryCount = retryCount + 1, lastAttemptAt = :lastAttempt WHERE id = :id")
    suspend fun incrementRetry(id: Long, status: MoMoTransaction.Status, lastAttempt: Long)
    
    @Query("SELECT COUNT(*) FROM momo_transactions WHERE status = :status")
    suspend fun countByStatus(status: MoMoTransaction.Status): Int
    
    @Query("SELECT COUNT(*) FROM momo_transactions")
    suspend fun countAll(): Int
    
    @Query("DELETE FROM momo_transactions WHERE status = :status AND sentAt < :before")
    suspend fun deleteOldSent(status: MoMoTransaction.Status, before: Long): Int
}

@Dao
interface UnparsedSmsDao {
    
    @Query("SELECT * FROM unparsed_sms ORDER BY receivedAt DESC LIMIT 100")
    fun getRecent(): Flow<List<UnparsedSms>>
    
    @Insert
    suspend fun insert(sms: UnparsedSms)
    
    @Query("DELETE FROM unparsed_sms WHERE receivedAt < :before")
    suspend fun deleteOld(before: Long): Int
}
