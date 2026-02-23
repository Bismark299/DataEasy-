package com.dataeasy.momolistener.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.provider.Telephony
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.dataeasy.momolistener.MoMoListenerApp
import com.dataeasy.momolistener.R
import com.dataeasy.momolistener.databinding.ActivityMainBinding
import com.dataeasy.momolistener.domain.model.MoMoTransaction
import com.dataeasy.momolistener.domain.model.ParseResult
import com.dataeasy.momolistener.domain.model.TransactionStatus
import com.dataeasy.momolistener.service.ListenerService
import com.dataeasy.momolistener.sms.SmsParser
import com.dataeasy.momolistener.worker.TransactionUploadWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Main Activity - Dashboard UI
 * 
 * Shows:
 * - Service status
 * - Transaction statistics
 * - Recent transactions list
 * - Control buttons
 */
class MainActivity : AppCompatActivity() {
    
    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: TransactionAdapter
    
    private val requiredPermissions = mutableListOf(
        Manifest.permission.RECEIVE_SMS,
        Manifest.permission.READ_SMS
    ).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    
    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions.all { it.value }) {
            onPermissionsGranted()
        } else {
            showPermissionDenied()
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        
        setupUI()
        checkPermissions()
        // observeTransactions() called after permissions granted
    }
    
    private fun setupUI() {
        // RecyclerView
        adapter = TransactionAdapter()
        binding.recyclerView.layoutManager = LinearLayoutManager(this)
        binding.recyclerView.adapter = adapter
        
        // Start button
        binding.btnStart.setOnClickListener {
            startListenerService()
        }
        
        // Stop button
        binding.btnStop.setOnClickListener {
            stopListenerService()
        }
        
        // Battery optimization button
        binding.btnBattery.setOnClickListener {
            requestBatteryExemption()
        }
        
        // Sync button
        binding.btnSync.setOnClickListener {
            syncFromInbox()
        }
        
        // Retry failed button
        binding.btnRetry.setOnClickListener {
            retryFailed()
        }
    }
    
    private fun checkPermissions() {
        val notGranted = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        
        if (notGranted.isEmpty()) {
            onPermissionsGranted()
        } else {
            permissionLauncher.launch(notGranted.toTypedArray())
        }
    }
    
    private fun onPermissionsGranted() {
        binding.statusText.text = "Ready"
        binding.statusDot.setBackgroundResource(R.drawable.status_dot_pending)
        binding.btnStart.isEnabled = true
        binding.btnStop.isEnabled = false
        
        // Start observing transactions now that app is ready
        observeTransactions()
        
        // Don't auto-start service - let user tap Start button
        // This avoids crash if notification channel has issues
    }
    
    private fun showPermissionDenied() {
        AlertDialog.Builder(this)
            .setTitle("Permissions Required")
            .setMessage("SMS permissions are required for MoMo listening. Please grant them in Settings.")
            .setPositiveButton("Settings") { _, _ ->
                Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", packageName, null)
                    startActivity(this)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    private fun startListenerService() {
        val intent = Intent(this, ListenerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        
        binding.statusText.text = "Listening"
        binding.statusDot.setBackgroundResource(R.drawable.status_dot_active)
        binding.btnStart.isEnabled = false
        binding.btnStop.isEnabled = true
        
        Toast.makeText(this, "Listener started", Toast.LENGTH_SHORT).show()
    }
    
    private fun stopListenerService() {
        stopService(Intent(this, ListenerService::class.java))
        
        binding.statusText.text = "Stopped"
        binding.statusDot.setBackgroundResource(R.drawable.status_dot_stopped)
        binding.btnStart.isEnabled = true
        binding.btnStop.isEnabled = false
        
        Toast.makeText(this, "Listener stopped", Toast.LENGTH_SHORT).show()
    }
    
    private fun requestBatteryExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = getSystemService(POWER_SERVICE) as PowerManager
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                    startActivity(this)
                }
            } else {
                Toast.makeText(this, "Already optimized", Toast.LENGTH_SHORT).show()
            }
        }
    }
    
    /**
     * Sync MoMo messages from SMS inbox
     * Useful for processing messages received while app was offline
     */
    private fun syncFromInbox() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS)
            != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "SMS permission required", Toast.LENGTH_SHORT).show()
            return
        }
        
        Toast.makeText(this, "Syncing...", Toast.LENGTH_SHORT).show()
        binding.statusText.text = "Syncing..."
        
        lifecycleScope.launch {
            val count = withContext(Dispatchers.IO) {
                syncMoMoFromInbox()
            }
            
            binding.statusText.text = "Synced"
            Toast.makeText(this@MainActivity, "Found $count MoMo messages", Toast.LENGTH_SHORT).show()
            
            // Trigger upload
            TransactionUploadWorker.enqueueImmediate(this@MainActivity)
        }
    }
    
    /**
     * Read SMS inbox and process MoMo messages
     */
    private suspend fun syncMoMoFromInbox(): Int {
        var count = 0
        val repository = MoMoListenerApp.getInstance().repository
        
        val cursor = contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE
            ),
            null,
            null,
            "${Telephony.Sms.DATE} DESC LIMIT 50"
        )
        
        cursor?.use {
            val addrIdx = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyIdx = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateIdx = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
            
            while (it.moveToNext()) {
                val address = it.getString(addrIdx) ?: continue
                val body = it.getString(bodyIdx) ?: continue
                val date = it.getLong(dateIdx)
                
                when (val result = SmsParser.parse(address, body, date)) {
                    is ParseResult.Success -> {
                        if (repository.saveTransaction(result.transaction)) {
                            count++
                        }
                    }
                    else -> { /* skip */ }
                }
            }
        }
        
        return count
    }
    
    /**
     * Retry all failed transactions
     */
    private fun retryFailed() {
        Toast.makeText(this, "Retrying failed uploads...", Toast.LENGTH_SHORT).show()
        
        // First reset all failed transactions to pending
        lifecycleScope.launch {
            val count = withContext(Dispatchers.IO) {
                MoMoListenerApp.getInstance().repository.resetAllFailed()
            }
            if (count > 0) {
                Toast.makeText(this@MainActivity, "Reset $count failed → retrying", Toast.LENGTH_SHORT).show()
            }
            // Then trigger upload
            TransactionUploadWorker.enqueueImmediate(this@MainActivity)
        }
    }
    
    /**
     * Observe transactions and update UI
     */
    private fun observeTransactions() {
        lifecycleScope.launch {
            try {
                MoMoListenerApp.getInstance().repository.getAllTransactions()
                    .collectLatest { transactions ->
                        adapter.submitList(transactions)
                        updateStats(transactions)
                    }
            } catch (e: Exception) {
                android.util.Log.e("MainActivity", "Error observing transactions", e)
                binding.statTotalAmount.text = "Error"
            }
        }
    }
    
    private fun updateStats(transactions: List<MoMoTransaction>) {
        val total = transactions.size
        val success = transactions.count { it.status == TransactionStatus.SUCCESS }
        val pending = transactions.count { 
            it.status == TransactionStatus.PENDING || it.status == TransactionStatus.PROCESSING 
        }
        val failed = transactions.count { it.status == TransactionStatus.FAILED }
        
        val totalAmount = transactions
            .filter { it.status == TransactionStatus.SUCCESS }
            .sumOf { it.amount }
        
        // Update individual stat views
        binding.statTotalAmount.text = "GHS %.2f".format(totalAmount)
        binding.statTotalCount.text = "$total transactions"
        binding.statSuccess.text = success.toString()
        binding.statPending.text = pending.toString()
        binding.statFailed.text = failed.toString()
    }
}
