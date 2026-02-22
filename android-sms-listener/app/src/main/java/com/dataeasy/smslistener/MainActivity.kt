package com.dataeasy.smslistener

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
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
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
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
