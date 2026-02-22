package com.dataeasy.momolistener.data.repository

import android.util.Log
import com.dataeasy.momolistener.BuildConfig
import com.dataeasy.momolistener.data.local.AppDatabase
import com.dataeasy.momolistener.data.local.TransactionEntity
import com.dataeasy.momolistener.data.remote.ApiClient
import com.dataeasy.momolistener.data.remote.ApiResponse
import com.dataeasy.momolistener.domain.model.ApiResult
import com.dataeasy.momolistener.domain.model.MoMoTransaction
import com.dataeasy.momolistener.domain.model.TransactionStatus
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Repository - Single source of truth
 * 
 * Coordinates between:
 * - Local database (Room)
 * - Remote API (Retrofit)
 * 
 * Implements offline-first strategy:
 * 1. Save locally first (always succeeds)
 * 2. Upload in background (may fail, will retry)
 */
class TransactionRepository(private val database: AppDatabase) {
    
    companion object {
        private const val TAG = "TransactionRepository"
    }
    
    private val dao = database.transactionDao()
    private val api = ApiClient.getService()
    
    // ==================== LOCAL OPERATIONS ====================
    
    /**
     * Save new transaction locally
     * Returns true if saved, false if duplicate
     */
    suspend fun saveTransaction(transaction: MoMoTransaction): Boolean {
        val entity = transaction.toEntity()
        val id = dao.insert(entity)
        
        if (id == -1L) {
            Log.w(TAG, "Duplicate transaction ignored: ${transaction.transactionId}")
            return false
        }
        
        Log.i(TAG, "Transaction saved: ${transaction.transactionId}, id=$id")
        return true
    }
    
    /**
     * Check if transaction already exists
     */
    suspend fun isDuplicate(transactionId: String): Boolean {
        return dao.existsByTransactionId(transactionId) > 0
    }
    
    /**
     * Get all transactions as Flow (for UI observation)
     */
    fun getAllTransactions(): Flow<List<MoMoTransaction>> {
        return dao.getAllTransactions().map { entities ->
            entities.map { it.toDomain() }
        }
    }
    
    /**
     * Get pending transactions for upload
     */
    suspend fun getPendingForUpload(): List<TransactionEntity> {
        return dao.getPendingForUpload()
    }
    
    /**
     * Reset all failed transactions back to pending for retry
     */
    suspend fun resetAllFailed(): Int {
        val count = dao.resetAllFailedToPending()
        Log.i(TAG, "Reset $count failed transactions to PENDING")
        return count
    }
    
    /**
     * Get status counts for dashboard
     */
    suspend fun getStatusCounts(): Map<String, Int> {
        return dao.getStatusCounts().associate { it.status to it.count }
    }
    
    // ==================== UPLOAD OPERATIONS ====================
    
    /**
     * Upload a single transaction to server
     * 
     * Flow:
     * 1. Mark as PROCESSING
     * 2. Call API
     * 3. Mark SUCCESS or increment retry
     */
    suspend fun uploadTransaction(entity: TransactionEntity): ApiResult<ApiResponse> {
        // Mark as processing
        dao.markProcessing(entity.id)
        
        return try {
            Log.i(TAG, "Uploading transaction: ${entity.transactionId}")
            
            val response = api.uploadTransaction(
                transactionId = entity.transactionId,
                amount = entity.amount,
                senderPhone = entity.senderName,  // Server expects senderPhone field
                reference = entity.reference,
                rawMessage = entity.rawMessage,
                receivedAt = entity.receivedAt
            )
            
            if (response.isSuccessful) {
                val body = response.body()
                
                // SUCCESS cases:
                // 1. success=true (credited or unmatched but received)
                // 2. duplicate=true (already processed)
                if (body?.success == true || body?.duplicate == true) {
                    // Determine the response message
                    val responseMsg = when {
                        body?.duplicate == true -> "Duplicate - already processed"
                        body?.username != null -> "Credited to ${body.username}"
                        else -> body?.message ?: "Received (unmatched)"
                    }
                    
                    dao.markSuccess(
                        id = entity.id,
                        response = responseMsg,
                        processedAt = System.currentTimeMillis()
                    )
                    Log.i(TAG, "Upload successful: ${entity.transactionId} - $responseMsg")
                    ApiResult.Success(body)
                } else {
                    // Server returned error in body (shouldn't happen with new API)
                    val error = body?.error ?: "Unknown server error"
                    handleUploadError(entity, error)
                    ApiResult.Error(response.code(), error)
                }
            } else {
                // HTTP error
                val error = response.errorBody()?.string() ?: "HTTP ${response.code()}"
                handleUploadError(entity, error)
                ApiResult.Error(response.code(), error)
            }
        } catch (e: Exception) {
            // Network error
            Log.e(TAG, "Network error uploading: ${entity.transactionId}", e)
            handleUploadError(entity, e.message ?: "Network error")
            ApiResult.NetworkError(e)
        }
    }
    
    /**
     * Handle upload error - increment retry or mark failed
     */
    private suspend fun handleUploadError(entity: TransactionEntity, error: String) {
        dao.markRetryOrFailed(
            id = entity.id,
            error = error,
            maxRetries = BuildConfig.MAX_RETRY_COUNT
        )
        
        val newRetryCount = entity.retryCount + 1
        if (newRetryCount >= BuildConfig.MAX_RETRY_COUNT) {
            Log.e(TAG, "Max retries reached for: ${entity.transactionId}")
        } else {
            Log.w(TAG, "Will retry (${newRetryCount}/${BuildConfig.MAX_RETRY_COUNT}): ${entity.transactionId}")
        }
    }
    
    // ==================== CLEANUP ====================
    
    /**
     * Delete old successful transactions (older than 7 days)
     */
    suspend fun cleanupOldTransactions() {
        val sevenDaysAgo = System.currentTimeMillis() - (7 * 24 * 60 * 60 * 1000L)
        val deleted = dao.deleteOldSuccessful(sevenDaysAgo)
        if (deleted > 0) {
            Log.i(TAG, "Cleaned up $deleted old transactions")
        }
    }
    
    // ==================== MAPPERS ====================
    
    private fun MoMoTransaction.toEntity() = TransactionEntity(
        id = if (id == 0L) 0 else id,
        transactionId = transactionId,
        amount = amount,
        senderName = senderName,
        senderPhone = senderPhone,
        reference = reference,
        rawMessage = rawMessage,
        smsSender = smsSender,
        receivedAt = receivedAt,
        status = status.name,
        retryCount = retryCount,
        lastError = lastError,
        serverResponse = serverResponse,
        processedAt = processedAt
    )
    
    private fun TransactionEntity.toDomain() = MoMoTransaction(
        id = id,
        transactionId = transactionId,
        amount = amount,
        senderName = senderName,
        senderPhone = senderPhone,
        reference = reference,
        rawMessage = rawMessage,
        smsSender = smsSender,
        receivedAt = receivedAt,
        status = try {
            TransactionStatus.valueOf(status.uppercase())
        } catch (e: Exception) {
            TransactionStatus.PENDING  // Fallback to PENDING if invalid
        },
        retryCount = retryCount,
        lastError = lastError,
        serverResponse = serverResponse,
        processedAt = processedAt
    )
}
