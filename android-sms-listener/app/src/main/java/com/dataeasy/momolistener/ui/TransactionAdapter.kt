package com.dataeasy.momolistener.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dataeasy.momolistener.R
import com.dataeasy.momolistener.domain.model.MoMoTransaction
import com.dataeasy.momolistener.domain.model.TransactionStatus
import java.text.SimpleDateFormat
import java.util.*

/**
 * RecyclerView Adapter for transactions
 */
class TransactionAdapter : ListAdapter<MoMoTransaction, TransactionAdapter.ViewHolder>(DiffCallback()) {
    
    private val dateFormat = SimpleDateFormat("dd/MM HH:mm", Locale.getDefault())
    
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_transaction, parent, false)
        return ViewHolder(view)
    }
    
    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(getItem(position))
    }
    
    inner class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val amountText: TextView = itemView.findViewById(R.id.amountText)
        private val statusText: TextView = itemView.findViewById(R.id.statusText)
        private val detailsText: TextView = itemView.findViewById(R.id.detailsText)
        private val timeText: TextView = itemView.findViewById(R.id.timeText)
        
        fun bind(tx: MoMoTransaction) {
            amountText.text = "GHS %.2f".format(tx.amount)
            
            statusText.text = when (tx.status) {
                TransactionStatus.SUCCESS -> "✅ SUCCESS"
                TransactionStatus.PENDING -> "⏳ PENDING"
                TransactionStatus.PROCESSING -> "📤 UPLOADING"
                TransactionStatus.FAILED -> "❌ FAILED (${tx.retryCount})"
            }
            
            detailsText.text = buildString {
                append("ID: ${tx.transactionId.take(10)}...")
                if (tx.reference != null) {
                    append("\nRef: ${tx.reference}")
                }
                append("\nFrom: ${tx.senderName.take(20)}")
                if (tx.lastError != null) {
                    append("\nError: ${tx.lastError.take(30)}")
                }
            }
            
            timeText.text = dateFormat.format(Date(tx.receivedAt))
        }
    }
    
    class DiffCallback : DiffUtil.ItemCallback<MoMoTransaction>() {
        override fun areItemsTheSame(old: MoMoTransaction, new: MoMoTransaction) = 
            old.transactionId == new.transactionId
        
        override fun areContentsTheSame(old: MoMoTransaction, new: MoMoTransaction) = 
            old == new
    }
}
