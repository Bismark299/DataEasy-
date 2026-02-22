package com.dataeasy.smslistener

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.provider.Telephony
import android.util.Log
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import com.dataeasy.smslistener.data.MoMoTransaction
import com.dataeasy.smslistener.service.SmsListenerService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : AppCompatActivity() {
    
    private lateinit var statusText: TextView
    private lateinit var statsText: TextView
    private lateinit var startButton: Button
    private lateinit var stopButton: Button
    private lateinit var recyclerView: RecyclerView
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
        val allGranted = permissions.all { it.value }
        if (allGranted) {
            onPermissionsGranted()
        } else {
            showPermissionDeniedDialog()
        }
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        
        initViews()
        setupRecyclerView()
        checkPermissions()
        observeTransactions()
    }
    
    private fun initViews() {
        statusText = findViewById(R.id.statusText)
        statsText = findViewById(R.id.statsText)
        startButton = findViewById(R.id.startButton)
        stopButton = findViewById(R.id.stopButton)
        recyclerView = findViewById(R.id.recyclerView)
        
        startButton.setOnClickListener {
            startListenerService()
        }
        
        stopButton.setOnClickListener {
            stopListenerService()
        }
        
        findViewById<Button>(R.id.batteryOptButton).setOnClickListener {
            requestBatteryOptimizationExemption()
        }
        
        findViewById<Button>(R.id.syncButton).setOnClickListener {
            syncMoMoMessages()
        }
    }
    
    private fun setupRecyclerView() {
        adapter = TransactionAdapter()
        recyclerView.layoutManager = LinearLayoutManager(this)
        recyclerView.adapter = adapter
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
        statusText.text = "Permissions granted. Ready to listen."
        startButton.isEnabled = true
        
        // Auto-start service
        startListenerService()
    }
    
    private fun showPermissionDeniedDialog() {
        AlertDialog.Builder(this)
            .setTitle("Permissions Required")
            .setMessage("SMS permissions are required to listen for MoMo deposits. Please grant permissions in Settings.")
            .setPositiveButton("Open Settings") { _, _ ->
                openAppSettings()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
    
    private fun openAppSettings() {
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", packageName, null)
            startActivity(this)
        }
    }
    
    private fun startListenerService() {
        val intent = Intent(this, SmsListenerService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        
        statusText.text = "✅ Service Running - Listening for MoMo SMS"
        startButton.isEnabled = false
        stopButton.isEnabled = true
        
        Toast.makeText(this, "MoMo Listener Started", Toast.LENGTH_SHORT).show()
    }
    
    private fun stopListenerService() {
        stopService(Intent(this, SmsListenerService::class.java))
        
        statusText.text = "⏹️ Service Stopped"
        startButton.isEnabled = true
        stopButton.isEnabled = false
        
        Toast.makeText(this, "MoMo Listener Stopped", Toast.LENGTH_SHORT).show()
    }
    
    private fun requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                    startActivity(this)
                }
            } else {
                Toast.makeText(this, "Already exempt from battery optimization", Toast.LENGTH_SHORT).show()
            }
        }
    }
    
    /**
     * Sync MoMo messages from SMS inbox
     * Reads recent SMS from MobileMoney sender and processes them
     */
    private fun syncMoMoMessages() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) 
            != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "SMS permission required", Toast.LENGTH_SHORT).show()
            return
        }
        
        Toast.makeText(this, "🔄 Syncing MoMo messages...", Toast.LENGTH_SHORT).show()
        statusText.text = "🔄 Syncing..."
        
        lifecycleScope.launch {
            try {
                val count = withContext(Dispatchers.IO) {
                    readAndProcessMoMoSms()
                }
                
                statusText.text = "✅ Synced $count MoMo message(s)"
                Toast.makeText(this@MainActivity, "Found $count MoMo message(s)", Toast.LENGTH_SHORT).show()
                
            } catch (e: Exception) {
                Log.e("MainActivity", "Sync failed", e)
                statusText.text = "❌ Sync failed: ${e.message}"
                Toast.makeText(this@MainActivity, "Sync failed: ${e.message}", Toast.LENGTH_LONG).show()
            }
        }
    }
    
    /**
     * Read SMS messages from inbox and process MoMo deposits
     */
    private suspend fun readAndProcessMoMoSms(): Int {
        var processedCount = 0
        
        // MoMo sender addresses to look for
        val momoSenders = listOf("mobilemoney", "momo", "mtn", "1515")
        
        // Query last 100 SMS messages
        val cursor: Cursor? = contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(
                Telephony.Sms._ID,
                Telephony.Sms.ADDRESS,
                Telephony.Sms.BODY,
                Telephony.Sms.DATE
            ),
            null,
            null,
            "${Telephony.Sms.DATE} DESC LIMIT 100"
        )
        
        cursor?.use {
            val addressIndex = it.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
            val bodyIndex = it.getColumnIndexOrThrow(Telephony.Sms.BODY)
            val dateIndex = it.getColumnIndexOrThrow(Telephony.Sms.DATE)
            
            while (it.moveToNext()) {
                val address = it.getString(addressIndex) ?: continue
                val body = it.getString(bodyIndex) ?: continue
                val date = it.getLong(dateIndex)
                
                // Check if from MoMo sender
                val lowerAddress = address.lowercase()
                if (momoSenders.none { sender -> lowerAddress.contains(sender) }) {
                    continue
                }
                
                // Check if it's a deposit message (contains "received" or similar)
                val lowerBody = body.lowercase()
                if (!lowerBody.contains("received") && !lowerBody.contains("payment received")) {
                    continue
                }
                
                Log.i("MainActivity", "Found MoMo message: ${body.take(50)}...")
                
                // Extract and process
                val amount = extractAmount(body)
                val transactionId = extractTransactionId(body) ?: "SYNC${date}"
                val reference = extractReference(body)
                val senderName = extractSender(body) ?: address
                
                // Check if already processed
                val dao = MoMoListenerApp.getInstance().database.momoTransactionDao()
                if (dao.existsByTransactionId(transactionId) > 0) {
                    Log.d("MainActivity", "Already processed: $transactionId")
                    continue
                }
                
                // Create transaction
                val transaction = MoMoTransaction(
                    transactionId = transactionId,
                    amount = amount ?: 0.0,
                    senderPhone = senderName,
                    reference = reference,
                    rawMessage = body,
                    smsSender = address,
                    receivedAt = date,
                    status = MoMoTransaction.Status.PENDING
                )
                
                // Process it
                SmsListenerService.processTransaction(this@MainActivity, transaction)
                processedCount++
                
                Log.i("MainActivity", "Synced: $transactionId, Amount=$amount, Ref=$reference")
            }
        }
        
        return processedCount
    }
    
    // Simple extraction helpers (same as SmsReceiver)
    private fun extractAmount(body: String): Double? {
        val pattern = Regex("GH[SC]\\s*([\\d,]+\\.\\d{2})", RegexOption.IGNORE_CASE)
        pattern.find(body)?.let { match ->
            return match.groupValues[1].replace(",", "").toDoubleOrNull()
        }
        val simple = Regex("(\\d+\\.\\d{2})")
        simple.find(body)?.let { return it.groupValues[1].toDoubleOrNull() }
        return null
    }
    
    private fun extractTransactionId(body: String): String? {
        val pattern = Regex("Transaction\\s*ID[:\\s]+([\\w]+)", RegexOption.IGNORE_CASE)
        pattern.find(body)?.let { return it.groupValues[1] }
        val idPattern = Regex("ID[:\\s]+([\\w]{8,})", RegexOption.IGNORE_CASE)
        idPattern.find(body)?.let { return it.groupValues[1] }
        return null
    }
    
    private fun extractReference(body: String): String? {
        val refPattern = Regex("Reference[:\\s]+([\\w-]+)", RegexOption.IGNORE_CASE)
        refPattern.find(body)?.let { 
            val ref = it.groupValues[1]
            return if (ref.uppercase().startsWith("BT")) ref.uppercase() else ref
        }
        val btPattern = Regex("\\b(BT-?\\d{4})\\b", RegexOption.IGNORE_CASE)
        btPattern.find(body)?.let { 
            val code = it.groupValues[1].uppercase()
            return if (code.contains("-")) code else "BT-${code.substring(2)}"
        }
        return null
    }
    
    private fun extractSender(body: String): String? {
        val pattern = Regex("from\\s+([A-Z][A-Za-z\\s]+?)\\s{2,}", RegexOption.IGNORE_CASE)
        pattern.find(body)?.let { return it.groupValues[1].trim() }
        val pattern2 = Regex("from\\s+([A-Z][A-Za-z\\s]+?)\\s+Current", RegexOption.IGNORE_CASE)
        pattern2.find(body)?.let { return it.groupValues[1].trim() }
        return null
    }
    
    private fun observeTransactions() {
        lifecycleScope.launch {
            val app = MoMoListenerApp.getInstance()
            val dao = app.database.momoTransactionDao()
            
            // Observe transaction list
            dao.getAllTransactions().collectLatest { transactions ->
                adapter.submitList(transactions)
                updateStats(transactions)
            }
        }
    }
    
    private fun updateStats(transactions: List<MoMoTransaction>) {
        val total = transactions.size
        val sent = transactions.count { it.status == MoMoTransaction.Status.SENT }
        val pending = transactions.count { it.status == MoMoTransaction.Status.PENDING || it.status == MoMoTransaction.Status.FAILED }
        val errors = transactions.count { it.status == MoMoTransaction.Status.ERROR }
        
        val totalAmount = transactions
            .filter { it.status == MoMoTransaction.Status.SENT }
            .sumOf { it.amount }
        
        statsText.text = """
            Total: $total | Sent: $sent | Pending: $pending | Errors: $errors
            Total Processed: GHS ${"%.2f".format(totalAmount)}
        """.trimIndent()
    }
}

