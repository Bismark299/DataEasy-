package com.dataeasy.smslistener.data

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters

/**
 * Type converters for Room database
 */
class Converters {
    @TypeConverter
    fun fromStatus(status: MoMoTransaction.Status): String {
        return status.name
    }
    
    @TypeConverter
    fun toStatus(value: String): MoMoTransaction.Status {
        return MoMoTransaction.Status.valueOf(value)
    }
}

@Database(
    entities = [MoMoTransaction::class, UnparsedSms::class],
    version = 3,
    exportSchema = false
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun momoTransactionDao(): MoMoTransactionDao
    abstract fun unparsedSmsDao(): UnparsedSmsDao
}
