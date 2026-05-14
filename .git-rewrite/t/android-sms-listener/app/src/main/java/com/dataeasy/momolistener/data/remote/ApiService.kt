package com.dataeasy.momolistener.data.remote

import com.dataeasy.momolistener.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Field
import retrofit2.http.FormUrlEncoded
import retrofit2.http.POST
import java.util.concurrent.TimeUnit

/**
 * API Service Interface
 */
interface ApiService {
    
    /**
     * Upload MoMo transaction to server
     * 
     * Server MUST be idempotent:
     * - If transactionId already processed → return success (no duplicate credit)
     * - Use transactionId as unique key
     */
    @FormUrlEncoded
    @POST("api/momo/deposit")
    suspend fun uploadTransaction(
        @Field("transactionId") transactionId: String,
        @Field("amount") amount: Double,
        @Field("senderPhone") senderPhone: String,
        @Field("reference") reference: String?,
        @Field("rawMessage") rawMessage: String,
        @Field("receivedAt") receivedAt: Long
    ): Response<ApiResponse>
}

/**
 * Server response model
 */
data class ApiResponse(
    val success: Boolean,
    val message: String?,
    val error: String?,
    val username: String?,      // User that was credited (null if unmatched)
    val newBalance: Double?,    // User's new balance
    val duplicate: Boolean? = false,  // True if already processed
    val matched: Boolean? = true,     // False if user not found
    val status: String? = null,       // Deposit status (credited, unmatched, etc.)
    val depositId: String? = null     // Server deposit ID
)

/**
 * API Client singleton
 * Handles authentication and network configuration
 */
object ApiClient {
    
    private var retrofit: Retrofit? = null
    private var service: ApiService? = null
    
    fun getService(): ApiService {
        if (service == null) {
            service = getRetrofit().create(ApiService::class.java)
        }
        return service!!
    }
    
    private fun getRetrofit(): Retrofit {
        if (retrofit == null) {
            val client = OkHttpClient.Builder()
                .addInterceptor(authInterceptor())
                .addInterceptor(loggingInterceptor())
                // Increased timeouts for Render cold starts (can take 30-60 seconds)
                .connectTimeout(90, TimeUnit.SECONDS)
                .readTimeout(90, TimeUnit.SECONDS)
                .writeTimeout(90, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
            
            retrofit = Retrofit.Builder()
                .baseUrl(BuildConfig.API_BASE_URL)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
        }
        return retrofit!!
    }
    
    /**
     * Add authentication token to all requests
     */
    private fun authInterceptor() = Interceptor { chain ->
        val request = chain.request().newBuilder()
            .header("X-Auth-Token", BuildConfig.API_SECRET_TOKEN)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .build()
        chain.proceed(request)
    }
    
    /**
     * Log network requests (debug only)
     */
    private fun loggingInterceptor() = HttpLoggingInterceptor().apply {
        level = if (BuildConfig.DEBUG) {
            HttpLoggingInterceptor.Level.BODY
        } else {
            HttpLoggingInterceptor.Level.NONE
        }
    }
}
