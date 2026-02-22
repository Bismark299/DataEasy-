package com.dataeasy.smslistener.network

import android.content.Context
import com.dataeasy.smslistener.BuildConfig
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
     * Report a MoMo deposit to the server
     * 
     * POST /api/momo/deposit
     */
    @FormUrlEncoded
    @POST("api/momo/deposit")
    suspend fun reportDeposit(
        @Field("transactionId") transactionId: String,
        @Field("amount") amount: Double,
        @Field("senderPhone") senderPhone: String,
        @Field("reference") reference: String?,
        @Field("rawMessage") rawMessage: String,
        @Field("receivedAt") receivedAt: Long
    ): Response<DepositResponse>
}

/**
 * Server response for deposit
 */
data class DepositResponse(
    val success: Boolean,
    val message: String?,
    val error: String?,
    val username: String?,   // Username that was credited
    val newBalance: Double?  // New wallet balance
)

/**
 * API Client singleton
 */
object ApiClient {
    
    private lateinit var retrofit: Retrofit
    lateinit var service: ApiService
        private set
    
    fun initialize(context: Context) {
        val loggingInterceptor = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BODY
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }
        
        // Auth interceptor - adds secret token to all requests
        val authInterceptor = Interceptor { chain ->
            val original = chain.request()
            val request = original.newBuilder()
                .header("X-Auth-Token", BuildConfig.API_SECRET_TOKEN)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .method(original.method, original.body)
                .build()
            chain.proceed(request)
        }
        
        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(loggingInterceptor)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
        
        retrofit = Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL.trimEnd('/') + "/")
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
        
        service = retrofit.create(ApiService::class.java)
    }
}
