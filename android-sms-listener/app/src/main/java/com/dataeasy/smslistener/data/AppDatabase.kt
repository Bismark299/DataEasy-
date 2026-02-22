package com.dataeasy.smslistener.data

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [MoMoTransaction::class, UnparsedSms::class],
    version = 1,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun momoTransactionDao(): MoMoTransactionDao
    abstract fun unparsedSmsDao(): UnparsedSmsDao
}
