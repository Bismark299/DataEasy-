package com.dataeasy.momolistener.domain.model

/**
 * Result wrapper for parsed SMS
 */
sealed class ParseResult {
    data class Success(val transaction: MoMoTransaction) : ParseResult()
    data class InvalidFormat(val reason: String, val rawMessage: String) : ParseResult()
    data class NotMoMoMessage(val sender: String) : ParseResult()
}

/**
 * Result wrapper for API operations
 */
sealed class ApiResult<out T> {
    data class Success<T>(val data: T) : ApiResult<T>()
    data class Error(val code: Int, val message: String) : ApiResult<Nothing>()
    data class NetworkError(val exception: Throwable) : ApiResult<Nothing>()
}
