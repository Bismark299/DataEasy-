package com.dataeasy.momolistener.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import com.dataeasy.momolistener.R
import com.dataeasy.momolistener.domain.model.MoMoTransaction
import com.dataeasy.momolistener.domain.model.TransactionStatus
import java.util.concurrent.TimeUnit

/**
 * RecyclerView Adapter for transactions - Modern UI
 */
class TransactionAdapter : ListAdapter<MoMoTransaction, TransactionAdapter.ViewHolder>(DiffCallback()) {
    
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
        private val statusBadge: TextView = itemView.findViewById(R.id.statusBadge)
        private val statusIcon: TextView = itemView.findViewById(R.id.statusIcon)
        private val statusIconBg: View = itemView.findViewById(R.id.statusIconBg)
        private val senderText: TextView = itemView.findViewById(R.id.senderText)
        private val txIdText: TextView = itemView.findViewById(R.id.txIdText)
        private val timeText: TextView = itemView.findViewById(R.id.timeText)
        
        fun bind(tx: MoMoTransaction) {
            val context = itemView.context
            
            // Amount
            amountText.text = "GHS %.2f".format(tx.amount)
            
            // Status styling
            when (tx.status) {
                TransactionStatus.SUCCESS -> {
                    statusBadge.text = "SUCCESS"
                    statusBadge.setTextColor(ContextCompat.getColor(context, R.color.success))
                    statusIcon.text = "✓"
                    statusIcon.setTextColor(ContextCompat.getColor(context, R.color.success))
                    statusIconBg.setBackgroundResource(R.drawable.status_badge_bg)
                    statusIconBg.backgroundTintList = ContextCompat.getColorStateList(context, R.color.card_success_bg)
                }
                TransactionStatus.PENDING -> {
                    statusBadge.text = "PENDING"
                    statusBadge.setTextColor(ContextCompat.getColor(context, R.color.pending))
                    statusIcon.text = "◌"
                    statusIcon.setTextColor(ContextCompat.getColor(context, R.color.pending))
                    statusIconBg.setBackgroundResource(R.drawable.status_badge_bg)
                    statusIconBg.backgroundTintList = ContextCompat.getColorStateList(context, R.color.card_pending_bg)
                }
                TransactionStatus.PROCESSING -> {
                    statusBadge.text = "UPLOADING"
                    statusBadge.setTextColor(ContextCompat.getColor(context, R.color.warning))
                    statusIcon.text = "↑"
                    statusIcon.setTextColor(ContextCompat.getColor(context, R.color.warning))
                    statusIconBg.setBackgroundResource(R.drawable.status_badge_bg)
                    statusIconBg.backgroundTintList = ContextCompat.getColorStateList(context, R.color.warning_bg)
                }
                TransactionStatus.FAILED -> {
                    statusBadge.text = "FAILED"
                    statusBadge.setTextColor(ContextCompat.getColor(context, R.color.error))
                    statusIcon.text = "✕"
                    statusIcon.setTextColor(ContextCompat.getColor(context, R.color.error))
                    statusIconBg.setBackgroundResource(R.drawable.status_badge_bg)
                    statusIconBg.backgroundTintList = ContextCompat.getColorStateList(context, R.color.card_failed_bg)
                }
            }
            
            // Sender/Reference
            senderText.text = if (tx.reference != null) {
                "Ref: ${tx.reference} • ${tx.senderName.take(15)}"
            } else {
                "From: ${tx.senderName.take(25)}"
            }
            
            // Transaction ID
            txIdText.text = "ID: ${tx.transactionId}"
            
            // Time - relative format
            timeText.text = getRelativeTime(tx.receivedAt)
        }
        
        private fun getRelativeTime(timestamp: Long): String {
            val now = System.currentTimeMillis()
            val diff = now - timestamp
            
            return when {
                diff < TimeUnit.MINUTES.toMillis(1) -> "Just now"
                diff < TimeUnit.HOURS.toMillis(1) -> "${TimeUnit.MILLISECONDS.toMinutes(diff)}m ago"
                diff < TimeUnit.DAYS.toMillis(1) -> "${TimeUnit.MILLISECONDS.toHours(diff)}h ago"
                diff < TimeUnit.DAYS.toMillis(7) -> "${TimeUnit.MILLISECONDS.toDays(diff)}d ago"
                else -> "${TimeUnit.MILLISECONDS.toDays(diff)}d"
            }
        }
    }
    
    class DiffCallback : DiffUtil.ItemCallback<MoMoTransaction>() {
        override fun areItemsTheSame(old: MoMoTransaction, new: MoMoTransaction) = 
            old.transactionId == new.transactionId
        
        override fun areContentsTheSame(old: MoMoTransaction, new: MoMoTransaction) = 
            old == new
    }
}