/**
 * RecyclerView Adapter for transactions
 */
class TransactionAdapter : RecyclerView.Adapter<TransactionAdapter.ViewHolder>() {
    
    private var transactions: List<MoMoTransaction> = emptyList()
    private val dateFormat = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault())
    
    fun submitList(list: List<MoMoTransaction>) {
        transactions = list
        notifyDataSetChanged()
    }
    
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_transaction, parent, false)
        return ViewHolder(view)
    }
    
    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(transactions[position])
    }
    
    override fun getItemCount() = transactions.size
    
    inner class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val amountText: TextView = itemView.findViewById(R.id.amountText)
        private val statusText: TextView = itemView.findViewById(R.id.statusText)
        private val detailsText: TextView = itemView.findViewById(R.id.detailsText)
        private val timeText: TextView = itemView.findViewById(R.id.timeText)
        
        fun bind(tx: MoMoTransaction) {
            amountText.text = "GHS ${"%.2f".format(tx.amount)}"
            
            statusText.text = when (tx.status) {
                MoMoTransaction.Status.SENT -> "✅ SENT"
                MoMoTransaction.Status.PENDING -> "⏳ PENDING"
                MoMoTransaction.Status.SENDING -> "📤 SENDING"
                MoMoTransaction.Status.FAILED -> "🔄 RETRY (${tx.retryCount})"
                MoMoTransaction.Status.ERROR -> "❌ ERROR"
            }
            
            detailsText.text = buildString {
                append("ID: ${tx.transactionId}")
                if (tx.reference != null) {
                    append(" | Ref: ${tx.reference}")
                }
                append("\nFrom: ${tx.senderPhone}")
                if (tx.serverResponse != null) {
                    append("\n${tx.serverResponse}")
                }
            }
            
            timeText.text = dateFormat.format(Date(tx.receivedAt))
        }
    }
}
